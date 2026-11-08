import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildCatalog } from '../lib/catalog.js'
import { exportVault } from '../lib/export.js'
import { buildHandshake, checkCompatibility, compareVersions, formatVersionOf, parseVersion } from '../lib/handshake.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { PLUGIN_VERSION } from '../lib/version.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'm3-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-test' }

function setup(t) {
  const root = tempDir('keeper-m3-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  t.after(() => removeDir(root))
  return { root, home, dir, store: openStore(dir, PASS) }
}

test('versions compare the way a reader needs', () => {
  assert.equal(formatVersionOf('dsh-history-keeper/store/1'), 1)
  assert.equal(formatVersionOf('dsh-history-keeper/store/2'), 2)
  assert.equal(formatVersionOf('nonsense'), 0)
  assert.deepEqual(parseVersion('0.1.0-rc.9'), { major: 0, minor: 1, patch: 0, rc: 9 })
  assert.equal(parseVersion('nope'), null)
  assert.ok(compareVersions('0.1.0-rc.9', '0.1.0-rc.10') < 0, 'rc numbers compare numerically')
  assert.ok(compareVersions('0.1.0-rc.9', '0.1.0') < 0, 'a release is newer than its rc')
  assert.equal(compareVersions('0.1.0-rc.9', '0.1.0-rc.9'), 0)
})

test('a new vault declares who wrote it and the oldest reader it accepts', (t) => {
  const { store } = setup(t)
  assert.equal(store.meta.writer.plugin, PLUGIN_VERSION)
  assert.ok(store.meta.writer.at)
  assert.equal(store.meta.minReader.plugin, PLUGIN_VERSION)
  assert.equal(store.meta.minReader.format, 'dsh-history-keeper/store/1')

  const same = checkCompatibility(store.meta, PLUGIN_VERSION)
  assert.equal(same.ok, true)
  assert.deepEqual(same.warnings, [])
})

test('a reader older than the vault is warned, not silently accepted', (t) => {
  const { store } = setup(t)
  const older = checkCompatibility(store.meta, '0.1.0-rc.10')
  assert.equal(older.ok, true, 'the format is still readable')
  assert.equal(older.warnings[0].code, 'PLUGIN_OUTDATED')
  assert.match(older.warnings[0].message, new RegExp(PLUGIN_VERSION.replace(/\\./g, '\\\\.') + ' or newer'))
})

test('a format newer than this build is an error, not a guess', (t) => {
  const { store } = setup(t)
  const meta = { ...store.meta, minReader: { format: 'dsh-history-keeper/store/2', plugin: '0.1.0-rc.99' } }
  const result = checkCompatibility(meta, PLUGIN_VERSION)
  assert.equal(result.ok, false)
  assert.equal(result.errors[0].code, 'FORMAT_TOO_NEW')
})

test('the catalog organizes every conversation by workspace, turns and dates', (t) => {
  const { home, store } = setup(t)
  writeSession(home, {
    id: 's1',
    cwd: 'G:\\work\\alpha',
    log: makeLog({
      id: 's1',
      cwd: 'G:\\work\\alpha',
      batches: [
        [{ type: 'turn/start', data: { turn: 1 }, time: 1000 }],
        [{ type: 'assistant/message', data: { turn: 1, step: 1 }, time: 1500 }],
        [{ type: 'turn/end', data: { turn: 1 }, time: 2000 }],
        [{ type: 'turn/start', data: { turn: 2 }, time: 3000 }],
        [{ type: 'turn/end', data: { turn: 2 }, time: 4000 }],
      ],
    }),
  })
  snapshot(store, { home, now: '2026-11-07T10:00:00.000Z', device: DEVICE })

  const catalog = buildCatalog(store)
  assert.equal(catalog.totals.sessions, 1)
  const row = catalog.sessions[0]
  assert.equal(row.sessionId, 's1')
  assert.equal(row.workspace, 'G:\\work\\alpha')
  assert.equal(row.turns, 2)
  assert.equal(row.frames, 6, 'header plus five events')
  assert.equal(row.firstEventAt, new Date(1000).toISOString())
  assert.equal(row.lastEventAt, new Date(4000).toISOString())
  assert.equal(row.capturedBy, PLUGIN_VERSION)
  assert.equal(catalog.store.writer.plugin, PLUGIN_VERSION)
  assert.deepEqual(catalog.store.minReader, store.meta.minReader)
})

test('a downlevel export declares the target version, and refuses a target older than the vault', (t) => {
  const { root, home, store } = setup(t)
  writeSession(home, { id: 's1', cwd: 'C:\\work\\x', log: makeLog({ id: 's1', cwd: 'C:\\work\\x', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'turn/end', data: { turn: 1 }, time: 200 }]] }) })
  snapshot(store, { home, now: '2026-11-07T10:00:00.000Z', device: DEVICE })

  // Older than the vault requires: refused.
  assert.throws(
    () => exportVault({ store, passphrase: PASS, to: path.join(root, 'old'), downlevel: '0.1.0-rc.10' }),
    /cannot be declared readable by/,
  )

  // A target the vault is happy to be read by: the copy says so.
  const to = path.join(root, 'downlevel')
  const report = exportVault({ store, passphrase: PASS, to, downlevel: PLUGIN_VERSION, now: '2026-11-07T11:00:00.000Z' })
  assert.equal(report.verified.ok, true)
  const copy = openStore(path.join(to, 'vault'), PASS)
  assert.equal(copy.meta.writer.plugin, PLUGIN_VERSION)
  assert.equal(copy.meta.writer.downlevelFrom, PLUGIN_VERSION)
  assert.equal(copy.meta.downlevel.to, PLUGIN_VERSION)
  assert.equal(checkCompatibility(copy.meta, PLUGIN_VERSION).ok, true)
})

test('buildHandshake is what initStore writes', () => {
  const handshake = buildHandshake('0.1.0-rc.39')
  assert.equal(handshake.writer.plugin, '0.1.0-rc.39')
  assert.equal(handshake.minReader.format, 'dsh-history-keeper/store/1')
})
