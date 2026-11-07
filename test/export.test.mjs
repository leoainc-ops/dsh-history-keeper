import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { spawnSync } from 'node:child_process'

import { checkSpace, exportVault } from '../lib/export.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'export-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-export-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)
  writeSession(home, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  snapshot(store, { home, now: '2026-11-03T10:00:00.000Z', device: { deviceId: 'a'.repeat(32), deviceName: 'pc-test' } })
  t.after(() => removeDir(root))
  return { root, home, dir, store }
}

test('export copies the vault, verifies the copy and writes a receipt', (t) => {
  const { root, store } = setup(t)
  const keyFile = path.join(root, 'key.txt')
  fs.writeFileSync(keyFile, PASS + '\n')
  const to = path.join(root, 'stick')

  const report = exportVault({ store, passphrase: PASS, to, keyFile, pluginVersion: '0.1.0-test' })
  assert.equal(report.verified.ok, true)
  assert.equal(report.totals.sessions, 1)
  assert.equal(report.copy.files > 0, true)
  assert.ok(report.receiptPath && fs.existsSync(report.receiptPath), 'the receipt exists')
  assert.match(report.keyFingerprint, /^[0-9a-f]{16}$/)

  const receipt = JSON.parse(fs.readFileSync(report.receiptPath, 'utf8'))
  assert.equal(receipt.kind, 'keeper-carry')
  assert.equal(receipt.pluginVersion, '0.1.0-test')
  assert.equal(receipt.verified.ok, true)
  assert.equal(receipt.source.storeId, store.meta.storeId)
  assert.equal(fs.existsSync(path.join(to, 'vault', 'meta.json')), true)

  // The copy opens with the same passphrase: it is a usable vault, not just files.
  const copy = openStore(path.join(to, 'vault'), PASS)
  assert.equal(copy.meta.storeId, store.meta.storeId)
})

test('a second export replaces the previous copy instead of mixing two vaults', (t) => {
  const { root, store } = setup(t)
  const to = path.join(root, 'stick')
  const first = exportVault({ store, passphrase: PASS, to, now: '2026-11-03T10:00:00.000Z' })
  const second = exportVault({ store, passphrase: PASS, to, now: '2026-11-03T11:00:00.000Z' })
  assert.equal(first.copy.replaced, null)
  // Replaced, not kept: keeping the previous copy multiplied the size on every trip.
  assert.equal(second.copy.replaced, null)
  assert.equal(fs.readdirSync(to).some((name) => name.includes('.replaced-')), false)
  assert.notEqual(first.receiptPath, second.receiptPath)

  // An operator can still ask for it explicitly.
  const third = exportVault({ store, passphrase: PASS, to, now: '2026-11-03T12:00:00.000Z', keepReplaced: true })
  assert.ok(third.copy.replaced && fs.existsSync(third.copy.replaced), 'kept on request')
})

test('export refuses a vault that does not verify', (t) => {
  const { root, store } = setup(t)
  // Damage one object.
  const objects = path.join(store.dir, 'objects')
  const victim = fs.readdirSync(objects)[0]
  const file = path.join(objects, victim)
  const bytes = fs.readFileSync(file)
  bytes[bytes.length - 1] ^= 0xff
  fs.writeFileSync(file, bytes)

  const to = path.join(root, 'stick')
  assert.throws(() => exportVault({ store, passphrase: PASS, to }), /does not verify/)
  assert.equal(fs.existsSync(path.join(to, 'vault')), false, 'nothing was copied')
})

test('checkSpace demands a margin over the copy size', () => {
  assert.equal(checkSpace({ freeBytes: 1000, needBytes: 1000 }).ok, false, '105% of 1000 does not fit in 1000')
  assert.equal(checkSpace({ freeBytes: 2000, needBytes: 1000 }).ok, true)
  assert.equal(checkSpace({ freeBytes: 1000, needBytes: 1000, margin: 1 }).ok, true)
})

test('capabilities reports version, format and commands', () => {
  const cli = new URL('../bin/keeper.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const result = spawnSync(process.execPath, [cli, 'capabilities', '--json'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const caps = JSON.parse(result.stdout)
  assert.match(caps.version, /^\d+\.\d+\.\d+/)
  assert.equal(caps.format, 'dsh-history-keeper/store/1')
  for (const command of ['export', 'import', 'verify', 'restore', 'paths']) assert.ok(caps.commands.includes(command), command)
})
