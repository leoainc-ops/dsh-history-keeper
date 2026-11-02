/**
 * Lineage report: which conversations were continued, and by whom.
 *
 * A session is *linear* when the vault holds one lineage for it (whether or not the local copy is
 * behind or ahead). It is *continued* when two or more lineages exist — the same session written
 * forward on different machines — with one visible and the rest archived. The distinction is what
 * the user needs before deciding what to fuse.
 *
 * Read-only: it decrypts to measure, and writes nothing.
 */
import { decodePayload } from './payload.js'
import { collectSessions } from './verify.js'

/**
 * Timestamp of the last event in a log, in milliseconds. The header frame carries none.
 * The buffer is the session file as DSH wrote it, so it is still compressed.
 * @param {Buffer} buffer
 * @returns {number|null}
 */
export function lastEventAt(buffer) {
  const decoded = decodePayload(buffer)
  if (!decoded.ok) return null
  const text = decoded.text
  let end = text.length
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1
  const start = text.lastIndexOf('\n', end - 1) + 1
  const line = text.slice(start, end)
  try {
    const doc = JSON.parse(line)
    const row = doc.type === 'batch' && Array.isArray(doc.rows) && doc.rows.length > 0 ? doc.rows[doc.rows.length - 1] : doc
    const time = row?.time ?? doc.time
    if (typeof time === 'number' && Number.isFinite(time)) return time
  } catch {
    /* a torn or unparsable tail simply has no timestamp to report */
  }
  return null
}

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @returns {{sessions: Array<any>, totals: {linear: number, continued: number, lineages: number, archived: number}}}
 */
export function lineageReport(store) {
  const { sessions, archived } = collectSessions(store)

  const archivedBySession = new Map()
  for (const entry of archived.values()) {
    const list = archivedBySession.get(entry.sessionId) ?? []
    list.push({
      bytes: entry.bytes,
      frames: entry.frames,
      chunks: entry.chunks,
      lastEventAt: lastEventAt(entry.buffer),
      archived: true,
    })
    archivedBySession.set(entry.sessionId, list)
  }

  const rows = []
  for (const session of sessions.values()) {
    const continuations = archivedBySession.get(session.sessionId) ?? []
    const visible = {
      bytes: session.bytes,
      frames: session.frames,
      chunks: session.chunks,
      lastEventAt: lastEventAt(session.buffer),
      archived: false,
    }
    const all = [visible, ...continuations]
    const latest = all.reduce((max, item) => Math.max(max, item.lastEventAt ?? 0), 0)
    rows.push({
      sessionId: session.sessionId,
      cwd: session.header?.cwd ?? null,
      state: continuations.length > 0 ? 'continued' : 'linear',
      lineages: all.length,
      visible,
      continuations,
      // Does the visible lineage hold the newest event of every lineage?
      visibleIsNewest: (visible.lastEventAt ?? 0) >= latest,
      newestAt: latest || null,
    })
    archivedBySession.delete(session.sessionId)
  }

  // An archived entry with no visible counterpart is a data anomaly: report it, never hide it.
  for (const [sessionId, list] of archivedBySession) {
    rows.push({
      sessionId,
      cwd: null,
      state: 'orphan-archive',
      lineages: list.length,
      visible: null,
      continuations: list,
      visibleIsNewest: false,
      newestAt: list.reduce((max, item) => Math.max(max, item.lastEventAt ?? 0), 0) || null,
    })
  }

  rows.sort((a, b) => (a.state === b.state ? String(a.cwd ?? '').localeCompare(String(b.cwd ?? '')) : a.state.localeCompare(b.state)))

  return {
    sessions: rows,
    totals: {
      linear: rows.filter((row) => row.state === 'linear').length,
      continued: rows.filter((row) => row.state === 'continued').length,
      orphanArchive: rows.filter((row) => row.state === 'orphan-archive').length,
      lineages: rows.reduce((sum, row) => sum + row.lineages, 0),
      archived: rows.reduce((sum, row) => sum + row.continuations.length, 0),
    },
  }
}
