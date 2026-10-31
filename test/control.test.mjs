import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { checkSession, hostVocabulary, sessionVocabulary } from '../lib/compat.js'
import { inventory, ownerBySession } from '../lib/inventory.js'
import { restore } from '../lib/restore.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore, readAllManifests } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'control-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-control-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'control' })
  t.after(() => removeDir(root))
  return { root, home, dir, store: openStore(dir, PASSPHRASE) }
}

test('the vocabulary reads plain events and batch rows', () => {
  const buffer = makeLog({
    id: 's1',
    batches: [[{ type: 'turn/start' }], [{ type: 'a' }, { type: 'b' }]],
  })
  const types = sessionVocabulary(buffer)
  assert.ok(types.has('session'))
  assert.ok(types.has('turn/start'))
  assert.ok(types.has('a'))
  assert.ok(types.has('b'))
})

test('a host with no sessions of its own is treated as permissive, not blocking', () => {
  const buffer = makeLog({ id: 's1', batches: [[{ type: 'job/registered' }]] })
  const empty = checkSession(buffer, new Set())
  assert.equal(empty.readable, true, 'a first restore must not be blocked by an empty vocabulary')
  const known = checkSession(buffer, new Set(['session', 'turn/start']))
  assert.equal(known.readable, false)
  assert.deepEqual(known.unknown, ['job/registered'])
})

test('restore skips a session this host cannot read, and --force writes it', (t) => {
  const { root, home, store } = setup(t)
  const target = path.join(root, 'target')
  // The host has one normal session, so its vocabulary is known and lacks job/*.
  writeSession(target, { id: 'host-own', log: makeLog({ id: 'host-own', batches: [[{ type: 'turn/start' }]] }) })

  writeSession(home, { id: 'normal', dirName: 'a', log: makeLog({ id: 'normal', batches: [[{ type: 'turn/start' }]] }) })
  writeSession(home, { id: 'newer', dirName: 'b', log: makeLog({ id: 'newer', batches: [[{ type: 'job/registered' }]] }) })
  snapshot(store, { home, now: '2026-10-31T12:00:00.000Z' })

  const dry = restore(store, { home: target, dryRun: true })
  assert.equal(dry.created.length, 1, 'only the readable session is planned')
  assert.equal(dry.incompatible.length, 1)
  assert.equal(dry.incompatible[0].sessionId, 'newer')
  assert.deepEqual(dry.incompatible[0].unknownEvents, ['job/registered'])

  const real = restore(store, { home: target })
  assert.equal(real.created.length, 1)
  assert.equal(real.incompatible.length, 1)

  const forced = restore(store, { home: target, force: true })
  assert.equal(forced.incompatible.length, 0)
  assert.equal(forced.created.length, 1, 'force writes the incompatible session too')
})

test('the inventory groups sessions by the device that published them', (t) => {
  const { home, store } = setup(t)
  const a = { deviceId: 'a'.repeat(32), deviceName: 'pc-a' }
  const b = { deviceId: 'b'.repeat(32), deviceName: 'pc-b' }

  const fileA = writeSession(home, { id: 'from-a', cwd: 'C:\\work\\a', dirName: 'a1', log: makeLog({ id: 'from-a', cwd: 'C:\\work\\a', batches: [[{ type: 'turn/start' }]] }) })
  snapshot(store, { home, now: '2026-10-31T12:00:00.000Z', device: a })
  // Simulate that this machine no longer holds the session, as after a restore elsewhere.
  fs.rmSync(path.dirname(fileA), { recursive: true, force: true })
  writeSession(home, { id: 'from-b', cwd: 'C:\\work\\b', dirName: 'b1', log: makeLog({ id: 'from-b', cwd: 'C:\\work\\b', batches: [[{ type: 'turn/start' }]] }) })
  snapshot(store, { home, now: '2026-10-31T12:01:00.000Z', device: b })

  const owners = ownerBySession(readAllManifests(store, { fresh: true }))
  assert.equal(owners.get('from-a'), a.deviceId)
  assert.equal(owners.get('from-b'), b.deviceId)

  const report = inventory(store, { home })
  assert.equal(report.devices.length, 2)
  const names = report.devices.map((group) => group.deviceName).sort()
  assert.deepEqual(names, ['pc-a', 'pc-b'])
  const byName = new Map(report.devices.map((group) => [group.deviceName, group]))
  assert.deepEqual(byName.get('pc-a').sessions.map((row) => row.sessionId), ['from-a'])
  assert.equal(byName.get('pc-a').sessions[0].local, 'absent', 'the local copy was removed')
  assert.equal(byName.get('pc-b').sessions[0].local, 'identical', 'this one is still on the machine')
  assert.equal(byName.get('pc-a').sessions[0].readable, true)
})

test('the inventory reports a local session that is behind the vault', (t) => {
  const { home, store } = setup(t)
  const device = { deviceId: 'c'.repeat(32), deviceName: 'pc-c' }
  writeSession(home, { id: 's1', dirName: 'c1', log: makeLog({ id: 's1', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  snapshot(store, { home, now: '2026-10-31T12:00:00.000Z', device })
  // Rewrite the local log shorter: the vault holds more than the machine.
  writeSession(home, { id: 's1', dirName: 'c1', log: makeLog({ id: 's1', batches: [[{ type: 'turn/start' }]] }) })

  const report = inventory(store, { home })
  assert.equal(report.sessions.length, 1)
  assert.equal(report.sessions[0].local, 'behind')
})

test('the host vocabulary is learned from the local sessions', (t) => {
  const { home } = setup(t)
  const sessionsRoot = path.join(home, 'sessions')
  fs.mkdirSync(sessionsRoot, { recursive: true })
  writeSession(home, { id: 'own', dirName: 'o1', log: makeLog({ id: 'own', batches: [[{ type: 'turn/start' }]] }) })
  const host = hostVocabulary({ sessionsRoot })
  assert.equal(host.scanned, 1)
  assert.ok(host.types.has('turn/start'))
  assert.equal(host.empty, false)
})
