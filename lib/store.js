/**
 * Store layout and durability.
 *
 * <store>/
 *   meta.json                       plaintext: format, store id, KDF params, key check, device
 *   objects/<id>.bin                sealed blobs: session chunks and manifests
 *
 * Object names are random identifiers, never content hashes: a name must not leak
 * anything about the plaintext (not even equality between two blobs). Integrity is
 * carried by the hash recorded in the referencing document, so a renamed or edited
 * object is detected on read.
 *
 * Every write is atomic: write a sibling temp file, fsync it, then rename. Rename is
 * used instead of hardlink because synced folders (Google Drive, OneDrive) do not
 * support hardlinks.
 */
import fs from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_KDF,
  KeeperCryptoError,
  createKeyCheck,
  deriveKey,
  newSalt,
  open as openSealed,
  seal,
  verifyKeyCheck,
} from './crypto.js'
import { AEAD, SUPPORTED_AEADS, isAeadAvailable } from './crypto.js'
import { newId, sha256, toIso } from './util.js'

export const STORE_FORMAT = 'dsh-history-keeper/store/1'
export const MANIFEST_FORMAT = 'dsh-history-keeper/manifest/1'

/** Store-level failure (corruption, wrong layout, missing object). */
export class KeeperStoreError extends Error {
  constructor(message, code = 'STORE_ERROR') {
    super(message)
    this.name = 'KeeperStoreError'
    this.code = code
  }
}

const META_FILE = 'meta.json'
const OBJECTS_DIR = 'objects'
const DEVICES_DIR = 'devices'

/**
 * One head per device.
 *
 * Before C.1 the store had a single head in `meta.json`, which two machines would overwrite
 * for each other. Now each device owns `devices/<deviceId>.json` and only ever writes its own
 * head; `meta.json` keeps the legacy pointer so a store written by an older version still
 * reads, and it is only advanced while a single device writes the store.
 * @param {string} dir
 * @param {string} deviceId
 * @returns {string}
 */
export function deviceHeadPath(dir, deviceId) {
  if (!/^[0-9a-f]{32}$/.test(deviceId)) throw new KeeperStoreError('invalid device id', 'BAD_DEVICE_ID')
  return path.join(dir, DEVICES_DIR, deviceId + '.json')
}

/**
 * @param {string} dir
 * @param {string} deviceId
 * @returns {{deviceId: string, deviceName?: string, head: {id: string, cipherSha256: string}|null, seq?: number, updatedAt?: string}|null}
 */
export function readDeviceHead(dir, deviceId) {
  const file = deviceHeadPath(dir, deviceId)
  if (!fs.existsSync(file)) return null
  return readJson(file)
}

/**
 * @param {string} dir
 * @returns {Array<{deviceId: string, deviceName?: string, head: {id: string, cipherSha256: string}|null, seq?: number, updatedAt?: string}>}
 */
export function listDeviceHeads(dir) {
  const devicesDir = path.join(dir, DEVICES_DIR)
  if (!fs.existsSync(devicesDir)) return []
  return fs
    .readdirSync(devicesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return readJson(path.join(devicesDir, name))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function writeDeviceHead(store, device, head, seq) {
  const file = deviceHeadPath(store.dir, device.deviceId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const record = {
    deviceId: device.deviceId,
    deviceName: device.deviceName ?? null,
    head,
    seq,
    updatedAt: toIso(),
  }
  atomicWrite(file, Buffer.from(JSON.stringify(record, null, 2) + '\n', 'utf8'))
}

/**
 * Manifest-chain cache.
 *
 * Reading the chain opens one file per manifest; on a real vault with 500 manifests that
 * costs four to five seconds. The plugin reads the chain on every status and every
 * automatic capture, so the walk is memoised. The key includes the head reference (a random
 * id that changes on every write) and the snapshot count, so a write by this process or by
 * another one invalidates the entry automatically: no timers, no manual invalidation that
 * could silently go stale.
 */
const CHAIN_CACHE = new Map()
const CHAIN_CACHE_LIMIT = 4

function metaPath(dir) {
  return path.join(dir, META_FILE)
}

function objectPath(dir, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) throw new KeeperStoreError('invalid object id', 'BAD_OBJECT_ID')
  return path.join(dir, OBJECTS_DIR, id + '.bin')
}

/**
 * Write bytes atomically: temp file in the same directory, fsync, rename over target.
 * @param {string} file
 * @param {Buffer} bytes
 */
export function atomicWrite(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp-' + process.pid + '-' + newId().slice(0, 8)
  const fd = fs.openSync(tmp, 'w')
  try {
    fs.writeSync(fd, bytes, 0, bytes.length, 0)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  fs.renameSync(tmp, file)
}

/**
 * @param {string} file
 * @returns {any} parsed JSON
 */
export function readJson(file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    throw new KeeperStoreError('cannot read ' + file + ': ' + error.message, 'READ_FAILED')
  }
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new KeeperStoreError('invalid JSON in ' + file + ': ' + error.message, 'BAD_JSON')
  }
}

/**
 * Create a new store.
 * @param {string} dir
 * @param {{passphrase: string, deviceName?: string, deviceId?: string}} options
 */
/**
 * Derived-key cache.
 *
 * scrypt with the parameters we use costs one to three seconds. The plugin opens the store on
 * every status, every manual snapshot and every automatic one, so deriving on each open would
 * burn CPU for nothing. Keys stay in memory only, keyed by store id + salt + a hash of the
 * passphrase, so a different passphrase or a re-created store never hits a stale entry.
 */
const KEY_CACHE = new Map()
const KEY_CACHE_LIMIT = 8

function deriveCached(passphrase, kdf) {
  const cacheKey = sha256(String(kdf.storeId ?? '') + '\0' + String(kdf.salt ?? '') + '\0' + passphrase)
  const hit = KEY_CACHE.get(cacheKey)
  if (hit) return hit
  const key = deriveKey(passphrase, kdf)
  if (KEY_CACHE.size >= KEY_CACHE_LIMIT) KEY_CACHE.delete(KEY_CACHE.keys().next().value)
  KEY_CACHE.set(cacheKey, key)
  return key
}

/** Forget cached keys (tests, or an operator rotating a passphrase in-process). */
export function clearKeyCache() {
  KEY_CACHE.clear()
}
export function initStore(dir, options) {
  const { passphrase, deviceName = 'unknown-device', deviceId = newId() } = options ?? {}
  if (fs.existsSync(metaPath(dir))) {
    throw new KeeperStoreError('a keeper store already exists at ' + dir, 'STORE_EXISTS')
  }
  const salt = newSalt()
  const kdf = { ...DEFAULT_KDF, salt }
  const key = deriveKey(passphrase, kdf)
  fs.mkdirSync(path.join(dir, OBJECTS_DIR), { recursive: true })
  const meta = {
    format: STORE_FORMAT,
    storeId: newId(),
    createdAt: toIso(),
    aead: AEAD,
    kdf,
    keyCheck: createKeyCheck(key, AEAD),
    deviceId,
    deviceName,
    manifest: null,
    snapshots: 0,
  }
  atomicWrite(metaPath(dir), Buffer.from(JSON.stringify(meta, null, 2) + '\n', 'utf8'))
  return { dir, meta, key }
}

/**
 * Open an existing store and verify the passphrase.
 * @param {string} dir
 * @param {string} passphrase
 */
export function openStore(dir, passphrase) {
  const meta = readJson(metaPath(dir))
  if (meta.format !== STORE_FORMAT) {
    throw new KeeperStoreError('unsupported store format: ' + meta.format, 'BAD_FORMAT')
  }
  if (!SUPPORTED_AEADS.includes(meta.aead)) {
    throw new KeeperStoreError('unsupported AEAD: ' + meta.aead, 'BAD_FORMAT')
  }
  if (!isAeadAvailable(meta.aead)) {
    throw new KeeperStoreError(
      'this runtime cannot use ' + meta.aead + ': the store was sealed with a cipher this host does not expose',
      'AEAD_UNAVAILABLE',
    )
  }
  const key = deriveCached(passphrase, meta.kdf)
  if (!verifyKeyCheck(key, meta.keyCheck, meta.aead)) {
    throw new KeeperCryptoError('wrong passphrase for this store')
  }
  return { dir, meta, key }
}

/**
 * Seal plaintext into a new object.
 * @param {{dir: string, key: Buffer}} store
 * @param {Buffer} plaintext
 * @returns {{id: string, cipherSha256: string, cipherBytes: number}}
 */
export function putObject(store, plaintext) {
  const sealed = seal(store.key, plaintext, store.meta.aead)
  const id = newId()
  atomicWrite(objectPath(store.dir, id), sealed)
  return { id, cipherSha256: sha256(sealed), cipherBytes: sealed.length }
}

/**
 * Read an object and check it against the hash the referencing document recorded.
 * @param {{dir: string, key: Buffer}} store
 * @param {string} id
 * @param {string} expectedSha256
 * @returns {Buffer} plaintext
 */
export function getObject(store, id, expectedSha256) {
  const file = objectPath(store.dir, id)
  let sealed
  try {
    sealed = fs.readFileSync(file)
  } catch (error) {
    throw new KeeperStoreError('missing object ' + id + ': ' + error.message, 'MISSING_OBJECT')
  }
  const actual = sha256(sealed)
  if (expectedSha256 && actual !== expectedSha256) {
    throw new KeeperStoreError('object ' + id + ' does not match its recorded hash', 'HASH_MISMATCH')
  }
  return openSealed(store.key, sealed, store.meta.aead)
}

/**
 * Append a manifest: seal it, write it as an object, then move the meta pointer.
 * The pointer carries the hash of the manifest object, which is what makes the
 * chain tamper-evident, and the previous pointer is also stored inside the document.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{deviceId: string, sessions: object, createdAt?: string}} payload
 */
export function writeManifest(store, payload) {
  const device = payload.device ?? null
  const myHead = device ? readDeviceHead(store.dir, device.deviceId)?.head ?? null : null
  const otherDevices = device ? listDeviceHeads(store.dir).filter((head) => head.deviceId !== device.deviceId) : []
  const soleWriter = device ? otherDevices.length === 0 : true

  // Adopt the legacy head when this device has not written yet and nobody else has either, so
  // a store created before C.1 keeps one continuous chain instead of splitting in two.
  const legacy = store.meta.manifest
  const fallback = myHead ?? (soleWriter ? legacy : null)
  const prev = payload.prev !== undefined ? payload.prev : fallback
  const seq = device ? (readDeviceHead(store.dir, device.deviceId)?.seq ?? 0) + 1 : (store.meta.snapshots ?? 0) + 1

  const doc = {
    format: MANIFEST_FORMAT,
    seq,
    createdAt: payload.createdAt ?? toIso(),
    deviceId: payload.deviceId,
    prev: prev ? { id: prev.id, cipherSha256: prev.cipherSha256 } : null,
    sessions: payload.sessions,
    // Additive field: manifests written before attachments existed simply lack it, so the
    // reader treats a missing map as "no blobs" instead of rejecting the manifest.
    ...(payload.attachments ? { attachments: payload.attachments } : {}),
    // Additive: a checkpoint carries every chunk descriptor accumulated so far and starts a
    // fresh chain, with the previous head recorded for provenance.
    ...(payload.kind ? { kind: payload.kind } : {}),
    ...(payload.covers ? { covers: payload.covers } : {}),
  }
  const sealed = seal(store.key, Buffer.from(JSON.stringify(doc), 'utf8'), store.meta.aead)
  const id = newId()
  atomicWrite(objectPath(store.dir, id), sealed)
  const ref = { id, cipherSha256: sha256(sealed) }

  if (device) {
    writeDeviceHead(store, device, ref, seq)
  }

  // The legacy pointer is only advanced while a single device writes the store. Once a second
  // device appears it becomes a frozen historical pointer, and readers use the per-device
  // heads instead.
  if (soleWriter) {
    const meta = { ...store.meta, manifest: ref, snapshots: seq }
    atomicWrite(metaPath(store.dir), Buffer.from(JSON.stringify(meta, null, 2) + '\n', 'utf8'))
    store.meta = meta
  }

  return { doc, ref }
}

/**
 * Walk the manifest chain from the current head back to the first snapshot, or serve it from
 * the in-process cache.
 * Every link is verified: the object must exist, match the hash that references it,
 * decrypt with the store key, and be a well-formed manifest.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{fresh?: boolean, device?: {deviceId: string}, head?: {id: string, cipherSha256: string}|null}} [options]
 *        `fresh` bypasses the cache (verification does this); `device` walks that device's
 *        chain; without either, the legacy `meta.json` pointer is used
 * @returns {Array<any>} manifests ordered oldest to newest
 */
export function readManifestChain(store, options = {}) {
  const head = options.head !== undefined ? options.head : resolveHead(store, options.device ?? null)
  if (options.fresh === true) return walkFrom(store, head)

  const cacheKey = store.dir + '\0' + (head ? head.id + '\0' + head.cipherSha256 : 'empty')
  const hit = CHAIN_CACHE.get(cacheKey)
  if (hit) return hit.slice()

  const docs = walkFrom(store, head)
  if (CHAIN_CACHE.size >= CHAIN_CACHE_LIMIT) CHAIN_CACHE.delete(CHAIN_CACHE.keys().next().value)
  CHAIN_CACHE.set(cacheKey, docs)
  return docs.slice()
}

/**
 * Every manifest reachable from every head: the legacy `meta.json` pointer and each device's
 * head. Deduplicated by object id, so two chains that share a prefix are read once. The order
 * is not meaningful across devices — every consumer aggregates descriptors, never positions.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{fresh?: boolean}} [options]
 * @returns {Array<any>}
 */
export function readAllManifests(store, options = {}) {
  const heads = []
  if (store.meta.manifest) heads.push(store.meta.manifest)
  for (const record of listDeviceHeads(store.dir)) if (record.head) heads.push(record.head)
  if (heads.length === 0) return []

  const cacheKey = store.dir + '\0all\0' + heads.map((head) => head.id).sort().join('.')
  if (options.fresh !== true) {
    const hit = CHAIN_CACHE.get(cacheKey)
    if (hit) return hit.slice()
  }

  const seen = new Set()
  const docs = []
  for (const head of heads) {
    let pointer = head
    let guard = 0
    while (pointer) {
      if (seen.has(pointer.id)) break
      if (guard++ > 100_000) throw new KeeperStoreError('manifest chain does not terminate', 'CHAIN_LOOP')
      seen.add(pointer.id)
      const doc = readManifestObject(store, pointer)
      docs.push(doc)
      pointer = doc.prev
    }
  }

  if (options.fresh !== true) {
    if (CHAIN_CACHE.size >= CHAIN_CACHE_LIMIT) CHAIN_CACHE.delete(CHAIN_CACHE.keys().next().value)
    CHAIN_CACHE.set(cacheKey, docs)
  }
  return docs.slice()
}

/**
 * The head a read should start from: this device's own, or the legacy pointer.
 * @param {{dir: string, meta: any}} store
 * @param {{deviceId: string}|null} device
 * @returns {{id: string, cipherSha256: string}|null}
 */
export function resolveHead(store, device) {
  if (device) {
    const head = readDeviceHead(store.dir, device.deviceId)?.head
    if (head) return head
  }
  return store.meta.manifest ?? null
}

/**
 * Read the chain straight from disk, bypassing the cache. Verification uses this so a cached
 * walk can never hide a deleted or corrupted object.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{device?: {deviceId: string}}|null} [device]
 * @returns {Array<any>}
 */
export function walkManifestChain(store, device = null) {
  return walkFrom(store, resolveHead(store, device))
}

function walkFrom(store, head) {
  const docs = []
  let pointer = head
  let guard = 0
  while (pointer) {
    if (guard++ > 100_000) throw new KeeperStoreError('manifest chain does not terminate', 'CHAIN_LOOP')
    const doc = readManifestObject(store, pointer)
    docs.push(doc)
    pointer = doc.prev
  }
  return docs.reverse()
}

function readManifestObject(store, pointer) {
  const plaintext = getObject(store, pointer.id, pointer.cipherSha256)
  let doc
  try {
    doc = JSON.parse(plaintext.toString('utf8'))
  } catch (error) {
    throw new KeeperStoreError('manifest ' + pointer.id + ' is not valid JSON: ' + error.message, 'BAD_JSON')
  }
  if (doc.format !== MANIFEST_FORMAT) {
    throw new KeeperStoreError('unsupported manifest format: ' + doc.format, 'BAD_FORMAT')
  }
  return doc
}

/** Forget cached chains (tests, or when an operator inspects a store by hand). */
export function clearChainCache() {
  CHAIN_CACHE.clear()
}

/** How many chains are cached right now (diagnostics and tests). */
export function chainCacheSize() {
  return CHAIN_CACHE.size
}
