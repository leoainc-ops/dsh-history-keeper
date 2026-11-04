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

function build(t) {
  const root = tempDir('keeper-import-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })

  // This machine: one session.
  const localDir = path.join(root, 'vault-local')
  initStore(localDir, { passphrase: LOCAL, deviceName: 'pc-local' })
  const localStore = openStore(localDir, LOCAL)
  writeSession(home, { id: 'shared', log: makeLog({ id: 'shared', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  snapshot(localStore, { home, now: '2026-11-03T10:00:00.000Z', device: { deviceId: 'aa'.repeat(16), deviceName: 'pc-local' } })

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

test('import prepares a merged vault without touching the live one', (t) => {
  const { home, localStore, stick } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  const report = importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE })
  assert.equal(report.swapped, false)
  assert.ok(fs.existsSync(report.prepared), 'the prepared vault exists')
  assert.equal(verifyStore(openStore(report.prepared, LOCAL)).ok, true)
  assert.equal(verifyStore(localStore).totals.sessions, 1, 'the live vault still has one session')
  assert.equal(report.merge.sessions, 2)
  assert.match(report.nextStep, /--swap/)
  void home
})

test('import --swap replaces the local vault, keeps the previous one and restores sessions', (t) => {
  const { home, localStore, stick } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  fs.mkdirSync(home, { recursive: true })

  const report = importVault({
    stickStore,
    localStore,
    localPassphrase: LOCAL,
    stickPassphrase: REMOTE,
    home,
    swap: true,
    now: '2026-11-03T13:00:00.000Z',
  })

  assert.equal(report.swapped, true)
  assert.ok(report.replaced && fs.existsSync(report.replaced), 'the previous vault is kept')
  const local = openStore(path.join(path.dirname(localStore.dir), 'vault-local'), LOCAL)
  assert.equal(verifyStore(local).ok, true)
  assert.equal(verifyStore(local).totals.sessions, 2)

  const created = report.restored.created.map((item) => item.sessionId)
  assert.deepEqual(created, ['only-remote'], 'only the new session is created')
  assert.deepEqual(report.restored.identical, ['shared'], 'the shared one is already identical')
  assert.equal(report.restored.problems.length, 0)
})

test('import refuses a carried vault that does not verify and leaves everything alone', (t) => {
  const { localStore, stick } = build(t)
  const objects = path.join(stick, 'vault', 'objects')
  const victim = fs.readdirSync(objects)[0]
  const file = path.join(objects, victim)
  const bytes = fs.readFileSync(file)
  bytes[bytes.length - 1] ^= 0xff
  fs.writeFileSync(file, bytes)

  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  assert.throws(
    () => importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE }),
    /does not verify/,
  )
  assert.equal(verifyStore(localStore).totals.sessions, 1, 'the local vault is untouched')
})
