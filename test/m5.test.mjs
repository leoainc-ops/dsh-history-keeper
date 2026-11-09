import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { autoImport, resolveVaultDir, stageIncoming, undoImport } from '../lib/autoimport.js'
import { incomingPath, readJournal } from '../lib/journal.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'm5-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-local' }
const OTHER = { deviceId: 'bb'.repeat(16), deviceName: 'pc-other' }

function setup(t) {
  const root = tempDir('keeper-m5-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-local' })
  const store = openStore(dir, PASS)
  writeSession(home, { id: 'local', cwd: 'C:\\work\\local', log: makeLog({ id: 'local', cwd: 'C:\\work\\local', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'turn/end', data: { turn: 1 }, time: 200 }]] }) })
  snapshot(store, { home, now: '2026-11-08T10:00:00.000Z', device: DEVICE })
  t.after(() => removeDir(root))
  return { root, home, dir, store }
}

/** Build a second vault with one session the local one does not have, and drop it in the box. */
function bringVault(t, { home, root }, extra = {}) {
  const otherHome = path.join(root, 'other-home')
  fs.mkdirSync(otherHome, { recursive: true })
  const otherDir = path.join(root, 'vault-other')
  initStore(otherDir, { passphrase: extra.passphrase ?? PASS, deviceName: 'pc-other' })
  const other = openStore(otherDir, extra.passphrase ?? PASS)
  writeSession(otherHome, { id: 'remote', cwd: 'C:\\work\\remote', log: makeLog({ id: 'remote', cwd: 'C:\\work\\remote', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 300 }], [{ type: 'turn/end', data: { turn: 1 }, time: 400 }]] }) })
  snapshot(other, { home: otherHome, now: '2026-11-08T11:00:00.000Z', device: OTHER })
  const incoming = incomingPath(home)
  fs.mkdirSync(path.dirname(incoming), { recursive: true })
  fs.cpSync(otherDir, incoming, { recursive: true })
  return { otherHome, otherDir, incoming }
}

test('an import at start merges, restores and leaves an undo window', (t) => {
  const setupData = setup(t)
  const { home, store } = setupData
  const { incoming } = bringVault(t, setupData)
  assert.equal(fs.existsSync(path.join(incoming, 'meta.json')), true)

  const report = autoImport({ home, store, passphrase: PASS, device: DEVICE, now: '2026-11-08T12:00:00.000Z' })
  assert.equal(report.status, 'imported')
  assert.equal(report.changed, true)
  assert.equal(report.merged.sessions, 2)
  assert.deepEqual(report.restored.created.map((item) => item.sessionId), ['remote'])
  assert.equal(verifyStore(store).ok, true)
  assert.equal(verifyStore(store).totals.sessions, 2)

  // The session is on disk for the host, and the drop box was moved aside.
  const journal = readJournal(home)
  const restoredPath = journal.sessionsCreated[0].file
  assert.equal(fs.existsSync(restoredPath), true)
  assert.equal(fs.existsSync(incoming), false)
  // The staged copy is deleted on success: the vault now holds everything it carried.
  assert.equal(fs.readdirSync(home).some((name) => name.startsWith('history-keeper.incoming')), false)

  assert.equal(journal.armed, true)
  assert.equal(journal.sessionsCreated.length, 1)
  assert.equal(journal.sessionsCreated[0].sessionId, 'remote')
})

test('a second start does not import again while the undo is open', (t) => {
  const setupData = setup(t)
  const { home, store } = setupData
  bringVault(t, setupData)
  autoImport({ home, store, passphrase: PASS, device: DEVICE, now: '2026-11-08T12:00:00.000Z' })

  // Someone drops another vault while the window is still open.
  const otherDir = path.join(setupData.root, 'vault-other')
  const incoming = incomingPath(home)
  fs.cpSync(otherDir, incoming, { recursive: true })
  const again = autoImport({ home, store, passphrase: PASS, device: DEVICE, now: '2026-11-08T12:05:00.000Z' })
  assert.equal(again.status, 'waiting')
  assert.match(again.reason, /still undoable/)
})

test('undo removes exactly what the import put on this machine', (t) => {
  const setupData = setup(t)
  const { home, store } = setupData
  bringVault(t, setupData)
  autoImport({ home, store, passphrase: PASS, device: DEVICE, now: '2026-11-08T12:00:00.000Z' })

  const journal = readJournal(home)
  const restoredPath = journal.sessionsCreated[0].file
  const sessionsDir = path.join(home, 'sessions')
  const others = fs.readdirSync(sessionsDir).filter((name) => name !== path.basename(restoredPath))
  assert.equal(fs.existsSync(restoredPath), true)

  const undone = undoImport({ home, now: '2026-11-08T12:10:00.000Z' })
  assert.equal(undone.status, 'undone')
  assert.equal(undone.removed.length, 1)
  assert.equal(fs.existsSync(restoredPath), false, 'the imported session is gone')
  assert.ok(others.length > 0)
  for (const name of others) assert.equal(fs.existsSync(path.join(sessionsDir, name)), true, 'what was already there is untouched')
  assert.equal(readJournal(home).armed, false)

  const again = undoImport({ home, now: '2026-11-08T12:11:00.000Z' })
  assert.equal(again.status, 'refused')
  assert.match(again.reason, /window closed/)
})

test('the import refuses a vault that does not open with this passphrase', (t) => {
  const setupData = setup(t)
  const { home, store } = setupData
  bringVault(t, setupData, { passphrase: 'another-passphrase-entirely' })
  const report = autoImport({ home, store, passphrase: PASS, device: DEVICE })
  assert.equal(report.status, 'refused')
  assert.match(report.reason, /does not open with this passphrase/)
  assert.equal(verifyStore(store).totals.sessions, 1, 'the local vault is untouched')
})

test('the import refuses a vault that does not verify', (t) => {
  const setupData = setup(t)
  const { home, store } = setupData
  const { incoming } = bringVault(t, setupData)
  const objects = path.join(incoming, 'objects')
  const victim = fs.readdirSync(objects)[0]
  const bytes = fs.readFileSync(path.join(objects, victim))
  bytes[bytes.length - 1] ^= 0xff
  fs.writeFileSync(path.join(objects, victim), bytes)

  const report = autoImport({ home, store, passphrase: PASS, device: DEVICE })
  assert.equal(report.status, 'refused')
  assert.match(report.reason, /does not verify/)
})

test('staging leaves a verified vault for the next start', (t) => {
  const setupData = setup(t)
  const { home } = setupData
  const { otherDir } = bringVault(t, setupData)
  fs.rmSync(incomingPath(home), { recursive: true, force: true })

  const report = stageIncoming({ home, from: otherDir, passphrase: PASS })
  assert.equal(report.status, 'staged')
  assert.equal(fs.existsSync(path.join(report.incoming, 'meta.json')), true)
  assert.equal(verifyStore(openStore(report.incoming, PASS)).ok, true)

  // The box is not a pile: the same vault is reused, not copied again.
  const again = stageIncoming({ home, from: otherDir, passphrase: PASS })
  assert.equal(again.status, 'reused')
})

test('a pendrive folder that contains vault/ works as --from', (t) => {
  const setupData = setup(t)
  const { home, root } = setupData
  const { otherDir } = bringVault(t, setupData)
  fs.rmSync(incomingPath(home), { recursive: true, force: true })

  // The shape the operator actually has: F:\keeper-transfer\vault
  const stick = path.join(root, 'stick')
  fs.mkdirSync(stick, { recursive: true })
  fs.cpSync(otherDir, path.join(stick, 'vault'), { recursive: true })

  assert.equal(resolveVaultDir(stick), path.join(stick, 'vault'))
  assert.equal(resolveVaultDir(path.join(stick, 'vault')), path.join(stick, 'vault'))
  assert.throws(() => resolveVaultDir(path.join(root, 'nowhere')), /no vault at/)

  const report = stageIncoming({ home, from: stick, passphrase: PASS })
  assert.equal(report.status, 'staged')
  // Staging the same vault again reuses the box instead of refusing.
  const again = stageIncoming({ home, from: stick, passphrase: PASS })
  assert.equal(again.status, 'reused')
})