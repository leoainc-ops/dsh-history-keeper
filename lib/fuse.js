/**
 * Fusion of the lineages of one session.
 *
 * Two machines continued the same conversation: both logs share a prefix (everything up to the
 * point where they separated) and then diverge. Archiving one of them loses that work from view;
 * picking one loses it entirely. Fusion keeps both: the shared prefix is written once, then each
 * tail is appended in a deterministic order (oldest ending first, tie-broken by content hash), so
 * every machine computes the same bytes and no new divergence is created.
 *
 * What is preserved exactly: the header, every event's type/data/time, and the compressed bytes of
 * the shared prefix (reused from the source log, so chunk-level dedupe still applies).
 * What changes: `seq` is renumbered from 0 across the fused log, because the two tails would
 * otherwise repeat the same numbers.
 */
import zlib from 'node:zlib'

import { scanLog } from './frames.js'
import { sha256 } from './util.js'

const BLOCK_BYTES = 64 * 1024

/**
 * Split a log into its compressed frames, with the text each one decompresses to.
 * @param {Buffer} buffer
 * @returns {Array<{raw: Buffer, text: string}>}
 */
export function blocksOf(buffer) {
  const scan = scanLog(buffer)
  const blocks = []
  let offset = 0
  for (const end of scan.frameEnds) {
    const raw = buffer.subarray(offset, end)
    blocks.push({ raw, text: zlib.zstdDecompressSync(raw).toString('utf8') })
    offset = end
  }
  return blocks
}

/** @param {Buffer} bytes */
function compressBlocks(bytes) {
  const frames = []
  for (let offset = 0; offset < bytes.length; offset += BLOCK_BYTES) {
    frames.push(zlib.zstdCompressSync(bytes.subarray(offset, offset + BLOCK_BYTES)))
  }
  return frames
}

/** @param {string} text */
function splitLines(text) {
  const lines = text.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** @param {string} line */
function eventTime(line) {
  try {
    const doc = JSON.parse(line)
    const row = doc.type === 'batch' && Array.isArray(doc.rows) && doc.rows.length > 0 ? doc.rows[doc.rows.length - 1] : doc
    const time = row?.time ?? doc.time
    return typeof time === 'number' && Number.isFinite(time) ? time : null
  } catch {
    return null
  }
}

/**
 * @param {{sessionId: string, lineages: Array<{buffer: Buffer, label: string}>, now?: string}} options
 * @returns {{buffer: Buffer, stats: any}}
 */
export function fuseLineages(options) {
  const { sessionId, lineages } = options
  if (!Array.isArray(lineages) || lineages.length < 2) throw new Error('fusion needs at least two lineages')

  const parsed = lineages.map((lineage) => {
    const blocks = blocksOf(lineage.buffer)
    const text = blocks.map((block) => block.text).join('')
    const lines = splitLines(text)
    if (lines.length === 0) throw new Error(lineage.label + ': empty log')
    let header
    try {
      header = JSON.parse(lines[0])
    } catch {
      throw new Error(lineage.label + ': the first line is not a header')
    }
    if (header.type !== 'session') throw new Error(lineage.label + ': the first line is not a session header')
    if (header.id !== sessionId) throw new Error(lineage.label + ': header id is ' + header.id + ', expected ' + sessionId)
    return { ...lineage, blocks, text, lines, header }
  })

  const reference = parsed[0]
  for (const item of parsed.slice(1)) {
    if (item.header.version !== reference.header.version) {
      throw new Error('cannot fuse logs of different format versions: ' + reference.header.version + ' vs ' + item.header.version)
    }
  }

  // Longest common prefix, in whole lines (the header always belongs to it).
  let prefixLines = 1
  for (;;) {
    const candidate = parsed[0].lines[prefixLines]
    if (candidate === undefined) break
    if (!parsed.every((item) => item.lines[prefixLines] === candidate)) break
    prefixLines += 1
  }

  const tails = parsed.map((item) => {
    const lines = item.lines.slice(prefixLines)
    const times = lines.map(eventTime).filter((time) => time !== null)
    return {
      label: item.label,
      lines,
      text: lines.length > 0 ? lines.join('\n') + '\n' : '',
      linesCount: lines.length,
      firstAt: times.length > 0 ? times[0] : null,
      lastAt: times.length > 0 ? times[times.length - 1] : null,
      sha256: sha256(Buffer.from(lines.join('\n'), 'utf8')),
    }
  })

  // Deterministic order: the tail that ends first goes first, so the newest work is last.
  // Ties are broken by content, never by input order.
  const ordered = tails.slice().sort((a, b) => {
    const timeA = a.lastAt ?? Number.MAX_SAFE_INTEGER
    const timeB = b.lastAt ?? Number.MAX_SAFE_INTEGER
    if (timeA !== timeB) return timeA - timeB
    return a.sha256.localeCompare(b.sha256)
  })

  const headerLine = reference.lines[0]
  const prefixBody = parsed[0].lines.slice(1, prefixLines)

  // The prefix keeps its original bytes — seq included — so its compressed frames can be reused
  // and chunk dedupe still applies. Only the tails are renumbered, starting after the prefix.
  const prefixText = headerLine + '\n' + (prefixBody.length > 0 ? prefixBody.join('\n') + '\n' : '')
  const prefixBytes = Buffer.from(prefixText, 'utf8')

  let nextSeq = 1
  for (const line of prefixBody) {
    const last = lineEventSeq(line)
    if (last !== null) nextSeq = Math.max(nextSeq, last + 1)
  }

  const tailLines = []
  for (const tail of ordered) {
    for (const line of tail.lines) tailLines.push(rewriteSeq(line, () => nextSeq++))
  }

  const fusedBytes = Buffer.concat([
    prefixBytes,
    Buffer.from(tailLines.length > 0 ? tailLines.join('\n') + '\n' : '', 'utf8'),
  ])

  // Reuse the source's compressed frames for every full block inside the shared prefix.
  let reusedBytes = 0
  const reusedFrames = []
  for (const block of reference.blocks) {
    const blockBytes = Buffer.from(block.text, 'utf8')
    if (reusedBytes + blockBytes.length > prefixBytes.length) break
    if (!prefixBytes.subarray(reusedBytes, reusedBytes + blockBytes.length).equals(blockBytes)) break
    reusedFrames.push(block.raw)
    reusedBytes += blockBytes.length
  }

  const remainder = fusedBytes.subarray(reusedBytes)
  const frames = [...reusedFrames, ...compressBlocks(remainder)]
  const buffer = Buffer.concat(frames)
  const renumbered = [...prefixBody, ...tailLines]

  const allTimes = renumbered.map(eventTime).filter((time) => time !== null)
  return {
    buffer,
    stats: {
      sessionId,
      lineages: parsed.length,
      prefixLines,
      prefixBytes: prefixBytes.length,
      prefixBytesReused: reusedBytes,
      tails: ordered.map((tail) => ({
        label: tail.label,
        lines: tail.linesCount,
        bytes: Buffer.byteLength(tail.text, 'utf8'),
        firstAt: tail.firstAt,
        lastAt: tail.lastAt,
      })),
      events: renumbered.length,
      seqRenumbered: true,
      bytes: buffer.length,
      firstEventAt: allTimes[0] ?? null,
      lastEventAt: allTimes[allTimes.length - 1] ?? null,
    },
  }
}

/** @param {string} line @param {() => number} nextSeq */
function rewriteSeq(line, nextSeq) {
  let doc
  try {
    doc = JSON.parse(line)
  } catch {
    return line
  }
  if (doc.type === 'batch' && Array.isArray(doc.rows)) {
    doc.rows = doc.rows.map((row) => ({ ...row, seq: nextSeq() }))
    return JSON.stringify(doc)
  }
  doc.seq = nextSeq()
  return JSON.stringify(doc)
}

/** @param {string} line */
function lineEventSeq(line) {
  try {
    const doc = JSON.parse(line)
    if (doc.type === 'batch' && Array.isArray(doc.rows) && doc.rows.length > 0) {
      const last = doc.rows[doc.rows.length - 1]
      return typeof last.seq === 'number' ? last.seq : null
    }
    return typeof doc.seq === 'number' ? doc.seq : null
  } catch {
    return null
  }
}