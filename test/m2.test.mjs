import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildChunks } from '../lib/chunk.js'
import { assertHostClosed, clearHostMarker, hostMarkerPath, hostStatus, writeHostMarker } from '../lib/hostguard.js'
import { readLogHeader } from '../lib/session-log.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore, putObject, withStoreLock, writeManifest } from '../lib/store.js'
import { sha256, toIso } from '../lib/util.js'
import { collectSessions, verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'm2-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-test' }

function setup(t) {
  const root = tempDir('keeper-m2-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  t.after(() => removeDir(root))
  return { root, home, dir, store: openStore(dir, PASS) }
}

test('a write prepared against a moved head is refused', (t) => {
  const { store } = setup(t)
  const first = writeManifest(store, { deviceId: DEVICE.deviceId, device: DEVICE, sessions: {}, createdAt: '2026-11-07T10:00:00.000Z' })
  assert.ok(first.ref.id)

  assert.throws(
    () => writeManifest(store, { deviceId: DEVICE.deviceId, device: DEVICE, sessions: {}, expectHead: null }),
    /head moved/,
  )
  const second = writeManifest(store, {
    deviceId: DEVICE.deviceId,
    device: DEVICE,
    sessions: {},
    expectHead: first.ref.id,
    createdAt: '2026-11-07T10:01:00.000Z',
  })
  assert.equal(second.doc.prev.id, first.ref.id)
})

test('a lock whose owner is alive is not stolen, even when it is old', (t) => {
  const { dir } = setup(t)
  const lockFile = path.join(dir, 'LOCK')
  fs.writeFileSync(lockFile, String(process.pid) + '\n')
  const old = new Date(Date.now() - 60 * 60 * 1000)
  fs.utimesSync(lockFile, old, old)

  assert.throws(() => withStoreLock(dir, { timeoutMs: 150 }, () => 'never'), /another writer is using this store/)
  assert.equal(fs.existsSync(lockFile), true, 'the live owner keeps its lock')
})

test('a lock whose owner is gone is broken', (t) => {
  const { dir } = setup(t)
  const lockFile = path.join(dir, 'LOCK')
  fs.writeFileSync(lockFile, '999999\n')
  const old = new Date(Date.now() - 60 * 60 * 1000)
  fs.utimesSync(lockFile, old, old)

  const value = withStoreLock(dir, { timeoutMs: 1_000 }, () => 'ran')
  assert.equal(value, 'ran')
  assert.equal(fs.existsSync(lockFile), false)
})

test('the newest descriptor wins when a chain describes the same chunk twice', (t) => {
  const { home, store } = setup(t)
  const device = DEVICE

  // First lineage: published normally.
  writeSession(home, { id: 's1', cwd: 'C:\\work\\m2', log: makeLog({ id: 's1', cwd: 'C:\\work\\m2', batches: [[{ type: 'turn/start', time: 100 }], [{ type: 'first', time: 200 }]] }) })
  snapshot(store, { home, now: '2026-11-07T10:00:00.000Z', device })
  const firstBuffer = collectSessions(store).sessions.get('s1').buffer

  // Second lineage for the same session, written by a later manifest with the same seq.
  const secondLog = makeLog({ id: 's1', cwd: 'C:\\work\\m2', batches: [[{ type: 'turn/start', time: 100 }], [{ type: 'second', time: 300 }]] })
  assert.equal(firstBuffer.equals(secondLog), false)
  const built = buildChunks(secondLog, { fromByte: 0, fromFrame: 0 })
  const chunks = built.chunks.map((chunk, index) => {
    const object = putObject(store, chunk.payload)
    return {
      seq: index + 1,
      objectId: object.id,
      cipherSha256: object.cipherSha256,
      cipherBytes: object.cipherBytes,
      plainSha256: sha256(chunk.payload),
      prefixSha256: chunk.prefixSha256,
      endSha256: chunk.endSha256,
      frameFrom: chunk.frameFrom,
      frameTo: chunk.frameTo,
      byteFrom: chunk.byteFrom,
      byteTo: chunk.byteTo,
      createdAt: toIso(),
    }
  })
  writeManifest(store, {
    deviceId: device.deviceId,
    device,
    sessions: { s1: { formatVersion: 4, header: readLogHeader(secondLog).header, chunks } },
    createdAt: '2026-11-07T10:05:00.000Z',
  })

  const current = collectSessions(store).sessions.get('s1')
  assert.equal(current.buffer.equals(secondLog), true, 'the newest manifest is the visible lineage')
  assert.equal(verifyStore(store).ok, true)
})

test('the host guard refuses writes while the host marker is alive', (t) => {
  const { home } = setup(t)
  assert.equal(hostStatus(home).running, false)

  writeHostMarker(home, { store: 'x' })
  const status = hostStatus(home)
  assert.equal(status.running, true)
  assert.equal(status.pid, process.pid)
  assert.throws(() => assertHostClosed(home), /DSH is open/)
  assert.doesNotThrow(() => assertHostClosed(home, { allow: true }))

  clearHostMarker(home)
  assert.equal(fs.existsSync(hostMarkerPath(home)), false)
})

test('a marker from a crashed host does not block, and is cleaned up', (t) => {
  const { home } = setup(t)
  fs.writeFileSync(hostMarkerPath(home), JSON.stringify({ pid: 999999, updatedAt: toIso() }))
  const status = hostStatus(home)
  assert.equal(status.running, false)
  assert.doesNotThrow(() => assertHostClosed(home))
  assert.equal(fs.existsSync(hostMarkerPath(home)), false, 'the stale marker is removed')
})
