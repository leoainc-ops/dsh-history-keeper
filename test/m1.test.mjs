import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { compact, collectGarbage } from '../lib/compact.js'
import { compareDestination, exportVault } from '../lib/export.js'
import { mergeStores } from '../lib/merge.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { collectSessions, verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'm1-test-passphrase'

function objects(store) {
  return fs.readdirSync(path.join(store.dir, 'objects')).filter((name) => name.endsWith('.bin')).length
}

test('gc keeps the chunks of archived continuations', (t) => {
  const root = tempDir('keeper-m1-gc-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const deviceA = { deviceId: 'a'.repeat(32), deviceName: 'pc-a' }
  const deviceB = { deviceId: 'b'.repeat(32), deviceName: 'pc-b' }

  // A introduces the session, B continues it differently: merging archives B's lineage.
  const dirA = path.join(root, 'a')
  initStore(dirA, { passphrase: PASS, deviceName: 'pc-a' })
  const storeA = openStore(dirA, PASS)
  writeSession(home, { id: 's1', cwd: 'C:\\work\\x', log: makeLog({ id: 's1', cwd: 'C:\\work\\x', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'only-a', time: 200 }]] }) })
  snapshot(storeA, { home, now: '2026-11-07T10:00:00.000Z', device: deviceA })

  const dirB = path.join(root, 'b')
  initStore(dirB, { passphrase: PASS, deviceName: 'pc-b' })
  const storeB = openStore(dirB, PASS)
  writeSession(home, { id: 's1', cwd: 'C:\\work\\x', log: makeLog({ id: 's1', cwd: 'C:\\work\\x', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'only-b', time: 900 }]] }) })
  snapshot(storeB, { home, now: '2026-11-07T10:05:00.000Z', device: deviceB })

  const dir = path.join(root, 'merged')
  mergeStores([storeA, storeB], { outDir: dir, passphrase: PASS })
  const store = openStore(dir, PASS)
  assert.equal(verifyStore(store).totals.archived, 1)

  const before = verifyStore(store)
  const archivedBytes = before.totals.bytes
  const report = collectGarbage(store, { dryRun: false, yes: true })
  assert.equal(report.deleted, 0, 'nothing reachable is deleted: ' + JSON.stringify(report))

  const after = verifyStore(store)
  assert.equal(after.ok, true, JSON.stringify(after.problems))
  assert.equal(after.totals.archived, 1, 'the archive survived the gc')
  assert.equal(after.totals.bytes, archivedBytes)
  const { archived } = collectSessions(store)
  assert.equal(archived.size, 1, 'the archived lineage is still readable end to end')
})

test('compaction reclaims the manifests it replaced, and the vault still verifies', (t) => {
  const root = tempDir('keeper-m1-compact-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)
  const device = { deviceId: 'c'.repeat(32), deviceName: 'pc-test' }

  // Several snapshots of a growing session: one manifest each, all reachable.
  const batches = []
  for (let round = 0; round < 6; round += 1) {
    batches.push([{ type: 'round/' + round, time: 100 + round }])
    writeSession(home, { id: 's1', cwd: 'C:\\work\\y', log: makeLog({ id: 's1', cwd: 'C:\\work\\y', batches }) })
    snapshot(store, { home, now: '2026-11-07T10:0' + round + ':00.000Z', device, force: true })
  }

  const before = objects(store)
  const result = compact(store, { device })
  assert.equal(result.compacted, true)
  assert.ok(result.reclaimed, 'compaction reclaims by itself when retention allows it')
  assert.ok(result.reclaimed.deleted > 0, 'the replaced manifests are gone: ' + JSON.stringify(result.reclaimed))

  const after = objects(store)
  assert.ok(after < before, 'objects: ' + before + ' -> ' + after)

  const verified = verifyStore(store)
  assert.equal(verified.ok, true, JSON.stringify(verified.problems))
  assert.equal(verified.totals.sessions, 1)
})

test('export refuses a destination that holds content this vault does not have', (t) => {
  const root = tempDir('keeper-m1-export-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })

  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-a' })
  const store = openStore(dir, PASS)
  writeSession(home, { id: 's1', cwd: 'C:\\work\\z', log: makeLog({ id: 's1', cwd: 'C:\\work\\z', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'one', time: 200 }]] }) })
  snapshot(store, { home, now: '2026-11-07T10:00:00.000Z' })

  const stick = path.join(root, 'stick')
  const first = exportVault({ store, passphrase: PASS, to: stick, now: '2026-11-07T10:01:00.000Z' })
  assert.equal(first.verified.ok, true)
  assert.equal(fs.existsSync(path.join(stick, 'vault', 'meta.json')), true)

  // The destination grows a session the local vault does not have.
  const destination = openStore(path.join(stick, 'vault'), PASS)
  writeSession(home, { id: 's2', cwd: 'C:\\work\\other', log: makeLog({ id: 's2', cwd: 'C:\\work\\other', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }]] }) })
  snapshot(destination, { home, now: '2026-11-07T10:02:00.000Z' })

  const comparison = compareDestination({ target: path.join(stick, 'vault'), passphrase: PASS, localStore: store })
  assert.equal(comparison.opens, true)
  assert.equal(comparison.externalNewer.length, 1)

  assert.throws(() => exportVault({ store, passphrase: PASS, to: stick }), /does not have/)
  const forced = exportVault({ store, passphrase: PASS, to: stick, replace: true, now: '2026-11-07T10:03:00.000Z' })
  assert.equal(forced.verified.ok, true)
  // By default the previous copy is not kept around.
  assert.equal(forced.copy.replaced, null)
  assert.equal(fs.readdirSync(stick).some((name) => name.includes('.replaced-')), false)
})
