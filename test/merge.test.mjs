import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { mergeStores, relation, resolveSession, surveySource } from '../lib/merge.js'
import { restore } from '../lib/restore.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'merge-test-passphrase'

/**
 * Two vaults built to contain the four deck cases:
 *   identical · prefix (A is contained in B) · diverged · unique to each side.
 */
function build(t) {
  const root = tempDir('keeper-merge-')
  const homeA = path.join(root, 'home-a')
  const homeB = path.join(root, 'home-b')
  fs.mkdirSync(homeA, { recursive: true })
  fs.mkdirSync(homeB, { recursive: true })

  const dirA = path.join(root, 'vault-a')
  const dirB = path.join(root, 'vault-b')
  initStore(dirA, { passphrase: PASSPHRASE, deviceName: 'pc-a' })
  initStore(dirB, { passphrase: PASSPHRASE, deviceName: 'pc-b' })
  const storeA = openStore(dirA, PASSPHRASE)
  const storeB = openStore(dirB, PASSPHRASE)
  const deviceA = { deviceId: 'a'.repeat(32), deviceName: 'pc-a' }
  const deviceB = { deviceId: 'b'.repeat(32), deviceName: 'pc-b' }

  const put = (home, id, batches, dirName) =>
    writeSession(home, { id, cwd: 'C:\\work\\' + id, dirName: dirName ?? id, log: makeLog({ id, cwd: 'C:\\work\\' + id, batches }) })

  // identical on both sides
  put(homeA, 'shared-same', [[{ type: 'turn/start' }]])
  put(homeB, 'shared-same', [[{ type: 'turn/start' }]])
  // A is a prefix of B
  put(homeA, 'prefix', [[{ type: 'turn/start' }]], 'prefix-a')
  put(homeB, 'prefix', [[{ type: 'turn/start' }], [{ type: 'turn/end' }]], 'prefix-b')
  // diverged: same first batch, different second
  // Incompressible filler, generated once and shared: the first frame is identical on both
  // sides, so the chunk that carries it must be deduplicated.
  const pad = randomBytes(1200).toString('base64')
  put(homeA, 'diverged', [[{ type: 'turn/start', pad }], [{ type: 'only-a', pad }]], 'div-a')
  put(homeB, 'diverged', [[{ type: 'turn/start', pad }], [{ type: 'only-b', pad }]], 'div-b')
  // unique to each
  put(homeA, 'only-a', [[{ type: 'turn/start' }]])
  put(homeB, 'only-b', [[{ type: 'turn/start' }]])

  snapshot(storeA, { home: homeA, now: '2026-10-31T10:00:00.000Z', device: deviceA })
  snapshot(storeB, { home: homeB, now: '2026-10-31T10:00:00.000Z', device: deviceB })

  t.after(() => removeDir(root))
  return { root, dirA, dirB, storeA, storeB }
}

test('relation classifies the four cases', () => {
  const a = Buffer.from('abc')
  assert.equal(relation(a, Buffer.from('abc')), 'identical')
  assert.equal(relation(a, Buffer.from('abcdef')), 'a-prefix')
  assert.equal(relation(Buffer.from('abcdef'), a), 'b-prefix')
  assert.equal(relation(Buffer.from('abcX'), Buffer.from('abcY')), 'diverged')
})

test('resolveSession keeps the longer lineage and archives the divergent other side', (t) => {
  const { storeA, storeB } = build(t)
  const surveyA = surveySource(storeA)
  const surveyB = surveySource(storeB)

  const prefix = resolveSession('prefix', [
    { survey: surveyA, session: surveyA.sessions.get('prefix') },
    { survey: surveyB, session: surveyB.sessions.get('prefix') },
  ])
  assert.equal(prefix.action, 'longer')
  assert.equal(prefix.archived.length, 0)
  assert.equal(prefix.visible.survey.deviceName, 'pc-b', 'B holds more history')

  const diverged = resolveSession('diverged', [
    { survey: surveyA, session: surveyA.sessions.get('diverged') },
    { survey: surveyB, session: surveyB.sessions.get('diverged') },
  ])
  assert.equal(diverged.action, 'owner+archived')
  assert.equal(diverged.archived.length, 1)
  assert.equal(diverged.visible.survey.deviceName, 'pc-a', 'A introduced the session, so A owns it')
  assert.equal(diverged.archived[0].archiveKey, 'diverged@' + 'b'.repeat(8))
})

test('a merge writes a new vault with the union, dedupes content and verifies', (t) => {
  const { root, storeA, storeB } = build(t)
  const out = path.join(root, 'merged')

  const dry = mergeStores([storeA, storeB], { outDir: out, passphrase: PASSPHRASE, dryRun: true })
  assert.equal(fs.existsSync(path.join(out, 'meta.json')), false, 'a dry run writes nothing')
  assert.equal(dry.sessions.length, 5, 'shared-same, prefix, diverged, only-a, only-b')
  assert.equal(dry.archived.length, 1)

  const report = mergeStores([storeA, storeB], { outDir: out, passphrase: PASSPHRASE, deviceName: 'merged', maxChunkBytes: 1024 })
  assert.equal(report.sessions.length, 5)
  assert.equal(report.archived.length, 1)
  assert.ok(report.stats.dedupedChunks > 0, 'the shared prefix of the diverged pair is sealed once')
  assert.equal(report.verification.ok, true, JSON.stringify(report.verification.problems))
  assert.equal(report.verification.sessions, 5)
  assert.equal(report.verification.archived, 1)

  // The merged store is a normal vault: it verifies, and restore ignores archived entries.
  const merged = openStore(out, PASSPHRASE)
  const verified = verifyStore(merged)
  assert.equal(verified.ok, true)
  assert.equal(verified.totals.sessions, 5)
  assert.equal(verified.totals.archived, 1)

  const target = path.join(root, 'restored')
  const restored = restore(merged, { home: target })
  assert.equal(restored.created.length, 5, 'only visible sessions are restored')

  // Origins travel with the entries.
  const sessionEntry = report.sessions.find((item) => item.sessionId === 'only-b')
  assert.equal(sessionEntry.origin.deviceName, 'pc-b')
})

test('merging a vault with itself is idempotent in content', (t) => {
  const { root, storeA } = build(t)
  const out = path.join(root, 'merged-self')
  const report = mergeStores([storeA, storeA], { outDir: out, passphrase: PASSPHRASE })
  assert.equal(report.archived.length, 0, 'the same vault twice is not a divergence')
  assert.equal(report.sessions.length, 4)
  assert.equal(report.verification.ok, true)
  assert.equal(report.stats.objects, report.stats.chunks - report.stats.dedupedChunks, 'every chunk is either sealed or reused')
  assert.equal(report.stats.objects, report.stats.chunks, 'each session is sealed once; no reuse is needed')
})

