/**
 * Decode a frame-aligned payload into its JSONL text.
 *
 * Both the secret gate and attachment capture need the text of the bytes about to be
 * published, and decompressing twice would double the cost. One decode, two readers.
 */
import zlib from 'node:zlib'

import { scanLog } from './frames.js'

/**
 * @param {Buffer} buffer frame-aligned bytes from a session log
 * @returns {{ok: boolean, text: string, failed: string|null}}
 */
export function decodePayload(buffer) {
  let scan
  try {
    scan = scanLog(buffer)
  } catch (error) {
    return { ok: false, text: '', failed: 'cannot read the log structure: ' + error.message }
  }

  const parts = []
  let offset = 0
  for (const end of scan.frameEnds) {
    try {
      parts.push(zlib.zstdDecompressSync(buffer.subarray(offset, end)).toString('utf8'))
    } catch (error) {
      return { ok: false, text: '', failed: 'cannot decompress a frame at offset ' + offset + ': ' + error.message }
    }
    offset = end
  }
  return { ok: true, text: parts.join(''), failed: null }
}
