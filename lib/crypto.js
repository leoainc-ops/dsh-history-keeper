/**
 * Encryption primitives. Everything in a keeper store is sealed before it touches
 * the disk, and nothing ever degrades to plaintext: a missing key is an error, not a
 * fallback.
 *
 * Cipher choice is dictated by the host runtime, not by preference. The plugin runs
 * inside Electron, whose crypto comes from BoringSSL: `chacha20-poly1305` is NOT
 * exposed there (`crypto.getCiphers()` returns no chacha entries), while
 * `aes-256-gcm` is. A store sealed with a primitive the host cannot open looks
 * exactly like a wrong passphrase, so the AEAD is recorded per store and checked
 * against the running runtime before use.
 *
 *  - key derivation: scrypt (memory-hard, built into Node)
 *  - content encryption: AES-256-GCM by default (12-byte nonce, 16-byte tag)
 */
import { createCipheriv, createDecipheriv, getCiphers, randomBytes, scryptSync } from 'node:crypto'

const MAGIC = Buffer.from('DKO1', 'latin1')
const NONCE_LEN = 12
const TAG_LEN = 16
const KEY_CHECK_PLAINTEXT = Buffer.from('dsh-history-keeper/key-check/v1', 'latin1')

/** AEAD used for new stores. Must exist in BoringSSL (Electron) and OpenSSL (Node). */
export const AEAD = 'aes-256-gcm'

/** Every AEAD this module can read; new stores are written with {@link AEAD}. */
export const SUPPORTED_AEADS = Object.freeze(['aes-256-gcm', 'chacha20-poly1305'])

/** Default KDF parameters. Stored in meta.json so a store stays readable forever. */
export const DEFAULT_KDF = Object.freeze({ alg: 'scrypt', N: 1 << 15, r: 8, p: 1, keyLen: 32 })

/** Crypto failure that must always fail closed. */
export class KeeperCryptoError extends Error {
  constructor(message) {
    super(message)
    this.name = 'KeeperCryptoError'
  }
}

/**
 * Whether this runtime exposes an AEAD by name.
 * @param {string} aead
 * @returns {boolean}
 */
export function isAeadAvailable(aead) {
  try {
    return getCiphers().includes(aead)
  } catch {
    return false
  }
}

/** @returns {string} base64 salt for a new store */
export function newSalt() {
  return randomBytes(16).toString('base64')
}

/**
 * Derive the store key from a passphrase.
 * @param {string} passphrase
 * @param {{alg?: string, salt: string, N: number, r: number, p: number, keyLen?: number}} kdf
 * @returns {Buffer} 32-byte key
 */
export function deriveKey(passphrase, kdf) {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new KeeperCryptoError('passphrase must be at least 8 characters')
  }
  if (!kdf || typeof kdf.salt !== 'string') throw new KeeperCryptoError('kdf parameters are missing')
  if ((kdf.alg ?? 'scrypt') !== 'scrypt') throw new KeeperCryptoError('unsupported kdf: ' + kdf.alg)
  const salt = Buffer.from(kdf.salt, 'base64')
  return scryptSync(passphrase.normalize('NFKC'), salt, kdf.keyLen ?? 32, {
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    maxmem: 512 * 1024 * 1024,
  })
}

/**
 * Seal bytes into an opaque object.
 * Layout: MAGIC(4) | nonce(12) | ciphertext | tag(16)
 * @param {Buffer} key
 * @param {Buffer} plaintext
 * @param {string} [aead]
 * @returns {Buffer}
 */
export function seal(key, plaintext, aead = AEAD) {
  if (!SUPPORTED_AEADS.includes(aead)) throw new KeeperCryptoError('unsupported aead: ' + aead)
  if (!isAeadAvailable(aead)) {
    throw new KeeperCryptoError('this runtime cannot encrypt with ' + aead)
  }
  const nonce = randomBytes(NONCE_LEN)
  const cipher = createCipheriv(aead, key, nonce, { authTagLength: TAG_LEN })
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  return Buffer.concat([MAGIC, nonce, ciphertext, cipher.getAuthTag()])
}

/**
 * Open a sealed object. Throws on a wrong key, a foreign format or any tampering.
 * @param {Buffer} key
 * @param {Buffer} sealed
 * @param {string} [aead]
 * @returns {Buffer}
 */
export function open(key, sealed, aead = AEAD) {
  if (!SUPPORTED_AEADS.includes(aead)) throw new KeeperCryptoError('unsupported aead: ' + aead)
  if (!isAeadAvailable(aead)) {
    throw new KeeperCryptoError('this runtime cannot decrypt ' + aead + ': the store was sealed with a cipher this host does not expose')
  }
  if (!Buffer.isBuffer(sealed) || sealed.length < MAGIC.length + NONCE_LEN + TAG_LEN) {
    throw new KeeperCryptoError('sealed object is too short')
  }
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new KeeperCryptoError('not a keeper object (bad magic)')
  }
  const nonce = sealed.subarray(MAGIC.length, MAGIC.length + NONCE_LEN)
  const tag = sealed.subarray(sealed.length - TAG_LEN)
  const ciphertext = sealed.subarray(MAGIC.length + NONCE_LEN, sealed.length - TAG_LEN)
  const decipher = createDecipheriv(aead, key, nonce, { authTagLength: TAG_LEN })
  decipher.setAuthTag(tag)
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new KeeperCryptoError('cannot decrypt: wrong key or tampered object')
  }
}

/**
 * Build the key-check record stored in meta.json: a sealed constant that lets a store
 * reject a wrong passphrase immediately, without revealing anything about the key.
 * @param {Buffer} key
 * @param {string} [aead]
 * @returns {{nonce: string, ciphertext: string}} base64 fields
 */
export function createKeyCheck(key, aead = AEAD) {
  const sealed = seal(key, KEY_CHECK_PLAINTEXT, aead)
  const nonce = sealed.subarray(MAGIC.length, MAGIC.length + NONCE_LEN)
  return { nonce: nonce.toString('base64'), ciphertext: sealed.toString('base64') }
}

/**
 * @param {Buffer} key
 * @param {{nonce: string, ciphertext: string}} check
 * @param {string} [aead]
 * @returns {boolean} true when the key opens the store
 */
export function verifyKeyCheck(key, check, aead = AEAD) {
  try {
    const sealed = Buffer.from(check.ciphertext, 'base64')
    return open(key, sealed, aead).equals(KEY_CHECK_PLAINTEXT)
  } catch {
    return false
  }
}
