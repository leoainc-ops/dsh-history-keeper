import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildCatalog } from '../lib/catalog.js'
import { planUpgrade, upgradeVault } from '../lib/upgrade.js'
import { initStore, openStore } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { PLUGIN_VERSION } from '../lib/version.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'upgrade-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-test' }

/** A vault as an older build left it: no handshake, no retention, with history in it. */
function legacyVault(t) {
  const root = tempDir('keeper-upgrade-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)
  writeSession(home, { id: 's1', cwd: 'C:\\work\\up', log: makeLog({ id: 's1', cwd: 'C:\\work\\up', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'turn/end', data: { turn: 1 }, time: 200 }]] }) })
  snapshot(store, { home, now: '2026-11-08T10:00:00.000Z', device: DEVICE })

  // Strip what a pre-handshake build did not write.
  const metaPath = path.join(dir, 'meta.json')
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  delete meta.writer
  delete meta.minReader
  delete meta.retention
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')

  t.after(() => removeDir(root))
  return { root, dir, metaPath, store: openStore(dir, PASS) }
}

test('an older vault gets the handshake and retention without touching its history', (t) => {
  const { dir, store } = legacyVault(t)
  const before = verifyStore(store)
  const objectsBefore = fs.readdirSync(path.join(dir, 'objects')).length

  const report = upgradeVault(store, { now: '2026-11-08T12:00:00.000Z' })
  assert.equal(report.status, 'upgraded')
  assert.deepEqual(report.changes, ['writer', 'minReader', 'retention'])
  assert.ok(report.backup && fs.existsSync(report.backup), 'the previous meta is kept next to the vault')

  const upgraded = openStore(dir, PASS)
  assert.equal(upgraded.meta.writer.plugin, PLUGIN_VERSION)
  assert.equal(upgraded.meta.writer.origin, 'upgrade')
  assert.equal(upgraded.meta.minReader.plugin, PLUGIN_VERSION)
  assert.equal(upgraded.meta.retention.autoGc, true)
  assert.equal(upgraded.meta.upgrades.length, 1)
  assert.deepEqual(upgraded.meta.upgrades[0].changes, ['writer', 'minReader', 'retention'])

  // History: same objects, same bytes, still verifies.
  assert.equal(fs.readdirSync(path.join(dir, 'objects')).length, objectsBefore, 'no object was written or removed')
  const after = verifyStore(upgraded)
  assert.equal(after.ok, true, JSON.stringify(after.problems))
  assert.equal(after.totals.bytes, before.totals.bytes)
  assert.equal(after.totals.frames, before.totals.frames)

  // The catalog now answers who wrote it.
  const catalog = buildCatalog(upgraded)
  assert.equal(catalog.store.writer.plugin, PLUGIN_VERSION)
  assert.equal(catalog.store.minReader.plugin, PLUGIN_VERSION)
})

test('a second upgrade is a no-op', (t) => {
  const { store } = legacyVault(t)
  upgradeVault(store, { now: '2026-11-08T12:00:00.000Z' })
  const again = upgradeVault(store, { now: '2026-11-08T12:10:00.000Z' })
  assert.equal(again.status, 'current')
  assert.deepEqual(again.changes, [])
})

test('a dry run reports the plan and writes nothing', (t) => {
  const { dir, metaPath, store } = legacyVault(t)
  const before = fs.readFileSync(metaPath, 'utf8')
  const report = upgradeVault(store, { dryRun: true, now: '2026-11-08T12:00:00.000Z' })
  assert.equal(report.status, 'planned')
  assert.deepEqual(report.changes, ['writer', 'minReader', 'retention'])
  assert.equal(fs.readFileSync(metaPath, 'utf8'), before)
  assert.equal(fs.readdirSync(dir).some((name) => name.includes('.before-upgrade-')), false)
})

test('retention can be left out on purpose', (t) => {
  const { store } = legacyVault(t)
  upgradeVault(store, { retention: false, now: '2026-11-08T12:00:00.000Z' })
  const upgraded = openStore(store.dir, PASS)
  assert.equal(upgraded.meta.retention, undefined, 'the operator decides when the space policy changes')
  assert.equal(upgraded.meta.writer.plugin, PLUGIN_VERSION)
})

test('planUpgrade refuses a vault that asks for a newer format', () => {
  const plan = planUpgrade(
    { format: 'dsh-history-keeper/store/2', minReader: { format: 'dsh-history-keeper/store/2', plugin: '0.1.0-rc.99' } },
    { version: PLUGIN_VERSION },
  )
  assert.equal(plan.ok, false)
  assert.match(plan.error, /requires format/)
})
