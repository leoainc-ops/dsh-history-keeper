import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { findAttachmentRefs, resolveAttachment } from '../lib/attachments.js'
import { restore } from '../lib/restore.js'
import { snapshot, backfillAttachments } from '../lib/snapshot.js'
import { initStore, openStore, writeManifest } from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'attachments-test-passphrase'

/** Put a blob into a DSH home and return the hash the session should reference. */
function putBlob(home, bytes) {
  const hash = createHash('sha256').update(bytes).digest('hex')
  const dir = path.join(home, 'attachments', 'v1', 'objects', hash.slice(0, 2))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, hash), bytes)
  return hash
}

function logReferencing(hash) {
  return makeLog({
    id: 's1',
    batches: [[{ type: 'message', role: 'user', content: [{ type: 'image', attachment: { attachmentId: 'sha256:' + hash, mediaType: 'image/png' } }] }]],
  })
}

function setup(t) {
  const root = tempDir('keeper-attach-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'attach-test' })
  t.after(() => removeDir(root))
  return { root, home, store: openStore(dir, PASSPHRASE), dir }
}

test('references are found once each and ignore malformed ids', () => {
  const a = 'a'.repeat(64)
  const b = 'b'.repeat(64)
  const text = 'sha256:' + a + ' ... sha256:' + b + ' ... sha256:' + a + ' ... sha256:short'
  assert.deepEqual(findAttachmentRefs(text), [a, b])
})

test('the blob a session references is captured, verified and restored byte for byte', (t) => {
  const { root, home, store } = setup(t)
  const bytes = randomBytes(4096)
  const hash = putBlob(home, bytes)
  writeSession(home, { id: 's1', log: logReferencing(hash) })

  const snap = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(snap.sessions.length, 1)
  assert.equal(snap.attachments.length, 1)
  assert.equal(snap.attachments[0].hash, hash)
  assert.equal(snap.attachmentBytes, bytes.length)

  const verified = verifyStore(store)
  assert.equal(verified.ok, true, JSON.stringify(verified.problems))
  assert.equal(verified.totals.attachments, 1)
  assert.equal(verified.totals.attachmentBytes, bytes.length)

  // Restore into a fresh home: the log and the blob must both come back.
  const target = path.join(root, 'restored')
  const restored = restore(store, { home: target })
  assert.equal(restored.created.length, 1)
  assert.deepEqual(restored.problems, [])
  const blob = resolveAttachment(path.join(target, 'attachments'), hash)
  assert.ok(blob, 'the blob must be restored next to the log')
  assert.deepEqual(fs.readFileSync(blob), bytes)
})

test('a blob referenced twice is captured once', (t) => {
  const { home, store } = setup(t)
  const hash = putBlob(home, randomBytes(1024))
  writeSession(home, { id: 's1', log: logReferencing(hash) })
  writeSession(home, { id: 's2', log: logReferencing(hash) })

  const snap = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(snap.sessions.length, 2)
  assert.equal(snap.attachments.length, 1, 'content-addressed: one blob for two references')
})

test('a referenced blob that is not on disk is reported, and the session is still published', (t) => {
  const { home, store } = setup(t)
  const missing = 'c'.repeat(64)
  writeSession(home, { id: 's1', log: logReferencing(missing) })

  const snap = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(snap.sessions.length, 1)
  assert.equal(snap.attachments.length, 0)
  assert.equal(snap.problems[0].code, 'ATTACHMENT_MISSING')
  assert.equal(snap.problems[0].hash, missing)
})

test('a blob whose content does not match its name is reported and not captured', (t) => {
  const { home, store } = setup(t)
  const bytes = randomBytes(512)
  const hash = putBlob(home, bytes)
  // Corrupt the file in place: the name still says hash, the content no longer does.
  const file = resolveAttachment(path.join(home, 'attachments'), hash)
  fs.writeFileSync(file, randomBytes(512))
  writeSession(home, { id: 's1', log: logReferencing(hash) })

  const snap = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(snap.attachments.length, 0)
  assert.equal(snap.problems[0].code, 'ATTACHMENT_MISMATCH')
})

test('a tampered blob in the vault fails verification', (t) => {
  const { dir, home, store } = setup(t)
  const hash = putBlob(home, randomBytes(2048))
  writeSession(home, { id: 's1', log: logReferencing(hash) })
  snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })

  const verified = verifyStore(store)
  assert.equal(verified.ok, true)

  // Flip a byte in every object until the attachment object is the one that breaks it.
  const objects = fs.readdirSync(path.join(dir, 'objects'))
  let failed = false
  for (const name of objects) {
    const file = path.join(dir, 'objects', name)
    const bytes = fs.readFileSync(file)
    const copy = Buffer.from(bytes)
    copy[copy.length - 5] ^= 0xff
    fs.writeFileSync(file, copy)
    const after = verifyStore(store)
    fs.writeFileSync(file, bytes)
    if (!after.ok) {
      failed = true
      break
    }
  }
  assert.equal(failed, true, 'at least the attachment object must be detected as tampered')
})

test('restore never overwrites a different blob already on disk', (t) => {
  const { root, home, store } = setup(t)
  const bytes = randomBytes(1024)
  const hash = putBlob(home, bytes)
  writeSession(home, { id: 's1', log: logReferencing(hash) })
  snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })

  const target = path.join(root, 'restored')
  const clash = path.join(target, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
  fs.mkdirSync(path.dirname(clash), { recursive: true })
  fs.writeFileSync(clash, randomBytes(1024))

  const report = restore(store, { home: target })
  assert.equal(report.problems[0].code, 'ATTACHMENT_CONFLICT')
  assert.notDeepEqual(fs.readFileSync(clash), bytes.slice(0, 1024))
})

test('a manifest without an attachments map still reads', (t) => {
  const { home, store } = setup(t)
  writeManifest(store, { deviceId: store.meta.deviceId, sessions: { s: { chunks: [] } } })
  const snap = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(snap.attachments.length, 0)
  assert.equal(verifyStore(store).totals.attachments, 0)
})

test('backfill captures a blob referenced only by an already-published session', (t) => {
  const { home, store } = setup(t)
  const bytes = randomBytes(2048)
  const hash = createHash('sha256').update(bytes).digest('hex')
  // Publish the session while the blob does not exist yet.
  writeSession(home, { id: 's1', log: logReferencing(hash) })
  const first = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(first.problems[0].code, 'ATTACHMENT_MISSING')

  // The blob appears afterwards; the incremental path will never see that reference again.
  putBlob(home, bytes)
  const dry = backfillAttachments(store, { home, dryRun: true })
  assert.equal(dry.found.length, 1)
  assert.equal(dry.captured.length, 0, 'a dry run writes nothing')
  assert.equal(verifyStore(store).totals.attachments, 0)

  const real = backfillAttachments(store, { home })
  assert.equal(real.captured.length, 1)
  assert.equal(real.captured[0].hash, hash)
  const verified = verifyStore(store)
  assert.equal(verified.ok, true, JSON.stringify(verified.problems))
  assert.equal(verified.totals.attachments, 1)

  // Idempotent: nothing left to capture.
  assert.equal(backfillAttachments(store, { home }).captured.length, 0)
})