/**
 * Session attachments.
 *
 * DSH stores a pasted image or file as a content-addressed blob under
 * `<home>/attachments/v1/objects/<first two hex>/<sha256>`, and the session log refers to it
 * as `"attachmentId": "sha256:<64 hex>"`. The session bytes alone are therefore not a
 * complete history: without the blob, a restored conversation shows a reference to a file
 * that no longer exists.
 *
 * Only blobs that a published session actually references are captured — never the whole
 * directory — so the vault does not accumulate files nobody pointed at.
 *
 * Not every referenced blob is guaranteed to exist: DSH may have garbage-collected it. A
 * reference without a blob is reported, never silently ignored.
 */
import fs from 'node:fs'
import path from 'node:path'

import { sha256 } from './util.js'

/** `attachmentId` values in the session JSONL. */
const REF = /sha256:([0-9a-f]{64})/gu

/**
 * Attachment hashes referenced by a piece of session text, in order of first appearance.
 * @param {string} text
 * @returns {string[]}
 */
export function findAttachmentRefs(text) {
  const seen = new Set()
  for (const match of text.matchAll(REF)) seen.add(match[1])
  return [...seen]
}

/**
 * Directory DSH uses for blobs, given a DSH home.
 * @param {string} home
 * @returns {string}
 */
export function attachmentsRoot(home) {
  return path.join(home, 'attachments')
}

/**
 * Where a blob with that hash should live. Tries the layout this DSH uses and flatter
 * variants, so a layout change does not silently stop capturing.
 * @param {string} root `<home>/attachments`
 * @param {string} hash
 * @returns {string|null} existing file, or null
 */
export function resolveAttachment(root, hash) {
  const candidates = [
    path.join(root, 'v1', 'objects', hash.slice(0, 2), hash),
    path.join(root, 'objects', hash.slice(0, 2), hash),
    path.join(root, 'v1', 'objects', hash),
    path.join(root, hash),
  ]
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      /* try the next layout */
    }
  }
  return null
}

/**
 * Read a blob, verifying that its content is what its name claims.
 * @param {string} file
 * @param {string} hash
 * @returns {{bytes: Buffer, verified: boolean}}
 */
export function readAttachment(file, hash) {
  const bytes = fs.readFileSync(file)
  return { bytes, verified: sha256(bytes) === hash }
}

/**
 * Write a blob into a DSH home, never overwriting different content.
 * @param {string} root `<home>/attachments`
 * @param {string} hash
 * @param {Buffer} bytes
 * @returns {{path: string, action: 'created'|'present'|'conflict'}}
 */
export function writeAttachment(root, hash, bytes) {
  const dir = path.join(root, 'v1', 'objects', hash.slice(0, 2))
  const target = path.join(dir, hash)
  if (fs.existsSync(target)) {
    const current = fs.readFileSync(target)
    return { path: target, action: sha256(current) === hash ? 'present' : 'conflict' }
  }
  fs.mkdirSync(dir, { recursive: true })
  const tmp = target + '.tmp-' + process.pid
  fs.writeFileSync(tmp, bytes)
  fs.renameSync(tmp, target)
  return { path: target, action: 'created' }
}
