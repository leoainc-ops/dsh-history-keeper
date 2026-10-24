import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { collectGarbage, compact, mergeChain } from '../lib/compact.js'
import { evaluatePolicy } from '../lib/policy.js'
import { restore } from '../lib/restore.js'
import { publishedAttachments, publishedState, snapshot } from '../lib/snapshot.js'
import { initStore, openStore, readManifestChain } from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'compact-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-compact-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'compact-test' })
  t.after(() => removeDir(root))
  return { root, home, dir, store: openStore(dir, PASSPHRASE) }
}

/** Publish `count` snapshots whose local log only grows, so no snapshot diverges. */
function publishGrowing(store, home, count) {
  for (let i = 1; i <= count; i++) {
    const batches = Array.from({ length: i }, (_, index) => [{ type: 'm', n: 'b' + index }])
    writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches }) })
    snapshot(store, { home, now: new Date(Date.UTC(2026, 9, 24, 10, i, 0)).toISOString() })
  }
}

test('a checkpoint replaces the chain and keeps every byte and hash', (t) => {
  const { root, home, store } = setup(t)
  publishGrowing(store, home, 3)
  const before = publishedState(readManifestChain(store)).get('s1')

  const result = compact(store, { now: '2026-10-24T11:00:00.000Z' })
  assert.equal(result.compacted, true)
  assert.equal(result.manifestsBefore, 3)
  assert.equal(result.manifestsAfter, 1)

  const chain = readManifestChain(store)
  assert.equal(chain.length, 1)
  assert.equal(chain[0].kind, 'checkpoint')
  assert.equal(chain[0].covers.manifests, 3)

  const after = publishedState(chain).get('s1')
  assert.equal(after.bytes, before.bytes)
  assert.equal(after.frames, before.frames)
  assert.equal(after.endSha256, before.endSha256)

  const verified = verifyStore(store)
  assert.equal(verified.ok, true, JSON.stringify(verified.problems))
  assert.equal(verified.totals.sessions, 1)

  const target = path.join(root, 'restored')
  const restored = restore(store, { home: target })
  assert.equal(restored.created.length, 1)

  const find = (base) => {
    const entry = fs.readdirSync(base, { recursive: true }).find((name) => String(name).endsWith('.jsonl.zstd'))
    assert.ok(entry, 'a session log must exist under ' + base)
    return path.join(base, String(entry))
  }
  assert.deepEqual(fs.readFileSync(find(target)), fs.readFileSync(find(path.join(home, 'sessions'))), 'the restored log must be byte-identical')
})

test('attachments survive compaction', (t) => {
  const { home, store } = setup(t)
  const bytes = randomBytes(1024)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const dir = path.join(home, 'attachments', 'v1', 'objects', hash.slice(0, 2))
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, hash), bytes)
  writeSession(home, {
    id: 's1',
    log: makeLog({
      id: 's1',
      batches: [[{ type: 'message', content: [{ type: 'image', attachment: { attachmentId: 'sha256:' + hash } }] }]],
    }),
  })
  snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  publishGrowing(store, home, 2)

  assert.equal(publishedAttachments(readManifestChain(store)).size, 1)
  compact(store, { now: '2026-10-24T11:00:00.000Z' })
  assert.equal(publishedAttachments(readManifestChain(store)).size, 1, 'the checkpoint must carry the blobs')

  const verified = verifyStore(store)
  assert.equal(verified.ok, true, JSON.stringify(verified.problems))
  assert.equal(verified.totals.attachments, 1)
})

test('the policy explains itself and respects hard bounds', (t) => {
  const { home, store } = setup(t)
  publishGrowing(store, home, 3)
  const chain = readManifestChain(store)

  const below = evaluatePolicy({ store, chain, options: { minManifests: 50 } })
  assert.equal(below.compact, false)
  assert.match(below.reason, /minimum 50/)

  const at = evaluatePolicy({ store, chain, options: { minManifests: 3 } })
  assert.equal(at.compact, true)
  assert.match(at.reason, /compact: 3 manifest/)
  assert.equal(at.signals.chunks, 3)

  const cap = evaluatePolicy({ store, chain, options: { minManifests: 3, maxChunks: 1 } })
  assert.equal(cap.compact, false)
  assert.match(cap.reason, /cap 1/)

  const space = evaluatePolicy({ store, chain, options: { minManifests: 3, freeSpaceFactor: 1e9 } })
  assert.equal(space.compact, false)
  assert.match(space.reason, /free space/)

  compact(store, { now: '2026-10-24T11:00:00.000Z' })
  const done = evaluatePolicy({ store, chain: readManifestChain(store), options: { minManifests: 2 } })
  assert.equal(done.compact, false)
  assert.equal(done.reason, 'already a checkpoint')
})

test('garbage collection never deletes something the chain still needs', (t) => {
  const { dir, home, store } = setup(t)
  publishGrowing(store, home, 4)
  compact(store, { now: '2026-10-24T11:00:00.000Z' })

  const objectsBefore = fs.readdirSync(path.join(dir, 'objects')).length
  const dry = collectGarbage(store, { dryRun: true })
  assert.equal(dry.deleted, 0)
  assert.equal(fs.readdirSync(path.join(dir, 'objects')).length, objectsBefore, 'a dry run deletes nothing')
  assert.ok(dry.removable > 0)

  assert.throws(() => collectGarbage(store, { dryRun: false }), /without --yes/)

  const real = collectGarbage(store, { dryRun: false, yes: true })
  assert.equal(real.deleted, dry.removable)
  assert.equal(verifyStore(store).ok, true, 'the checkpoint must still verify after gc')
  assert.equal(fs.readdirSync(path.join(dir, 'objects')).length, objectsBefore - real.deleted)
})

test('snapshots keep working after a checkpoint and can be compacted again', (t) => {
  const { home, store } = setup(t)
  publishGrowing(store, home, 2)
  compact(store, { now: '2026-10-24T11:00:00.000Z' })

  writeSession(home, {
    id: 's1',
    log: makeLog({ id: 's1', batches: [[{ type: 'm', n: 'b0' }], [{ type: 'm', n: 'b1' }], [{ type: 'm', n: 'b2' }]] }),
  })
  const snap = snapshot(store, { home, now: '2026-10-24T12:00:00.000Z' })
  assert.equal(snap.sessions.length, 1)
  assert.equal(readManifestChain(store).length, 2)
  assert.equal(verifyStore(store).ok, true)

  const again = compact(store, { now: '2026-10-24T13:00:00.000Z' })
  assert.equal(again.compacted, true)
  assert.equal(readManifestChain(store).length, 1)
  assert.equal(verifyStore(store).ok, true)
})

test('mergeChain deduplicates a chunk described twice and keeps the newest version', () => {
  const chunk = { seq: 1, byteFrom: 0, byteTo: 10, frameFrom: 0, frameTo: 1 }
  const merged = mergeChain([
    { seq: 1, sessions: { s: { formatVersion: 4, chunks: [chunk] } } },
    { seq: 2, sessions: { s: { formatVersion: 4, chunks: [{ ...chunk, byteTo: 12 }] } } },
  ])
  assert.equal(merged.sessions.s.chunks.length, 1)
  assert.equal(merged.sessions.s.chunks[0].byteTo, 12)
  assert.equal(merged.chunks, 1)
})
