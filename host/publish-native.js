/**
 * Native publication: hand the conversation to DSH so DSH writes, indexes and groups it.
 *
 * This is the difference between 1.0 and 2.0. 1.0 wrote a log file into the host's tree and hoped
 * the host would notice; here the host creates the session with the original `id`, `createdAt` and a
 * `cwd` the operator chose, appends the events, flushes and closes. The vault keeps the original;
 * the host keeps the copy it wrote.
 *
 * The module is host-free: it receives the `sessionPersistence` service, so it can be tested against
 * a fake host and used from the plugin without changes.
 *
 * @module host/publish-native
 */
import { createHash } from 'node:crypto'

import { decodePayload } from '../lib/payload.js'

/**
 * Split a session log into its header line and its events, and check that the events are contiguous.
 *
 * The host's `create(header)` writes the header itself, so an append must carry only the events that
 * follow it. A gap in `seq` would make the host reconstruct a different session, so it is refused
 * here, before anything is created.
 * @param {Buffer} buffer the full session log, as the vault stores it
 * @returns {{ok: true, header: any, events: any[]} | {ok: false, code: string, message: string}}
 */
export function parseSessionLog(buffer) {
  const decoded = decodePayload(buffer)
  if (!decoded.ok) return { ok: false, code: 'BAD_LOG', message: decoded.failed ?? 'the log could not be decoded' }

  const lines = decoded.text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { ok: false, code: 'BAD_LOG', message: 'the log has no lines' }

  let header = null
  let first = 0
  try {
    const candidate = JSON.parse(lines[0])
    if (candidate && candidate.type === 'session') {
      header = candidate
      first = 1
    }
  } catch {
    return { ok: false, code: 'BAD_LOG', message: 'the first line is not valid JSON' }
  }

  const events = []
  for (let index = first; index < lines.length; index++) {
    let event
    try {
      event = JSON.parse(lines[index])
    } catch {
      return { ok: false, code: 'BAD_LOG', message: 'invalid JSON at line ' + (index + 1) }
    }
    const expected = events.length + 1
    if (event.seq !== expected) {
      return { ok: false, code: 'SEQ_GAP', message: 'expected event seq ' + expected + ', found ' + event.seq + ' at line ' + (index + 1) }
    }
    events.push(event)
  }
  return { ok: true, header, events }
}

/**
 * The content seal: a hash over what the session *says*, independent of the file's compression.
 *
 * Both sides of a delivery can compute it: the vault from the original events, the host from the
 * events it wrote. Equal seals mean the conversation survived the trip even if the bytes differ.
 * @param {any[]} events
 * @returns {string}
 */
export function contentSeal(events) {
  const canonical = events.map((event) => JSON.stringify({ seq: event.seq, type: event.type, data: event.data ?? null })).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Publish one session through the host's own writer.
 *
 * @param {{session: {sessionId: string, header: any, buffer: Buffer},
 *          persistence: any, cwd?: string|null, batchSize?: number, signal?: AbortSignal,
 *          readEvents?: (id: string) => Promise<any[]>|any[]}} options
 * @returns {Promise<{status: 'created'|'exists'|'failed', sessionId: string, events?: number,
 *          batches?: number, seal?: string, sealMatched?: boolean|null, code?: string, message?: string}>}
 */
export async function publishNative(options) {
  const { session, persistence, cwd = null, batchSize = 500, signal = null, readEvents = null } = options ?? {}
  if (!persistence || typeof persistence.create !== 'function') {
    return { status: 'failed', sessionId: session?.sessionId, code: 'NO_SESSION_WRITER', message: 'the host exposes no session writer' }
  }

  const parsed = parseSessionLog(session.buffer)
  if (!parsed.ok) return { status: 'failed', sessionId: session.sessionId, code: parsed.code, message: parsed.message }

  // The header is the original one; only the working directory may be translated, and the id and the
  // creation time are never touched.
  const header = { ...(session.header ?? parsed.header ?? {}), id: session.sessionId ?? session.header?.id }
  if (cwd) header.cwd = cwd

  let handle
  try {
    handle = await persistence.create(header, signal ? { signal } : undefined)
  } catch (error) {
    if (isAlreadyExists(error)) return { status: 'exists', sessionId: header.id, message: error.message }
    return { status: 'failed', sessionId: header.id, code: error.code ?? 'CREATE_FAILED', message: error.message ?? String(error) }
  }

  let appended = 0
  let batches = 0
  try {
    for (let offset = 0; offset < parsed.events.length; offset += batchSize) {
      if (signal?.aborted) throw signal.reason ?? new Error('aborted')
      const batch = parsed.events.slice(offset, offset + batchSize)
      await handle.append(batch, signal ? { signal } : undefined)
      appended += batch.length
      batches += 1
    }
    await handle.flush()
  } catch (error) {
    try {
      await handle.close()
    } catch {
      /* closing must not mask the original failure */
    }
    return { status: 'failed', sessionId: header.id, code: error.code ?? 'APPEND_FAILED', message: error.message ?? String(error), events: appended, batches }
  }
  try {
    await handle.close()
  } catch {
    /* close is advisory here: the flush already made the artifact durable */
  }

  const seal = contentSeal(parsed.events)
  let sealMatched = null
  if (typeof readEvents === 'function') {
    try {
      const published = await readEvents(header.id)
      if (Array.isArray(published)) sealMatched = contentSeal(published) === seal
    } catch {
      sealMatched = null
    }
  }

  return { status: 'created', sessionId: header.id, events: appended, batches, seal, sealMatched }
}

/** The host signals a duplicate id this way (class name or message). */
function isAlreadyExists(error) {
  if (!error) return false
  const name = String(error.name ?? '')
  const message = String(error.message ?? '')
  return name === 'SessionAlreadyExistsError' || /already exists/i.test(message)
}
