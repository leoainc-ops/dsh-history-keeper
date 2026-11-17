/**
 * Structural scanner for concatenated Zstandard frames.
 *
 * The DSH JSONL session backend writes each log as a CONCATENATION OF INDEPENDENT,
 * CHECKSUMMED ZSTD FRAMES:
 *   - frame 1    -> a single JSON line (the session header)
 *   - frame 2..N -> one frame per durable append batch
 *
 * This module never decompresses: it walks the Zstandard container structure
 * (RFC 8878) to locate the boundary of the last COMPLETE frame. Copying the prefix
 * [0, committedLength) therefore always yields a valid, complete log, while
 * concatenating whole files may produce a log the host refuses.
 *
 * Ported from the proven v1 engine (same rules as the host's own scanner).
 */

/** Magic number of a Zstandard frame. */
export const ZSTD_MAGIC = 0xfd2fb528

/** Optional skippable frames: 0x184D2A5? (the low four bits are free). */
const SKIPPABLE_MASK = 0xfffffff0
const SKIPPABLE_MAGIC = 0x184d2a50

const MAX_WINDOW_LOG = 31

/** Structural error: the bytes are not a valid concatenation of frames. */
export class ZstdStructureError extends Error {
  constructor(message, offset) {
    super(offset === undefined ? message : message + ' (offset ' + offset + ')')
    this.name = 'ZstdStructureError'
    this.offset = offset
  }
}

class ByteReader {
  constructor(buffer, offset) {
    this.buffer = buffer
    this.offset = offset
  }
  get remaining() {
    return this.buffer.length - this.offset
  }
  u8() {
    if (this.remaining < 1) throw new ZstdStructureError('truncated: expected 1 byte', this.offset)
    return this.buffer[this.offset++]
  }
  u16le() {
    if (this.remaining < 2) throw new ZstdStructureError('truncated: expected 2 bytes', this.offset)
    const value = this.buffer.readUInt16LE(this.offset)
    this.offset += 2
    return value
  }
  u24le() {
    if (this.remaining < 3) throw new ZstdStructureError('truncated: expected 3 bytes', this.offset)
    const value = this.buffer.readUIntLE(this.offset, 3)
    this.offset += 3
    return value
  }
  u32le() {
    if (this.remaining < 4) throw new ZstdStructureError('truncated: expected 4 bytes', this.offset)
    const value = this.buffer.readUInt32LE(this.offset)
    this.offset += 4
    return value
  }
  skip(count) {
    if (this.remaining < count) throw new ZstdStructureError('truncated: expected ' + count + ' bytes', this.offset)
    this.offset += count
  }
}

/**
 * Walk a single frame starting at `offset`.
 * @returns {number} offset of the byte after the frame.
 * @throws {ZstdStructureError} when the bytes are structurally invalid or truncated.
 */
function walkFrame(buffer, offset) {
  const reader = new ByteReader(buffer, offset)
  const magic = reader.u32le()
  if (((magic & SKIPPABLE_MASK) >>> 0) === SKIPPABLE_MAGIC) {
    const size = reader.u32le()
    reader.skip(size)
    return reader.offset
  }
  if (magic !== ZSTD_MAGIC) {
    throw new ZstdStructureError('bad Zstandard frame magic 0x' + magic.toString(16), offset)
  }

  const descriptor = reader.u8()
  const fcsFlag = descriptor >> 6
  const singleSegment = (descriptor >> 5) & 1
  if (((descriptor >> 3) & 1) === 1) throw new ZstdStructureError('reserved frame-header bit set', offset)
  if ((descriptor & 1) === 1) throw new ZstdStructureError('reserved frame-header bit set', offset)
  const checksum = (descriptor >> 2) & 1
  const dictionaryFlag = descriptor & 3

  if (singleSegment === 0) {
    const windowLog = (descriptor >> 3) & 0x1f
    if (windowLog > MAX_WINDOW_LOG) throw new ZstdStructureError('window descriptor out of range', offset)
  }
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
  const contentSizeBytes = fcsFlag === 0 ? (singleSegment === 1 ? 1 : 0) : 2 ** fcsFlag

  if (singleSegment === 0) reader.skip(1)
  reader.skip(dictionaryBytes + contentSizeBytes)

  for (;;) {
    const header = reader.u24le()
    const lastBlock = header & 1
    const blockType = (header >> 1) & 3
    const blockSize = header >> 3
    if (blockType === 3) throw new ZstdStructureError('reserved block type', reader.offset - 3)
    reader.skip(blockType === 1 ? 1 : blockSize)
    if (lastBlock === 1) break
  }

  if (checksum === 1) reader.skip(4)
  return reader.offset
}

/**
 * Locate the boundary of the last complete frame.
 * @param {Buffer} buffer
 * @returns {{committedLength: number, frameCount: number, tornStart: number|null}}
 * @throws {ZstdStructureError} when a COMPLETE frame is invalid (hard corruption).
 */
export function scanZstdFrames(buffer) {
  let offset = 0
  let frameCount = 0
  for (;;) {
    if (offset === buffer.length) return { committedLength: offset, frameCount, tornStart: null }
    if (buffer.length - offset < 4) return { committedLength: offset, frameCount, tornStart: offset }
    let end
    try {
      end = walkFrame(buffer, offset)
    } catch (error) {
      const truncation = error instanceof ZstdStructureError && String(error.message).startsWith('truncated')
      if (truncation && frameCount > 0) return { committedLength: offset, frameCount, tornStart: offset }
      throw error
    }
    if (end > buffer.length) return { committedLength: offset, frameCount, tornStart: offset }
    offset = end
    frameCount += 1
  }
}

/** End offsets of every complete frame in the valid prefix. */
function collectFrameEnds(buffer, committedLength) {
  const ends = []
  let offset = 0
  while (offset < committedLength) {
    const end = walkFrame(buffer, offset)
    ends.push(end)
    offset = end
  }
  return ends
}

/**
 * Full log scan: valid prefix plus frame offsets.
 * @param {Buffer} buffer
 */
export function scanLog(buffer) {
  const scan = scanZstdFrames(buffer)
  return {
    committedLength: scan.committedLength,
    frameCount: scan.frameCount,
    tornStart: scan.tornStart,
    frameEnds: collectFrameEnds(buffer, scan.committedLength),
  }
}

/**
 * Cut `buffer` to the prefix made of exactly `frameCount` frames.
 * @param {Buffer} buffer
 * @param {number} frameCount
 * @returns {number} byte length of that prefix
 */
export function lengthOfFrames(buffer, frameCount) {
  const { frameEnds } = scanLog(buffer)
  if (frameCount > frameEnds.length) {
    throw new RangeError('requested ' + frameCount + ' frames but only ' + frameEnds.length + ' are complete')
  }
  return frameCount === 0 ? 0 : frameEnds[frameCount - 1]
}
