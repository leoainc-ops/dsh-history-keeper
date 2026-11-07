/**
 * Import: verify a carried vault and bring it into the local one **in place**.
 *
 * The previous version of this module merged into a new directory and swapped it in: the same
 * bytes were sealed again and the old vault stayed on disk, so each trip multiplied the size.
 * Now the merge writes one manifest into the local vault and reuses existing objects, so the
 * vault only grows by the bytes it did not have.
 *
 * Safety:
 *  - the carried vault is verified first; if it does not verify, nothing is touched;
 *  - the format is checked against this keeper before anything is written;
 *  - `mergeIntoStore` holds the store lock, keeps the previous head for rollback, and verifies
 *    the result; a failure restores the previous state;
 *  - sessions are restored byte-exact and restore never overwrites.
 *
 * `swap` is accepted for compatibility and ignored: the import is always in place now.
 */
import { checkSession, hostVocabulary, sessionsRootOf } from './compat.js'
import { mergeIntoStore } from './merge.js'
import { restore } from './restore.js'
import { STORE_FORMAT } from './store.js'
import { toIso } from './util.js'
import { collectSessions, verifyStore } from './verify.js'

/**
 * @param {{stickStore: any, localStore: any, localPassphrase: string, stickPassphrase: string,
 *          home?: string|null, device?: any, swap?: boolean, dryRun?: boolean, now?: string,
 *          onDivergence?: 'owner'|'error'}} options
 */
export function importVault(options) {
  const {
    stickStore,
    localStore,
    localPassphrase,
    stickPassphrase,
    home = null,
    device = null,
    dryRun = false,
    now = toIso(),
    onDivergence = 'owner',
  } = options
  if (!localPassphrase) throw new Error('import needs the local passphrase')
  if (!stickPassphrase) throw new Error('import needs the passphrase of the carried vault')
  if (!device || !device.deviceId) throw new Error('import needs the device identity of this machine')

  // A vault written by a newer keeper is not something this one can interpret: say so with the
  // format in hand instead of failing later with a cryptic store error.
  if (stickStore.meta.format && stickStore.meta.format !== STORE_FORMAT) {
    throw new Error('the carried vault uses format ' + stickStore.meta.format + '; this keeper speaks ' + STORE_FORMAT + ' (update the plugin on this machine first)')
  }

  const stickChecked = verifyStore(stickStore)
  if (!stickChecked.ok) {
    throw new Error(
      'the carried vault does not verify (' +
        [...new Set(stickChecked.problems.map((problem) => problem.code))].join(', ') +
        '); nothing was imported',
    )
  }

  const merged = mergeIntoStore({ localStore, stickStore, device, now, onDivergence, dryRun })

  const report = {
    kind: 'keeper-import',
    version: 2,
    createdAt: now,
    dryRun,
    stick: {
      storeId: stickStore.meta.storeId,
      deviceName: stickStore.meta.deviceName ?? null,
      totals: stickChecked.totals,
    },
    merge: {
      sessions: merged.sessions.length,
      archived: merged.archived.length,
      chunks: merged.stats.chunks,
      reusedChunks: merged.stats.reused,
      sealedChunks: merged.stats.sealed,
      sealedBytes: merged.stats.sealedBytes,
      verification: merged.verification,
    },
    restored: null,
  }
  if (dryRun) return report

  // What this host will be able to open, decided before any session is written.
  if (home) {
    const host = hostVocabulary({ sessionsRoot: sessionsRootOf(home) })
    const preflight = { readable: 0, unreadable: [] }
    for (const session of collectSessions(localStore).sessions.values()) {
      const compat = checkSession(session.buffer, host.types, { complete: host.complete })
      if (compat.readable) preflight.readable += 1
      else preflight.unreadable.push({ sessionId: session.sessionId, unknownEvents: compat.unknown })
    }
    report.preflight = preflight

    const restored = restore(localStore, { home })
    report.restored = {
      home,
      created: restored.created.map((item) => ({ sessionId: item.sessionId, bytes: item.bytes })),
      identical: restored.identical.map((item) => item.sessionId),
      refused: restored.refused.map((item) => ({ sessionId: item.sessionId, reason: item.message })),
      incompatible: (restored.incompatible ?? []).map((item) => ({ sessionId: item.sessionId, unknownEvents: item.unknownEvents })),
      attachments: (restored.attachments ?? []).map((item) => ({ hash: item.hash, action: item.action })),
      problems: restored.problems.map((problem) => problem.code),
    }
  }
  return report
}
