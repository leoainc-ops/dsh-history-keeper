/**
 * Automatic import at host start (M5).
 *
 * The workflow it enables: bring the pendrive, copy the carried vault into the drop box
 * (`<home>/history-keeper.incoming`), open DSH. The plugin imports it — merged in place by M2,
 * verified, no copies left behind — restores the sessions the home does not have, and leaves a
 * journal so the operator can undo what was *shown* for seven days (or until the first export).
 *
 * It is deliberately conservative:
 *  - it only looks in one place (the drop box), never at a disk or a pendrive by itself;
 *  - the incoming vault must open with this machine's passphrase and pass verification;
 *  - if an import is still undoable, it does nothing (no repeated imports);
 *  - any failure is reported, never thrown: the host must start even when the import cannot.
 */
import fs from 'node:fs'
import path from 'node:path'

import { checkCompatibility } from './handshake.js'
import { closeJournal, incomingPath, undoStatus, writeJournal } from './journal.js'
import { mergeIntoStore } from './merge.js'
import { restore } from './restore.js'
import { openStore } from './store.js'
import { toIso } from './util.js'
import { verifyStore } from './verify.js'
import { PLUGIN_VERSION } from './version.js'

/**
 * @param {{home: string, store: any, passphrase: string, device: any, now?: string, version?: string}} options
 */
export function autoImport(options) {
  const { home, store, passphrase, device, now = toIso(), version = PLUGIN_VERSION } = options
  const incoming = incomingPath(home)
  const base = { kind: 'keeper-autoimport', version: 1, createdAt: now, incoming }

  if (!fs.existsSync(path.join(incoming, 'meta.json'))) {
    return { ...base, status: 'idle', reason: 'no incoming vault in ' + incoming }
  }

  const undo = undoStatus(home, now)
  if (undo.canUndo) {
    return { ...base, status: 'waiting', reason: 'an import is still undoable; nothing was imported again' }
  }

  let external
  try {
    external = openStore(incoming, passphrase)
  } catch (error) {
    return { ...base, status: 'refused', reason: 'the incoming vault does not open with this passphrase (' + (error.message ?? error) + ')' }
  }
  const compat = checkCompatibility(external.meta, version)
  if (!compat.ok) {
    return { ...base, status: 'refused', reason: compat.errors.map((item) => item.message).join('; ') }
  }
  const verified = verifyStore(external)
  if (!verified.ok) {
    return {
      ...base,
      status: 'refused',
      reason: 'the incoming vault does not verify (' + [...new Set(verified.problems.map((problem) => problem.code))].join(', ') + ')',
    }
  }

  // A failed merge must not leave the drop box occupied: the copy is moved aside with a name that
  // says what happened, and the next attempt starts from a clean box.
  let merged
  try {
    merged = mergeIntoStore({ localStore: store, stickStore: external, device, now })
  } catch (error) {
    const failed = incoming + '.failed-' + now.replace(/[:.]/g, '-')
    try {
      fs.renameSync(incoming, failed)
    } catch {
      /* if it cannot be moved, the report says where it is */
    }
    return { ...base, status: 'failed', reason: error && error.message ? error.message : String(error), staged: failed }
  }
  const restored = merged.changed ? restore(store, { home }) : { created: [], refused: [], incompatible: [], identical: [], problems: [] }

  // The drop box is a staging copy of something the vault now holds: it is DELETED, not kept.
  // Keeping it meant a full duplicate of the vault per import — the duplication M1 exists to remove.
  let staged = null
  if (options.keepStaged === true) {
    staged = incoming + '.imported-' + now.replace(/[:.]/g, '-')
    try {
      fs.renameSync(incoming, staged)
    } catch {
      staged = incoming
    }
  } else {
    try {
      fs.rmSync(incoming, { recursive: true, force: true })
    } catch {
      /* the journal still prevents a second import */
    }
  }

  let journal = null
  if (restored.created.length > 0) {
    journal = writeJournal(home, {
      created: restored.created.map((item) => ({ sessionId: item.sessionId, file: item.target, bytes: item.bytes })),
      manifestSeq: merged.manifestSeq,
      source: merged.sources?.[merged.sources.length - 1] ?? null,
      storeId: store.meta.storeId,
      now,
    })
  }

  return {
    ...base,
    status: 'imported',
    changed: merged.changed,
    merged: {
      sessions: merged.sessions.length,
      archived: merged.archived.length,
      chunks: merged.stats.chunks,
      reusedChunks: merged.stats.reused,
      sealedChunks: merged.stats.sealed,
      sealedBytes: merged.stats.sealedBytes,
      verification: merged.verification,
    },
    restored: {
      created: restored.created.map((item) => ({ sessionId: item.sessionId, bytes: item.bytes })),
      identical: restored.identical.map((item) => item.sessionId),
      refused: restored.refused.map((item) => ({ sessionId: item.sessionId, reason: item.message })),
    },
    journal: journal ? { armed: journal.armed, expiresAt: journal.expiresAt, sessions: journal.sessionsCreated.length } : null,
    staged,
  }
}

/**
 * Take back what an automatic import put in the host's session tree.
 * @param {{home: string, now?: string, dryRun?: boolean}} options
 */
export function undoImport(options) {
  const { home, now = toIso(), dryRun = false } = options
  const status = undoStatus(home, now)
  if (!status.canUndo) return { kind: 'keeper-undo', status: 'refused', reason: status.reason, journal: status.journal }

  const sessionsRoot = path.resolve(path.join(home, 'sessions')) + path.sep
  const removed = []
  const missing = []
  const refused = []
  for (const item of status.journal.sessionsCreated ?? []) {
    const file = path.resolve(item.file ?? '')
    // Only ever delete a file the journal records inside the session tree.
    if (!file.startsWith(sessionsRoot)) {
      refused.push({ ...item, reason: 'outside the session tree' })
      continue
    }
    if (!fs.existsSync(file)) {
      missing.push(item)
      continue
    }
    if (!dryRun) fs.rmSync(file, { force: true })
    removed.push(item)
  }
  if (!dryRun) closeJournal(home, 'undone', now)
  return { kind: 'keeper-undo', status: 'undone', dryRun, removed, missing, refused, journal: status.journal }
}

/**
 * Leave a carried vault in the drop box for the next start, without touching the host now.
 * @param {{home: string, from: string, passphrase: string, now?: string}} options
 */
/**
 * Accept either the vault directory itself or the folder that contains it (a pendrive with
 * `keeper-transfer/vault`). The operator should not have to know which one the command wants.
 * @param {string} from
 */
export function resolveVaultDir(from) {
  const source = path.resolve(from)
  if (fs.existsSync(path.join(source, 'meta.json'))) return source
  const nested = path.join(source, 'vault')
  if (fs.existsSync(path.join(nested, 'meta.json'))) return nested
  throw new Error('no vault at ' + source + ' (looked for meta.json there and in ' + nested + ')')
}
export function stageIncoming(options) {
  const { home, from, passphrase, now = toIso() } = options
  const source = resolveVaultDir(from)
  if (!fs.existsSync(path.join(source, 'meta.json'))) throw new Error('no vault at ' + source)
  const external = openStore(source, passphrase)
  const verified = verifyStore(external)
  if (!verified.ok) throw new Error('the carried vault does not verify (' + [...new Set(verified.problems.map((problem) => problem.code))].join(', ') + '); nothing was staged')

  const incoming = incomingPath(home)
  if (fs.existsSync(path.join(incoming, 'meta.json'))) {
    // A box left by an earlier attempt (or a previous import that could not finish) is not an
    // obstacle: if it is the same vault, it is already staged and the caller should import it.
    const existing = openStore(incoming, passphrase)
    if (existing.meta.storeId === external.meta.storeId) {
      const check = verifyStore(existing)
      if (!check.ok) throw new Error('the drop box holds a damaged copy of this vault (' + [...new Set(check.problems.map((problem) => problem.code))].join(', ') + '); remove ' + incoming)
      return { kind: 'keeper-stage', status: 'reused', incoming, storeId: existing.meta.storeId, sessions: check.totals.sessions, bytes: check.totals.bytes, at: now }
    }
    throw new Error('the drop box already holds a different vault (' + existing.meta.storeId + '): ' + incoming + ' (import or remove it first)')
  }
  if (fs.existsSync(incoming)) throw new Error('the drop box exists but holds no vault: ' + incoming + ' (remove it and try again)')
  fs.mkdirSync(path.dirname(incoming), { recursive: true })
  fs.cpSync(source, incoming, { recursive: true })

  const copy = openStore(incoming, passphrase)
  const check = verifyStore(copy)
  if (!check.ok) {
    fs.rmSync(incoming, { recursive: true, force: true })
    throw new Error('the staged copy does not verify; it was removed')
  }
  return { kind: 'keeper-stage', status: 'staged', incoming, storeId: copy.meta.storeId, sessions: check.totals.sessions, bytes: check.totals.bytes, at: now }
}

/** Close the undo window because the work now travels on (first export). */
export function closeUndoWindow(home, reason = 'export', now = toIso()) {
  return closeJournal(home, reason, now)
}
