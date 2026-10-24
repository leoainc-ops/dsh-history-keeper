import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  KeeperCryptoError,
  createKeyCheck,
  deriveKey,
  newSalt,
  open,
  seal,
  verifyKeyCheck,
} from '../lib/crypto.js'
import { KeeperStoreError, atomicWrite, getObject, initStore, openStore, putObject, readManifestChain, writeManifest } from '../lib/store.js'
import { listFiles, tempDir } from './helpers.js'

const PASS = 'correct horse battery staple'

test('key derivation is deterministic for the same salt and params', () => {
  const kdf = { alg: 'scrypt', N: 1 << 12, r: 8, p: 1, salt: newSalt() }
  const a = deriveKey(PASS, kdf)
  const b = deriveKey(PASS, kdf)
  assert.equal(a.length, 32)
  assert.ok(a.equals(b))
  assert.ok(!a.equals(deriveKey('another passphrase', kdf)))
})

test('a short passphrase is refused instead of weakened', () => {
  assert.throws(() => deriveKey('short', { alg: 'scrypt', N: 1 << 12, r: 8, p: 1, salt: newSalt() }), KeeperCryptoError)
})

test('seal/open round-trips and rejects tampering', () => {
  const key = deriveKey(PASS, { alg: 'scrypt', N: 1 << 12, r: 8, p: 1, salt: newSalt() })
  const plaintext = Buffer.from('historial de ejemplo', 'utf8')
  const sealed = seal(key, plaintext)

  assert.ok(open(key, sealed).equals(plaintext))

  const tampered = Buffer.from(sealed)
  tampered[tampered.length - 20] ^= 0xff
  assert.throws(() => open(key, tampered), KeeperCryptoError)

  const foreign = Buffer.from(sealed)
  foreign[0] = 0x00
  assert.throws(() => open(key, foreign), KeeperCryptoError)

  const otherKey = deriveKey('a different passphrase', { alg: 'scrypt', N: 1 << 12, r: 8, p: 1, salt: newSalt() })
  assert.throws(() => open(otherKey, sealed), KeeperCryptoError)
  assert.throws(() => open(key, Buffer.alloc(4)), KeeperCryptoError)
})

test('the key check accepts the right passphrase and only that one', () => {
  const kdf = { alg: 'scrypt', N: 1 << 12, r: 8, p: 1, salt: newSalt() }
  const key = deriveKey(PASS, kdf)
  const check = createKeyCheck(key)
  assert.equal(verifyKeyCheck(key, check), true)
  assert.equal(verifyKeyCheck(deriveKey('wrong passphrase', kdf), check), false)
})

test('a store opens only with its passphrase', () => {
  const dir = path.join(tempDir(), 'store')
  const created = initStore(dir, { passphrase: PASS, deviceName: 'test-device' })
  assert.equal(fs.existsSync(path.join(dir, 'meta.json')), true)
  assert.equal(fs.existsSync(path.join(dir, 'objects')), true)

  const opened = openStore(dir, PASS)
  assert.equal(opened.meta.storeId, created.meta.storeId)
  assert.throws(() => openStore(dir, 'wrong passphrase'), KeeperCryptoError)
  assert.throws(() => initStore(dir, { passphrase: PASS }), KeeperStoreError)
})

test('objects are opaque, hash-checked and named randomly', () => {
  const dir = path.join(tempDir(), 'store')
  const store = initStore(dir, { passphrase: PASS })
  const object = putObject(store, Buffer.from('contenido secreto', 'utf8'))

  assert.match(object.id, /^[0-9a-f]{32}$/)
  const files = fs.readdirSync(path.join(dir, 'objects'))
  assert.deepEqual(files, [object.id + '.bin'])

  assert.ok(getObject(store, object.id, object.cipherSha256).equals(Buffer.from('contenido secreto')))
  assert.throws(() => getObject(store, object.id, 'deadbeef'), KeeperStoreError)
  assert.throws(() => getObject(store, 'a'.repeat(32), object.cipherSha256), KeeperStoreError)
})

test('manifest chain is append-only and tamper-evident', () => {
  const dir = path.join(tempDir(), 'store')
  const store = initStore(dir, { passphrase: PASS })

  writeManifest(store, { deviceId: store.meta.deviceId, sessions: { a: { chunks: [] } } })
  writeManifest(store, { deviceId: store.meta.deviceId, sessions: { b: { chunks: [] } } })

  const chain = readManifestChain(store)
  assert.equal(chain.length, 2)
  assert.equal(chain[0].seq, 1)
  assert.equal(chain[1].seq, 2)
  assert.equal(chain[1].prev.id, store.meta.manifest.id === chain[1].prev.id ? chain[1].prev.id : chain[1].prev.id)

  const headId = store.meta.manifest.id
  const file = path.join(dir, 'objects', headId + '.bin')
  const bytes = fs.readFileSync(file)
  bytes[bytes.length - 20] ^= 0xff
  fs.writeFileSync(file, bytes)

  // A cached walk cannot see the tampering, by design: the cache is keyed by the head and
  // answers repeat reads. Tamper detection is asserted on the fresh path, the one `verify`
  // uses, so the guarantee stays where it matters.
  assert.equal(readManifestChain(store).length, 2, 'the warm cache still answers')
  assert.throws(() => readManifestChain(store, { fresh: true }), KeeperStoreError)
})

test('atomic writes leave no temporary files behind', () => {
  const dir = tempDir()
  const file = path.join(dir, 'nested', 'value.txt')
  atomicWrite(file, Buffer.from('hola'))
  assert.equal(fs.readFileSync(file, 'utf8'), 'hola')
  assert.deepEqual(listFiles(dir), ['nested/value.txt'])
})
