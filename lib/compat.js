/**
 * Compatibility preflight.
 *
 * A session log is a stream of events interpreted by the harness that reads it. A newer
 * harness may write event types an older one does not know, and DSH refuses such a log
 * outright. The keeper cannot change what a host understands — but it can answer the question
 * *before* writing anything: "will this host be able to read this session?".
 *
 * The check does not need version numbers. It compares the event vocabulary of the incoming
 * session against the vocabulary the target host has already written in its own sessions: if
 * the incoming log uses a type that has never appeared here, the host almost certainly does
 * not know it.
 *
 * Only event *type names* are read for the check; the content is never inspected or reported.
 */
import fs from 'node:fs'
import path from 'node:path'

import { decodePayload } from './payload.js'
import { findSessionLogs } from './session-log.js'

/**
 * Event type names in a session log.
 * @param {Buffer} buffer
 * @returns {Set<string>}
 */
export function sessionVocabulary(buffer) {
  const decoded = decodePayload(buffer)
  const types = new Set()
  if (!decoded.ok) return types
  for (const line of decoded.text.split('\n')) {
    if (line.length === 0) continue
    let doc
    try {
      doc = JSON.parse(line)
    } catch {
      continue
    }
    if (doc.type === 'batch' && Array.isArray(doc.rows)) {
      for (const row of doc.rows) if (row && typeof row.type === 'string') types.add(row.type)
    } else if (typeof doc.type === 'string') {
      types.add(doc.type)
    }
  }
  return types
}

/**
 * Vocabulary a host knows, learned from the sessions it wrote itself.
 *
 * Scanning every session would be expensive, so the newest ones are used: the vocabulary of a
 * host is stable across its own logs, and recent logs are the best evidence of what it writes
 * today. The budget is in bytes of decompressed input, not in files, so one huge session does
 * not starve the check.
 *
 * @param {{sessionsRoot: string, maxSessions?: number, maxBytes?: number}} options
 * @returns {{types: Set<string>, scanned: number, empty: boolean, complete: boolean}}
 */
export function hostVocabulary(options) {
  const { sessionsRoot, maxSessions = 64, maxBytes = 64 * 1024 * 1024 } = options
  const logs = findSessionLogs(sessionsRoot)
    .map((log) => ({ log, mtime: statMtime(log.file) }))
    .sort((a, b) => b.mtime - a.mtime)

  const types = new Set()
  let scanned = 0
  let bytes = 0
  let complete = true
  for (const { log } of logs) {
    if (scanned >= maxSessions || bytes >= maxBytes) {
      complete = scanned < logs.length
      break
    }
    let buffer
    try {
      buffer = fs.readFileSync(log.file)
    } catch {
      continue
    }
    bytes += buffer.length
    for (const type of sessionVocabulary(buffer)) types.add(type)
    scanned += 1
  }
  return { types, scanned, empty: scanned === 0, complete }
}

function statMtime(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

/**
 * Decide whether a host with this vocabulary can read the session.
 * @param {Buffer} buffer
 * @param {Set<string>} hostTypes
 * @param {{complete?: boolean}} [options] when the vocabulary sample was cut, the answer is advisory
 * @returns {{readable: boolean, unknown: string[], advisory: boolean}}
 */
export function checkSession(buffer, hostTypes, options = {}) {
  if (hostTypes.size === 0) {
    // Nothing to compare against: a host with no sessions of its own has no vocabulary yet.
    // Saying "readable" would be a guess; saying "unknown" would block every first restore.
    return { readable: true, unknown: [], advisory: false }
  }
  const unknown = []
  for (const type of sessionVocabulary(buffer)) {
    if (!hostTypes.has(type)) unknown.push(type)
  }
  // A cut sample can miss a type the host knows but has not written recently: report the
  // difference, never block a restore on it.
  const advisory = options.complete === false
  return { readable: unknown.length === 0 || advisory, unknown: unknown.sort(), advisory }
}

/**
 * Sessions root from a DSH home.
 * @param {string} home
 * @returns {string}
 */
export function sessionsRootOf(home) {
  return path.join(home, 'sessions')
}
