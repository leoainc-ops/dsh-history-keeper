import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { exportVault } from '../lib/export.js'
import { importVault } from '../lib/import.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const LOCAL = 'local-passphrase-1234'
const REMOTE = 'remote-passphrase-1234'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-local' }

function build(t) {
  const root = tempDir('keeper-import-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })

  // This machine: one session.
  const localDir = path.join(root, 'vault-local')
  initStore(localDir, { passphrase: LOCAL, deviceName: 'pc-local' })
  const localStore = openStore(localDir, LOCAL)
  writeSession(home, { id: 'shared', log: makeLog({ id: 'shared', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  snapshot(localStore, { home, now: '2026-11-03T10:00:00.000Z', device: DEVICE })

  // The other machine: the same shared session and one of its own.
  const otherHome = path.join(root, 'other-home')
  fs.mkdirSync(otherHome, { recursive: true })
  const remoteDir = path.join(root, 'vault-remote')
  initStore(remoteDir, { passphrase: REMOTE, deviceName: 'pc-remote' })
  const remoteStore = openStore(remoteDir, REMOTE)
  writeSession(otherHome, { id: 'shared', log: makeLog({ id: 'shared', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  writeSession(otherHome, { id: 'only-remote', log: makeLog({ id: 'only-remote', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  snapshot(remoteStore, { home: otherHome, now: '2026-11-03T11:00:00.000Z', device: { deviceId: 'bb'.repeat(16), deviceName: 'pc-remote' } })

  const stick = path.join(root, 'stick')
  exportVault({ store: remoteStore, passphrase: REMOTE, to: stick, now: '2026-11-03T12:00:00.000Z' })

  t.after(() => removeDir(root))
  return { root, home, localStore, remoteStore, stick }
}

function objects(store) {
  return fs.readdirSync(path.join(store.dir, 'objects')).filter((name) => name.endsWith('.bin')).length
}

test('import brings the carried vault in place, without copying the local one', (t) => {
  const { localStore, stick } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)

  const before = objects(localStore)
  const vaultBytesBefore = fs.statSync(path.join(localStore.dir, 'meta.json')).size // sanity: the vault exists
  assert.ok(vaultBytesBefore > 0)

  const report = importVault({
    stickStore,
    localStore,
    localPassphrase: LOCAL,
    stickPassphrase: REMOTE,
    device: DEVICE,
    now: '2026-11-03T13:00:00.000Z',
  })

  assert.equal(report.merge.sessions, 2)
  assert.equal(verifyStore(localStore).ok, true, JSON.stringify(report.merge.verification.problems))
  assert.equal(verifyStore(localStore).totals.sessions, 2, 'the local vault now holds both')
  // Only the genuinely new bytes are sealed: the shared session was not sealed again.
  assert.equal(report.merge.sealedChunks, 1, 'one new chunk for the new session')
  assert.equal(report.merge.reusedChunks, 1, 'the shared session chunk was reused')
  assert.equal(objects(localStore), before + 2, 'one new chunk and one manifest: nothing else is copied')
  // No prepared copy, no replaced copy: the import happened in place.
  assert.equal(fs.readdirSync(path.dirname(localStore.dir)).some((name) => name.includes('.new-')), false)
  assert.equal(fs.readdirSync(path.dirname(localStore.dir)).some((name) => name.includes('.replaced-')), false)
})

test('importing the same carried vault twice changes nothing', (t) => {
  const { localStore, stick } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, device: DEVICE, now: '2026-11-03T13:00:00.000Z' })
  const afterFirst = objects(localStore)
  const bytesFirst = verifyStore(localStore).totals.bytes

  importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, device: DEVICE, now: '2026-11-03T14:00:00.000Z' })
  assert.equal(objects(localStore), afterFirst, 'no object is created by a no-op import')
  assert.equal(verifyStore(localStore).totals.bytes, bytesFirst)
})

test('import restores only the sessions this home lacks, byte-exact', (t) => {
  const { localStore, stick, home } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)

  const report = importVault({
    stickStore,
    localStore,
    localPassphrase: LOCAL,
    stickPassphrase: REMOTE,
    home,
    device: DEVICE,
    now: '2026-11-03T13:00:00.000Z',
  })

  const created = report.restored.created.map((item) => item.sessionId)
  assert.deepEqual(created, ['only-remote'], 'only the new session is created')
  assert.deepEqual(report.restored.identical, ['shared'], 'the shared one is already identical')
  assert.equal(report.restored.problems.length, 0)
})

test('a dry run reports the plan and writes nothing', (t) => {
  const { localStore, stick } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  const before = objects(localStore)
  const report = importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, device: DEVICE, dryRun: true })
  assert.equal(report.dryRun, true)
  assert.equal(report.merge.sealedChunks, 1)
  assert.equal(objects(localStore), before, 'nothing was written')
  assert.equal(verifyStore(localStore).totals.sessions, 1)
})

test('import refuses a carried vault that does not verify and leaves everything alone', (t) => {
  const { localStore, stick } = build(t)
  const objectsDir = path.join(stick, 'vault', 'objects')
  const victim = fs.readdirSync(objectsDir)[0]
  const file = path.join(objectsDir, victim)
  const bytes = fs.readFileSync(file)
  bytes[bytes.length - 1] ^= 0xff
  fs.writeFileSync(file, bytes)

  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  assert.throws(
    () => importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, device: DEVICE }),
    /does not verify/,
  )
  assert.equal(verifyStore(localStore).totals.sessions, 1, 'the local vault is untouched')
})
