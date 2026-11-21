/**
 * The mount journal: what a mount left on this machine, and how to take it back.
 *
 * A mount writes session files, publishes sessions and attaches them to workspaces. Any of those can
 * be wrong, and the user must be able to undo it without guessing. This file records exactly what
 * was created, where, and from which vault, and `undoMount` reverses only that.
 *
 * @module core/mount-journal
 */
import fs from 'node:fs'
import path from 'node:path'

export const MOUNTS_FILE = 'history-keeper-mounts.json'
export const MOUNTS_FORMAT = 'dsh-history-keeper/mount-journal/1'
const MAX_ENTRIES = 20

/** Where the journal lives for a given DSH home. */
export function journalPath(home) {
  return path.join(home, MOUNTS_FILE)
}

/** Read the journal; a missing file is an empty journal, a damaged one is refused. */
export function readJournal(home) {
  let raw
  try {
    raw = fs.readFileSync(journalPath(home), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return { format: MOUNTS_FORMAT, mounts: [] }
    throw error
  }
  const parsed = JSON.parse(raw)
  if (parsed?.format !== MOUNTS_FORMAT || !Array.isArray(parsed.mounts)) throw new Error('invalid mount journal: ' + journalPath(home))
  return parsed
}

/** Record one mount, keeping the last entries. */
export function recordMount(home, entry) {
  const journal = readJournal(home)
  const record = {
    id: entry.id ?? 'mount-' + Date.now(),
    at: entry.at ?? new Date().toISOString(),
    mode: entry.mode ?? 'archivo',
    vault: entry.vault ?? null,
    home: entry.home ?? home,
    created: entry.created ?? [],
    published: entry.published ?? [],
    attached: entry.attached ?? [],
    translations: entry.translations ?? [],
    undoneAt: null,
  }
  journal.mounts = [record, ...journal.mounts].slice(0, MAX_ENTRIES)
  writeJournal(home, journal)
  return record
}

/** The most recent mount that has not been undone. */
export function lastMount(home) {
  const journal = readJournal(home)
  return journal.mounts.find((mount) => mount.undoneAt === null) ?? null
}

/**
 * Undo one mount: delete the session files it created and detach what it attached.
 *
 * Only paths inside `<home>/sessions` are deleted, and only the ones the journal recorded. Anything
 * else is reported as refused instead of touched.
 *
 * @param {string} home
 * @param {{id?: string, detach?: (item: {sessionId: string, workspaceId?: string}) => Promise<any>|any,
 *          now?: string}} [options]
 */
export async function undoMount(home, options = {}) {
  const { id = null, detach = null, now = new Date().toISOString() } = options
  const journal = readJournal(home)
  // Find the mount in the SAME journal object that will be written: reading it again would
  // modify a copy and leave `undoneAt` null on disk.
  const mount = id ? journal.mounts.find((item) => item.id === id) : journal.mounts.find((item) => item.undoneAt === null)
  if (!mount) return { status: 'nothing-to-undo', removed: [], detached: [], refused: [] }
  if (mount.undoneAt) return { status: 'already-undone', removed: [], detached: [], refused: [], mount }

  const sessionsRoot = path.resolve(home, 'sessions') + path.sep
  const removed = []
  const refused = []
  for (const file of mount.created ?? []) {
    const target = path.resolve(file.path)
    if (!target.startsWith(sessionsRoot)) {
      refused.push({ path: file.path, reason: 'outside the sessions tree' })
      continue
    }
    try {
      fs.rmSync(target, { force: true })
      removed.push(file.path)
    } catch (error) {
      refused.push({ path: file.path, reason: error.message })
    }
  }

  const detached = []
  if (typeof detach === 'function') {
    for (const item of mount.attached ?? []) {
      try {
        await detach(item)
        detached.push(item.sessionId)
      } catch (error) {
        refused.push({ sessionId: item.sessionId, reason: error.message })
      }
    }
  }

  mount.undoneAt = now
  writeJournal(home, journal)
  return { status: 'undone', removed, detached, refused, mount }
}

/** Mark a mount undone without touching the filesystem (the sessions were never written). */
export function markUndone(home, id, now = new Date().toISOString()) {
  const journal = readJournal(home)
  const mount = journal.mounts.find((item) => item.id === id)
  if (!mount) return null
  mount.undoneAt = now
  writeJournal(home, journal)
  return mount
}

function writeJournal(home, journal) {
  const file = journalPath(home)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}
