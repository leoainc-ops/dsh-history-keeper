/**
 * Catalog: what the vault holds, organized the way a person asks for it.
 *
 * It is **derived**, not stored: every field comes from the manifest chain and from the session
 * bytes the host wrote. Storing an index would duplicate state that can drift from the chain, and
 * would add one write per capture; deriving it keeps the vault honest and the operation read-only.
 *
 * The catalog is the bridge between "a list of sessions" and "a readable conversation": it says
 * which workspace each one belongs to, who wrote it, when it starts and ends, how many turns it
 * has, and which continuations are archived.
 */
import { decodePayload } from './payload.js'
import { sha256 } from './util.js'
import { publishedAttachments } from './snapshot.js'
import { readAllManifests } from './store.js'
import { collectSessions } from './verify.js'

/** @param {number|null} ms */
function iso(ms) {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/**
 * Count turns, events and the time span of one log. The bytes are the host's compressed log, so
 * this decompresses: it is only used by the catalog command, not by capture.
 * @param {Buffer} buffer
 */
export function scanLog(buffer) {
  const decoded = decodePayload(buffer)
  if (!decoded.ok) return { events: 0, turns: 0, firstEventAt: null, lastEventAt: null }
  let events = 0
  let turns = 0
  let firstEventAt = null
  let title = null
  let lastEventAt = null
  for (const line of decoded.text.split('\n')) {
    if (line.length === 0) continue
    let doc
    try {
      doc = JSON.parse(line)
    } catch {
      continue
    }
    const rows = doc.type === 'batch' && Array.isArray(doc.rows) ? doc.rows : [doc]
    for (const row of rows) {
      events += 1
      if (row.type === 'session/title' && typeof row.data?.title === 'string' && row.data.title.length > 0) title = row.data.title
      if (row.type === 'turn/start') turns += 1
      if (typeof row.time === 'number' && Number.isFinite(row.time)) {
        if (firstEventAt === null || row.time < firstEventAt) firstEventAt = row.time
        if (lastEventAt === null || row.time > lastEventAt) lastEventAt = row.time
      }
    }
  }
  return { events, turns, firstEventAt, lastEventAt, title }
}

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 */
export function buildCatalog(store) {
  const chain = readAllManifests(store, { fresh: true })

  // Metadata each manifest records per session: the oldest mention is the origin, the newest one
  // carries what the latest capture knew (plugin version, user).
  const metadata = new Map()
  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      const current = metadata.get(sessionId) ?? { origin: null, capturedBy: null, user: null }
      const lastChunk = Array.isArray(entry.chunks) && entry.chunks.length > 0 ? entry.chunks[entry.chunks.length - 1] : null
      metadata.set(sessionId, {
        origin: entry.origin ?? current.origin,
        capturedBy: entry.capturedBy ?? current.capturedBy,
        user: current.user ?? entry.user ?? null,
      })
    }
  }

  const { sessions, archived } = collectSessions(store)

  const archivedBySession = new Map()
  for (const entry of archived.values()) {
    const list = archivedBySession.get(entry.sessionId) ?? []
    const scanned = scanLog(entry.buffer)
    list.push({
      bytes: entry.bytes,
      frames: entry.frames,
      turns: scanned.turns,
      title: scanned.title,
      firstEventAt: iso(scanned.firstEventAt),
      lastEventAt: iso(scanned.lastEventAt),
      origin: entry.origin ?? metadata.get(entry.sessionId)?.origin ?? null,
    })
    archivedBySession.set(entry.sessionId, list)
  }

  const rows = []
  for (const session of sessions.values()) {
    const scanned = scanLog(session.buffer)
    const meta = metadata.get(session.sessionId) ?? { origin: null, capturedBy: null, user: null }
    rows.push({
      sessionId: session.sessionId,
      workspace: session.header?.cwd ?? null,
      formatVersion: session.formatVersion ?? null,
      bytes: session.bytes,
      frames: session.frames,
      turns: scanned.turns,
      title: scanned.title,
      events: scanned.events,
      firstEventAt: iso(scanned.firstEventAt),
      lastEventAt: iso(scanned.lastEventAt),
      origin: meta.origin,
      capturedBy: meta.capturedBy,
      user: meta.user,
      // The hash of the session exactly as restore writes it: the same value the contract checks.
      sha256: sha256(session.buffer),
      archived: archivedBySession.get(session.sessionId) ?? [],
    })
  }

  rows.sort((a, b) => String(b.lastEventAt ?? '').localeCompare(String(a.lastEventAt ?? '')))

  const attachments = Object.entries(publishedAttachments(chain)).map(([hash, entry]) => ({ hash, bytes: entry.bytes ?? 0 }))

  return {
    store: {
      dir: store.dir,
      storeId: store.meta.storeId,
      format: store.meta.format,
      deviceName: store.meta.deviceName ?? null,
      writer: store.meta.writer ?? null,
      minReader: store.meta.minReader ?? null,
      retention: store.meta.retention ?? null,
      // "Host" in the catalog is the host's data contract, not the app version: a plugin cannot
      // see the DSH build, but the log format is what the vault actually has to carry.
      host: { contract: "dsh session log", formatVersion: rows.length > 0 ? Math.max(...rows.map((row) => row.formatVersion ?? 0)) : null },
    },
    sessions: rows,
    attachments,
    totals: {
      sessions: rows.length,
      archived: rows.reduce((sum, row) => sum + row.archived.length, 0),
      bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      frames: rows.reduce((sum, row) => sum + row.frames, 0),
      turns: rows.reduce((sum, row) => sum + row.turns, 0),
      attachments: attachments.length,
      attachmentBytes: attachments.reduce((sum, item) => sum + item.bytes, 0),
    },
  }
}
