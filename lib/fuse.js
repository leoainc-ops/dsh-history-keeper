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

  // A DSH log is a sequence of turns: `turn/start` opens one and `turn/end` closes it, and the
  // reader refuses a start while a turn is open. A raw frame splice therefore produces a corrupt
  // log ("turn/start does not open the expected turn"). Cut at turn boundaries:
  //  - the prefix keeps everything up to its last complete turn;
  //  - each tail keeps only the turns it contains, dropping the partial turn at each seam.
  let prefixCut = 1
  for (let index = prefixLines - 1; index >= 1; index -= 1) {
    if (lineTypes(parsed[0].lines[index]).at(-1) === 'turn/end') {
      prefixCut = index + 1
      break
    }
  }

  const tails = parsed.map((item) => {
    const raw = item.lines.slice(prefixLines)
    let from = raw.findIndex((line) => lineTypes(line)[0] === 'turn/start')
    let to = -1
    for (let index = raw.length - 1; index >= 0; index -= 1) {
      if (lineTypes(raw[index]).at(-1) === 'turn/end') {
        to = index
        break
      }
    }
    const lines = from >= 0 && to >= from ? raw.slice(from, to + 1) : []
    const dropped = raw.length - lines.length
    const times = lines.map(eventTime).filter((time) => time !== null)
    return {
      label: item.label,
      lines,
      dropped,
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
  const prefixBody = parsed[0].lines.slice(1, prefixCut)

  // The prefix keeps its original bytes — seq included — so its compressed frames can be reused
  // and chunk dedupe still applies. Only the tails are renumbered, starting after the prefix.
  const prefixText = headerLine + '\n' + (prefixBody.length > 0 ? prefixBody.join('\n') + '\n' : '')
  const prefixBytes = Buffer.from(prefixText, 'utf8')

  let nextSeq = 1
  let nextTurn = 1
  for (const line of prefixBody) {
    const last = lineEventSeq(line)
    if (last !== null) nextSeq = Math.max(nextSeq, last + 1)
    const turn = lineEventTurn(line)
    if (turn !== null) nextTurn = Math.max(nextTurn, turn + 1)
  }

  // Both branches numbered their turns from the shared prefix, so both tails start at the same
  // turn number. Appending them as-is makes the second tail repeat a turn the reader already
  // consumed ("turn/start does not open the expected turn"), so the tails are renumbered too.
  const state = { nextSeq, nextTurn, current: null }
  const tailLines = []
  for (const tail of ordered) {
    for (const line of tail.lines) tailLines.push(rewriteEvent(line, state))
  }

  // The reader enforces the turn state machine: refuse to emit a log that would not open.
  const turnCheck = validateTurns([...prefixBody, ...tailLines])
  if (!turnCheck.ok) {
    throw new Error('the fused log would not open: ' + turnCheck.message)
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
      prefixFrames: prefixCut,
      prefixBytes: prefixBytes.length,
      prefixBytesReused: reusedBytes,
      tails: ordered.map((tail) => ({
        label: tail.label,
        lines: tail.linesCount,
        droppedFrames: tail.dropped,
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

/**
 * Rewrite `seq` and, for turn-scoped events, `data.turn`.
 * A tail keeps the numbering of the branch it came from, so its turns repeat numbers the prefix
 * already used. The host requires turn/start to carry exactly the next turn number.
 * @param {string} line
 * @param {{nextSeq: number, nextTurn: number, current: number|null}} state
 */
function rewriteEvent(line, state) {
  let doc
  try {
    doc = JSON.parse(line)
  } catch {
    return line
  }
  const rewrite = (row) => {
    const copy = { ...row, seq: state.nextSeq++ }
    if (copy.data && typeof copy.data === 'object' && typeof copy.data.turn === 'number') {
      if (copy.type === 'turn/start') {
        state.current = state.nextTurn++
        copy.data = { ...copy.data, turn: state.current }
      } else if (state.current !== null) {
        copy.data = { ...copy.data, turn: state.current }
      }
    }
    return copy
  }
  if (doc.type === 'batch' && Array.isArray(doc.rows)) {
    doc.rows = doc.rows.map(rewrite)
    return JSON.stringify(doc)
  }
  return JSON.stringify(rewrite(doc))
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
/** Turn number carried by a line, if any. */
function lineEventTurn(line) {
  try {
    const doc = JSON.parse(line)
    const rows = doc.type === 'batch' && Array.isArray(doc.rows) ? doc.rows : [doc]
    for (const row of rows) if (row.data && typeof row.data.turn === 'number') return row.data.turn
    return null
  } catch {
    return null
  }
}

/** Event type of a JSONL line (a batch reports its rows' types, comma-joined). */
function lineTypes(line) {
  try {
    const doc = JSON.parse(line)
    if (doc.type === 'batch' && Array.isArray(doc.rows)) return doc.rows.map((row) => row.type)
    return [doc.type]
  } catch {
    return ['unparseable']
  }
}

/**
 * Walk the turn state machine the host enforces: a start may not open an open turn, an end needs
 * one open, and when the numbers are present they must be exactly sequential.
 */
function validateTurns(lines) {
  let open = null
  let next = null
  for (const line of lines) {
    for (const type of lineTypes(line)) {
      const turn = lineEventTurn(line)
      if (type === 'turn/start') {
        if (open !== null) return { ok: false, message: 'turn/start while a turn is already open' }
        if (next === null) next = turn ?? 1
        if (turn !== null && turn !== next) return { ok: false, message: 'turn/start expects turn ' + next + ' but carries ' + turn }
        open = next
        next += 1
      } else if (type === 'turn/end') {
        if (open === null) return { ok: false, message: 'turn/end without an open turn' }
        if (turn !== null && turn !== open) return { ok: false, message: 'turn/end for turn ' + open + ' carries ' + turn }
        open = null
      }
    }
  }
  if (open !== null) return { ok: false, message: 'the fused log ends with a turn still open' }
  return { ok: true, message: null }
}