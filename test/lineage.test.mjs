import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { backupVault, verifyBackup } from '../lib/backup.js'
import { lastEventAt, lineageReport } from '../lib/lineage.js'
import { mergeStores } from '../lib/merge.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'lineage-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-lineage-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  t.after(() => removeDir(root))
  return { root, home, dir, store: openStore(dir, PASS) }
}

test('lastEventAt reads the time of the last event, not the header', () => {
  const buffer = makeLog({ id: 's1', batches: [[{ type: 'a', time: 111 }], [{ type: 'b', time: 222 }]] })
  assert.equal(lastEventAt(buffer), 222)
  const headerOnly = makeLog({ id: 's2', batches: [] })
  assert.equal(lastEventAt(headerOnly), null)
})

test('a linear session is not reported as continued', (t) => {
  const { home, store } = setup(t)
  writeSession(home, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'a', time: 111 }]] }) })
  snapshot(store, { home, now: '2026-11-02T10:00:00.000Z', device: { deviceId: 'a'.repeat(32), deviceName: 'pc-a' } })

  const report = lineageReport(store)
  assert.equal(report.totals.linear, 1)
  assert.equal(report.totals.continued, 0)
  assert.equal(report.sessions[0].state, 'linear')
  assert.equal(report.sessions[0].visibleIsNewest, true)
})

test('a diverged session is reported as continued, with the newest lineage flagged', (t) => {
  const { root, store } = setup(t)
  const homeB = path.join(root, 'home-b')
  fs.mkdirSync(homeB, { recursive: true })
  const deviceA = { deviceId: 'a'.repeat(32), deviceName: 'pc-a' }
  const deviceB = { deviceId: 'b'.repeat(32), deviceName: 'pc-b' }

  // A introduces the session; B continues it later with a different tail.
  writeSession(homeB, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'a', time: 100 }], [{ type: 'b', time: 200 }]] }) })
  snapshot(store, { home: homeB, now: '2026-11-02T10:00:00.000Z', device: deviceA })

  const dirB = path.join(root, 'vault-b')
  initStore(dirB, { passphrase: PASS, deviceName: 'pc-b' })
  const storeB = openStore(dirB, PASS)
  writeSession(homeB, { id: 's1', dirName: 'b', log: makeLog({ id: 's1', batches: [[{ type: 'a', time: 100 }], [{ type: 'c', time: 900 }]] }) })
  snapshot(storeB, { home: homeB, now: '2026-11-02T10:05:00.000Z', device: deviceB })

  const merged = mergeStores([store, storeB], { outDir: path.join(root, 'merged'), passphrase: PASS })
  assert.equal(merged.archived.length, 1, 'the merge archives the non-owner side')
  const mergedStore = openStore(path.join(root, 'merged'), PASS)

  const report = lineageReport(mergedStore)
  assert.equal(report.totals.continued, 1)
  const row = report.sessions.find((item) => item.sessionId === 's1')
  assert.equal(row.state, 'continued')
  assert.equal(row.lineages, 2)
  assert.equal(row.visible.lastEventAt, 200)
  assert.equal(row.continuations[0].lastEventAt, 900)
  assert.equal(row.visibleIsNewest, false, 'the archived side is newer, and the report says so')
})

test('backup copies, hashes and verifies a vault, and proves the copy later', (t) => {
  const { root, home, store } = setup(t)
  writeSession(home, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'a', time: 111 }]] }) })
  snapshot(store, { home, now: '2026-11-02T10:00:00.000Z', device: { deviceId: 'c'.repeat(32), deviceName: 'pc-c' } })

  const to = path.join(root, 'backup')
  const report = backupVault({ dir: store.dir, passphrase: PASS, to, now: '2026-11-02T11:00:00.000Z' })
  assert.equal(report.verified.ok, true)
  assert.equal(report.verified.sessions, 1)
  assert.ok(report.files > 0)
  assert.ok(fs.existsSync(report.manifestPath))

  const check = verifyBackup(to, report.manifestPath)
  assert.equal(check.ok, true)
  assert.equal(check.missing.length, 0)
  assert.equal(check.changed.length, 0)

  // A single flipped byte in the copy must be detected.
  const victim = path.join(to, 'meta.json')
  const bytes = fs.readFileSync(victim)
  bytes[bytes.length - 2] ^= 0x01
  fs.writeFileSync(victim, bytes)
  const after = verifyBackup(to, report.manifestPath)
  assert.equal(after.ok, false)
  assert.deepEqual(after.changed, ['meta.json'])
})

test('backup refuses to overwrite a destination that is not empty', (t) => {
  const { root, home, store } = setup(t)
  writeSession(home, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'a', time: 111 }]] }) })
  snapshot(store, { home, now: '2026-11-02T10:00:00.000Z' })
  const to = path.join(root, 'backup')
  backupVault({ dir: store.dir, passphrase: PASS, to })
  assert.throws(() => backupVault({ dir: store.dir, passphrase: PASS, to }), /not empty/)
})
