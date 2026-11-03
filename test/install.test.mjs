import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { fuseLineages } from '../lib/fuse.js'
import { installLog, rebaseline } from '../lib/install.js'
import { mergeStores } from '../lib/merge.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { collectSessions, verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'install-test-passphrase'
const ID = 'session-install-demo'

/** A log with two complete turns; the second one carries this branch's own content. */
function logWith(marker, time) {
  return makeLog({
    id: ID,
    cwd: 'C:\\work\\x',
    batches: [
      [{ type: 'turn/start', data: { turn: 1 }, time: 100 }],
      [{ type: 'turn/end', data: { turn: 1 }, time: 200 }],
      [{ type: 'turn/start', data: { turn: 2 }, time: time - 100 }],
      [{ type: 'assistant/message', data: { turn: 2, step: 1 }, time }],
      [{ type: marker, data: { turn: 2, step: 1 }, time }],
      [{ type: 'turn/end', data: { turn: 2 }, time: time + 100 }],
    ],
  })
}

test('a fused log is installed over the old one, which is kept, and then published', (t) => {
  const root = tempDir('keeper-install-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const deviceA = { deviceId: 'a'.repeat(32), deviceName: 'pc-a' }
  const deviceB = { deviceId: 'b'.repeat(32), deviceName: 'pc-b' }

  // Two machines continued the same conversation differently.
  const dirA = path.join(root, 'vault-a')
  initStore(dirA, { passphrase: PASS, deviceName: 'pc-a' })
  const storeA = openStore(dirA, PASS)
  writeSession(home, { id: ID, cwd: 'C:\\work\\x', log: logWith('only-a', 300) })
  snapshot(storeA, { home, now: '2026-11-02T10:00:00.000Z', device: deviceA })

  const dirB = path.join(root, 'vault-b')
  initStore(dirB, { passphrase: PASS, deviceName: 'pc-b' })
  const storeB = openStore(dirB, PASS)
  writeSession(home, { id: ID, cwd: 'C:\\work\\x', log: logWith('only-b', 900) })
  snapshot(storeB, { home, now: '2026-11-02T10:05:00.000Z', device: deviceB })

  const mergedDir = path.join(root, 'merged')
  mergeStores([storeA, storeB], { outDir: mergedDir, passphrase: PASS })
  const merged = openStore(mergedDir, PASS)
  assert.equal(verifyStore(merged).totals.archived, 1)

  const { sessions, archived } = collectSessions(merged)
  const lineages = [{ buffer: sessions.get(ID).buffer, label: 'visible' }, ...archived.values()]
  const fused = fuseLineages({ sessionId: ID, lineages })
  assert.equal(fused.stats.tails.every((tail) => tail.lines > 0), true, 'both tails keep whole turns')

  const installed = installLog({ buffer: fused.buffer, home, sessionId: ID, force: true })
  assert.ok(installed.superseded, 'the previous log is kept as .superseded-<ts>')
  assert.equal(fs.readFileSync(installed.target).equals(fused.buffer), true)

  const report = rebaseline(merged, { home, sessionId: ID, device: deviceA })
  assert.equal(report.verified.ok, true, JSON.stringify(report.verified.problems))
  assert.equal(report.verified.sessions, 1)
  assert.equal(report.archived, 2, 'the previous visible lineage and the archived one are kept')

  const published = collectSessions(merged).sessions.get(ID)
  assert.equal(published.buffer.equals(fused.buffer), true, 'the visible lineage is the fused log')
  assert.equal(verifyStore(merged).ok, true, 'still verifies')
})

test('install refuses a log from another session and a missing target', (t) => {
  const root = tempDir('keeper-install-guard-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const buffer = makeLog({ id: 'session-x', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }]] })
  assert.throws(() => installLog({ buffer, home, sessionId: 'session-y' }), /belongs to/)
  assert.throws(() => installLog({ buffer, home, sessionId: 'session-x' }), /no session log/)
})
