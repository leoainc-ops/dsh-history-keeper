import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { MIN_PASSPHRASE_LENGTH, initVault, openVault } from '../core/vault.js'

const workspace = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-vault-'))

/** Every file under a directory with its sha256, to prove that nothing was written. */
function snapshot(dir) {
  const files = {}
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      const key = prefix ? prefix + '/' + entry.name : entry.name
      if (entry.isDirectory()) walk(full, key)
      else files[key] = createHash('sha256').update(fs.readFileSync(full)).digest('hex')
    }
  }
  walk(dir, '')
  return files
}

test('initVault refuses to create anything without an explicit passphrase', () => {
  const dir = path.join(workspace(), 'vault')
  assert.throws(
    () => initVault(dir, {}),
    (error) => error.code === 'PASSPHRASE_REQUIRED',
  )
  assert.equal(fs.existsSync(dir), false, 'no directory was created')
})

test('initVault rejects a passphrase shorter than the minimum before writing', () => {
  const dir = path.join(workspace(), 'vault')
  assert.throws(
    () => initVault(dir, { passphrase: 'short' }),
    (error) => error.code === 'PASSPHRASE_TOO_SHORT',
  )
  assert.equal(fs.existsSync(dir), false, 'no directory was created')
  assert.equal(MIN_PASSPHRASE_LENGTH, 8)
})

test('initVault creates a vault that openVault opens with the same phrase', () => {
  const dir = path.join(workspace(), 'vault')
  const created = initVault(dir, { passphrase: 'correct horse battery', deviceName: 'vault-test' })
  assert.equal(created.meta.format, 'dsh-history-keeper/store/1')
  const opened = openVault(dir, 'correct horse battery')
  assert.equal(opened.meta.storeId, created.meta.storeId)
})

test('openVault with a wrong passphrase fails closed and writes nothing', () => {
  const dir = path.join(workspace(), 'vault')
  initVault(dir, { passphrase: 'correct horse battery', deviceName: 'vault-test' })
  const before = snapshot(dir)
  assert.throws(
    () => openVault(dir, 'not the phrase'),
    (error) => error.code === 'WRONG_PASSPHRASE',
  )
  assert.deepEqual(snapshot(dir), before, 'the directory is byte-identical after the refusal')
})

test('openVault without a passphrase refuses before reading the vault', () => {
  const dir = path.join(workspace(), 'vault')
  initVault(dir, { passphrase: 'correct horse battery', deviceName: 'vault-test' })
  assert.throws(
    () => openVault(dir, ''),
    (error) => error.code === 'PASSPHRASE_REQUIRED',
  )
})
