/**
 * Chunking: cut a session log into immutable, frame-aligned slices.
 *
 * Frame alignment is the whole point. The DSH log is a concatenation of independent
 * Zstandard frames, so a slice that starts and ends on frame boundaries can be
 * concatenated later and still be a valid log. Slicing mid-frame would produce bytes
 * the host refuses.
 *
 * Each chunk also carries a hash chain: `prefixSha256` is the hash of every byte of
 * the session before this chunk, and `endSha256` the hash including it. The chain is
 * what lets a reader prove that the pieces still form one continuous history.
 */
import { sha256 } from './util.js'
import { scanLog } from './frames.js'

/** Target chunk size. Frames are never split, so a single large frame wins. */
export const DEFAULT_MAX_CHUNK_BYTES = 1024 * 1024

/** Bound the number of frames per chunk so manifests stay small. */
export const MAX_CHUNK_FRAMES = 512

/**
 * Build the chunks that are not published yet.
 * @param {Buffer} buffer full local log
 * @param {{fromByte?: number, fromFrame?: number, maxChunkBytes?: number}} options
 * @returns {{chunks: Array<{frameFrom: number, frameTo: number, byteFrom: number, byteTo: number, payload: Buffer, prefixSha256: string, endSha256: string}>, committedBytes: number, committedFrames: number, tornTail: boolean}}
 */
export function buildChunks(buffer, options = {}) {
  const { fromByte = 0, fromFrame = 0, maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES } = options
  const scan = scanLog(buffer)
  const ends = scan.frameEnds

  if (fromFrame > ends.length) {
    throw new RangeError('cannot resume from frame ' + fromFrame + ': only ' + ends.length + ' complete frames')
  }
  const expectedByte = fromFrame === 0 ? 0 : ends[fromFrame - 1]
  if (fromByte !== expectedByte) {
    throw new RangeError('fromByte ' + fromByte + ' is not the boundary of frame ' + fromFrame + ' (' + expectedByte + ')')
  }

  const chunks = []
  let index = fromFrame
  let start = fromByte

  while (index < ends.length) {
    let end = start
    let frames = 0
    while (index + frames < ends.length && frames < MAX_CHUNK_FRAMES) {
      const candidateEnd = ends[index + frames]
      if (frames > 0 && candidateEnd - start >= maxChunkBytes) break
      end = candidateEnd
      frames += 1
      if (end - start >= maxChunkBytes) break
    }
    if (frames === 0) break

    const payload = buffer.subarray(start, end)
    chunks.push({
      frameFrom: index,
      frameTo: index + frames,
      byteFrom: start,
      byteTo: end,
      payload,
      prefixSha256: sha256(buffer.subarray(0, start)),
      endSha256: sha256(buffer.subarray(0, end)),
    })

    index += frames
    start = end
  }

  return {
    chunks,
    committedBytes: scan.committedLength,
    committedFrames: scan.frameCount,
    tornTail: scan.tornStart !== null,
  }
}
