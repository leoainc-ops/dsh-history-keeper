import assert from 'node:assert/strict'
import test from 'node:test'

import { buildChunks } from '../lib/chunk.js'
import { ZstdStructureError, lengthOfFrames, scanLog, scanZstdFrames } from '../lib/frames.js'
import { makeLog } from './helpers.js'

const log = makeLog({
  id: 'session-alpha',
  batches: [[{ type: 'turn/start' }], [{ type: 'message' }], [{ type: 'turn/end' }]],
})

test('counts every complete frame and reports the whole buffer as committed', () => {
  const scan = scanZstdFrames(log)
  assert.equal(scan.frameCount, 4)
  assert.equal(scan.committedLength, log.length)
  assert.equal(scan.tornStart, null)
})

test('a torn tail is excluded, never silently accepted', () => {
  const torn = Buffer.concat([log, Buffer.from([0x28, 0xb5, 0x2f])])
  const scan = scanZstdFrames(torn)
  assert.equal(scan.frameCount, 4)
  assert.equal(scan.committedLength, log.length)
  assert.equal(scan.tornStart, log.length)
})

test('garbage where a frame must start is hard corruption, not a torn tail', () => {
  const garbage = Buffer.concat([Buffer.from('not-a-frame'), Buffer.alloc(32)])
  assert.throws(() => scanZstdFrames(garbage), ZstdStructureError)
})

test('frame offsets map frame counts to byte lengths', () => {
  const { frameEnds } = scanLog(log)
  assert.equal(frameEnds.length, 4)
  assert.equal(lengthOfFrames(log, 0), 0)
  assert.equal(lengthOfFrames(log, 2), frameEnds[1])
  assert.equal(lengthOfFrames(log, 4), log.length)
})

test('chunks stay frame-aligned and chain their hashes', () => {
  const { chunks, committedFrames, committedBytes } = buildChunks(log, { maxChunkBytes: 1 })
  assert.equal(committedFrames, 4)
  assert.equal(committedBytes, log.length)
  assert.ok(chunks.length >= 2, 'small maxChunkBytes must split the log')

  let bytes = 0
  let frames = 0
  let previousEnd = null
  for (const chunk of chunks) {
    assert.equal(chunk.byteFrom, bytes)
    assert.equal(chunk.frameFrom, frames)
    assert.ok(chunk.byteTo > chunk.byteFrom)
    assert.ok(chunk.frameTo > chunk.frameFrom)
    if (previousEnd !== null) assert.equal(chunk.prefixSha256, previousEnd, 'chunk must link to the previous end hash')
    previousEnd = chunk.endSha256
    bytes = chunk.byteTo
    frames = chunk.frameTo
  }
  assert.equal(bytes, log.length)
  assert.equal(frames, 4)

  const rebuilt = Buffer.concat(chunks.map((chunk) => chunk.payload))
  assert.ok(rebuilt.equals(log), 'concatenating chunks must reproduce the log byte for byte')
})

test('resuming from a frame boundary produces only the new tail', () => {
  const extended = Buffer.concat([log, ...makeLog({ id: 'session-alpha', batches: [[{ type: 'turn/start' }]] }).subarray(0, 0)])
  const { frameEnds } = scanLog(log)
  const first = buildChunks(log, { maxChunkBytes: 1 })
  const fromFrame = first.chunks[0].frameTo
  const fromByte = frameEnds[fromFrame - 1]
  const tail = buildChunks(log, { fromFrame, fromByte, maxChunkBytes: 1 })
  assert.equal(tail.chunks[0].byteFrom, fromByte)
  assert.equal(tail.chunks[0].prefixSha256, first.chunks[0].endSha256)
  assert.ok(extended.equals(log), 'sanity: the extended fixture is the same log')
})

test('refuses a byte offset that is not a frame boundary', () => {
  assert.throws(() => buildChunks(log, { fromFrame: 2, fromByte: 5 }), RangeError)
})
