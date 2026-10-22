import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { AEAD, isAeadAvailable, open, seal, verifyKeyCheck, createKeyCheck, deriveKey, newSalt } from '../lib/crypto.js'
import { initStore, openStore } from '../lib/store.js'
import { removeDir, tempDir } from './helpers.js'

const PASS = 'correct horse battery staple'

test('the default AEAD exists in this runtime', () => {
  // The plugin runs inside Electron (BoringSSL). chacha20-poly1305 is absent there, so
  // the default must be a cipher both runtimes expose. This test pins that choice.
  assert.equal(isAeadAvailable(AEAD), true, AEAD + ' must exist in the host runtime')
})

test('a new store records the AEAD and opens with it', (t) => {
  const dir = path.join(tempDir(), 'store')
  t.after(() => removeDir(path.dirname(dir)))
  initStore(dir, { passphrase: PASS, deviceName: 'aead-test' })

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'))
  assert.equal(meta.aead, AEAD)
  assert.ok(openStore(dir, PASS).meta.storeId)
})

test('an unknown AEAD is refused instead of guessed', (t) => {
  const dir = path.join(tempDir(), 'store')
  t.after(() => removeDir(path.dirname(dir)))
  initStore(dir, { passphrase: PASS, deviceName: 'aead-test' })

  const metaFile = path.join(dir, 'meta.json')
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
  meta.aead = 'rot13'
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2))

  assert.throws(() => openStore(dir, PASS), /unsupported AEAD/)
})

test('chacha20-poly1305 stays readable on runtimes that expose it', () => {
  if (!isAeadAvailable('chacha20-poly1305')) return
  const kdf = { alg: 'scrypt', N: 1 << 12, r: 8, p: 1, salt: newSalt() }
  const key = deriveKey(PASS, kdf)
  const sealed = seal(key, Buffer.from('legacy'), 'chacha20-poly1305')
  assert.equal(open(key, sealed, 'chacha20-poly1305').toString(), 'legacy')
  assert.equal(verifyKeyCheck(key, createKeyCheck(key, 'chacha20-poly1305'), 'chacha20-poly1305'), true)
})
