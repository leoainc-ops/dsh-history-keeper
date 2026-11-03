import assert from 'node:assert/strict'
import test from 'node:test'

import { blocksOf, fuseLineages } from '../lib/fuse.js'
import { decodePayload } from '../lib/payload.js'
import { makeLog } from './helpers.js'

const ID = 'session-fuse-demo'

/** A log whose first `shared` batches are identical on both sides. */
function log(shared, tail) {
  return makeLog({
    id: ID,
    cwd: 'C:\\work\\fuse',
    batches: [...shared, [{ type: 'turn/start', time: (tail.time ?? 3000) - 100 }], [tail], [{ type: 'turn/end', time: tail.time ?? 3000 }]],
  })
}

const SHARED = [[{ type: 'turn/start', time: 1000 }], [{ type: 'content', time: 1500 }], [{ type: 'turn/end', time: 2000 }]]

test('blocksOf splits a log into frames that decompress to the same text', () => {
  const buffer = log(SHARED, { type: 'tail/a', time: 3000 })
  const blocks = blocksOf(buffer)
  assert.ok(blocks.length >= 1)
  const joined = blocks.map((block) => block.text).join('')
  assert.equal(joined, decodePayload(buffer).text)
})

test('fusion keeps the shared prefix, appends both tails and renumbers seq', () => {
  const a = log(SHARED, { type: 'tail/a', time: 3000 })
  const b = log(SHARED, { type: 'tail/b', time: 4000 })
  const fused = fuseLineages({ sessionId: ID, lineages: [{ buffer: a, label: 'a' }, { buffer: b, label: 'b' }] })

  const decoded = decodePayload(fused.buffer)
  assert.equal(decoded.ok, true)
  const lines = decoded.text.split('\n').filter(Boolean)
  const docs = lines.map((line) => JSON.parse(line))

  assert.equal(docs[0].type, 'session')
  assert.equal(docs[0].id, ID)

  const types = docs.slice(1).map((doc) => (doc.type === 'batch' ? doc.rows.map((row) => row.type).join('+') : doc.type))
  assert.deepEqual(types, ['turn/start', 'content', 'turn/end', 'turn/start', 'tail/a', 'turn/end', 'turn/start', 'tail/b', 'turn/end'], 'complete turns only, oldest-ending tail first')

  const seqs = docs.slice(1).map((doc) => (doc.type === 'batch' ? doc.rows[doc.rows.length - 1].seq : doc.seq))
  assert.deepEqual(seqs, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'the prefix keeps its seq; the tails continue after it')

  assert.equal(fused.stats.prefixFrames, 4, 'header + three shared events (through turn/end)')
  assert.equal(fused.stats.events, 9)
  assert.equal(fused.stats.lastEventAt, 4000)
})

test('fusion is deterministic regardless of the input order', () => {
  const a = log(SHARED, { type: 'tail/a', time: 3000 })
  const b = log(SHARED, { type: 'tail/b', time: 4000 })
  const one = fuseLineages({ sessionId: ID, lineages: [{ buffer: a, label: 'a' }, { buffer: b, label: 'b' }] })
  const two = fuseLineages({ sessionId: ID, lineages: [{ buffer: b, label: 'b' }, { buffer: a, label: 'a' }] })
  assert.equal(one.buffer.equals(two.buffer), true, 'both machines must compute the same bytes')
})

test('fusion reuses the compressed frames of the shared prefix', () => {
  const blocks = [
    [{ type: 'turn/start', time: 1000 }],
    [{ type: 'turn/end', time: 2000 }],
  ]
  const a = log(blocks, { type: 'tail/a', time: 3000 })
  const b = log(blocks, { type: 'tail/b', time: 4000 })
  const fused = fuseLineages({ sessionId: ID, lineages: [{ buffer: a, label: 'a' }, { buffer: b, label: 'b' }] })
  assert.ok(fused.stats.prefixBytesReused > 0, 'the prefix frames come from the source log')
  assert.ok(fused.buffer.subarray(0, fused.stats.prefixBytesReused).equals(a.subarray(0, fused.stats.prefixBytesReused)))
})

test('fusion refuses a log that belongs to another session', () => {
  const a = makeLog({ id: ID, batches: [[{ type: 'turn/start', time: 1000 }]] })
  const other = makeLog({ id: 'session-other', batches: [[{ type: 'turn/start', time: 1000 }]] })
  assert.throws(
    () => fuseLineages({ sessionId: ID, lineages: [{ buffer: a, label: 'a' }, { buffer: other, label: 'b' }] }),
    /expected session-fuse-demo/,
  )
})

test('fusion needs two lineages', () => {
  const a = makeLog({ id: ID, batches: [[{ type: 'turn/start', time: 1000 }]] })
  assert.throws(() => fuseLineages({ sessionId: ID, lineages: [{ buffer: a, label: 'a' }] }), /at least two/)
})
