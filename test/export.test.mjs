import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { exportVault } from '../lib/export.js'
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
  assert.ok(second.copy.replaced && fs.existsSync(second.copy.replaced), 'the previous copy is kept aside')
  assert.notEqual(first.receiptPath, second.receiptPath)
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
