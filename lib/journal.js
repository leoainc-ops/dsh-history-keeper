/**
 * Import journal: what an automatic import put on this machine, and how to take it back.
 *
 * The import itself is safe (M2 merges in place and verifies). What needs an undo is the *host*:
 * the sessions the import wrote into `sessions/`. The journal records exactly those files, the
 * manifest it wrote, and an expiry, so `keeper import --undo` can remove them and the operator can
 * decide before the window closes (7 days, or the first export — an export means the work travels
 * on, and undoing locally would only hide it).
 */
import fs from 'node:fs'
import path from 'node:path'

import { INCOMING_DIR, JOURNAL_FILE } from './paths.js'
import { toIso } from './util.js'

export const JOURNAL_KIND = 'keeper-import-journal'
export const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

/** @param {string} home */
export function journalPath(home) {
  return path.join(home, JOURNAL_FILE)
}

/** @param {string} home */
export function incomingPath(home) {
  return path.join(home, INCOMING_DIR)
}

/**
 * @param {string} home
 * @param {{created: Array<{sessionId: string, file: string, bytes: number}>, manifestSeq: number|null,
 *          source: any, storeId: string, now?: string}} entry
 */
export function writeJournal(home, entry) {
  const now = entry.now ?? toIso()
  const journal = {
    kind: JOURNAL_KIND,
    version: 1,
    createdAt: now,
    armed: true,
    expiresAt: new Date(Date.parse(now) + UNDO_WINDOW_MS).toISOString(),
    sessionsCreated: entry.created,
    manifestSeq: entry.manifestSeq ?? null,
    source: entry.source ?? null,
    storeId: entry.storeId ?? null,
  }
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(journalPath(home), JSON.stringify(journal, null, 2) + '\n', 'utf8')
  return journal
}

/** @param {string} home @returns {any|null} */
export function readJournal(home) {
  try {
    return JSON.parse(fs.readFileSync(journalPath(home), 'utf8'))
  } catch {
    return null
  }
}

/** @param {string} home */
export function clearJournal(home) {
  try {
    fs.rmSync(journalPath(home), { force: true })
  } catch {
    /* an unreadable journal is not worth failing over */
  }
}

/**
 * Close the undo window and say why. An expired journal is kept (not deleted) as a record: the
 * import happened, and that stays true.
 * @param {string} home
 * @param {'export'|'expired'|'undone'|'manual'} reason
 * @param {string} [now]
 */
export function closeJournal(home, reason, now = toIso()) {
  const journal = readJournal(home)
  if (!journal) return null
  const closed = { ...journal, armed: false, closedAt: now, closedBecause: reason }
  fs.writeFileSync(journalPath(home), JSON.stringify(closed, null, 2) + '\n', 'utf8')
  return closed
}

/**
 * @typedef {{canUndo: boolean, reason: string|null, journal: any|null}}
 */

/**
 * Whether an undo is still possible, and why not when it is not.
 * @param {string} home
 * @param {string} [now]
 * @returns {{canUndo: boolean, reason: string|null, journal: any|null}}
 */
export function undoStatus(home, now = toIso()) {
  const journal = readJournal(home)
  if (!journal) return { canUndo: false, reason: 'no import to undo', journal: null }
  if (journal.armed !== true) return { canUndo: false, reason: 'the window closed: ' + (journal.closedBecause ?? 'unknown'), journal }
  if (Date.parse(now) > Date.parse(journal.expiresAt)) return { canUndo: false, reason: 'the 7-day window expired', journal }
  return { canUndo: true, reason: null, journal }
}
