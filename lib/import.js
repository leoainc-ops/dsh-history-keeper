/**
 * Import: verify a carried vault, merge it with the local one, and (on request) make it the local
 * vault and restore its sessions into the DSH home.
 *
 * Two stages on purpose:
 *  - the default only prepares: verify the stick copy, merge it with the local vault into a NEW
 *    directory, verify the result. Nothing live is touched, so it is safe to run any time.
 *  - `swap` moves the new vault into place, keeps the previous one aside, and restores sessions
 *    byte-exact. That writes the live vault and the host's session tree, so it belongs to a moment
 *    with DSH closed.
 *
 * Nothing is synthesized: sessions are copied as the host wrote them, and restore never overwrites.
 */
import fs from 'node:fs'
import path from 'node:path'

import { mergeStores } from './merge.js'
import { restore } from './restore.js'
import { openStore } from './store.js'
import { toIso } from './util.js'
import { verifyStore } from './verify.js'

/**
 * @param {{stickStore: any, localStore: any, localPassphrase: string, stickPassphrase: string,
 *          home?: string|null, swap?: boolean, now?: string, onDivergence?: 'owner'|'error'}} options
 */
export function importVault(options) {
  const {
    stickStore,
    localStore,
    localPassphrase,
    stickPassphrase,
    home = null,
    swap = false,
    now = toIso(),
    onDivergence = 'owner',
  } = options
  if (!localPassphrase) throw new Error('import needs the local passphrase')
  if (!stickPassphrase) throw new Error('import needs the passphrase of the carried vault')

  const stickChecked = verifyStore(stickStore)
  if (!stickChecked.ok) {
    throw new Error(
      'the carried vault does not verify (' +
        [...new Set(stickChecked.problems.map((problem) => problem.code))].join(', ') +
        '); nothing was imported',
    )
  }

  const stamp = now.replace(/[:.]/g, '-')
  const preparedDir = localStore.dir + '.new-' + stamp
  const merged = mergeStores([localStore, stickStore], {
    outDir: preparedDir,
    passphrase: localPassphrase,
    deviceName: localStore.meta.deviceName ?? 'merged',
    now,
    onDivergence,
  })
  const prepared = openStore(preparedDir, localPassphrase)
  const preparedChecked = verifyStore(prepared)
  if (!preparedChecked.ok) {
    throw new Error(
      'the merged vault does not verify (' +
        [...new Set(preparedChecked.problems.map((problem) => problem.code))].join(', ') +
        '); the local vault was left untouched',
    )
  }

  const report = {
    kind: 'keeper-import',
    version: 1,
    createdAt: now,
    stick: {
      storeId: stickStore.meta.storeId,
      deviceName: stickStore.meta.deviceName ?? null,
      totals: stickChecked.totals,
    },
    merge: {
      sessions: merged.sessions.length,
      archived: merged.archived.length,
      dedupedBytes: merged.stats.dedupedBytes,
      verification: merged.verification,
    },
    prepared: preparedDir,
    swapped: false,
    replaced: null,
    restored: null,
  }

  if (!swap) {
    report.nextStep = 'run `keeper import --from <stick> --swap` with DSH closed to make it the local vault'
    return report
  }

  const replaced = localStore.dir + '.replaced-' + stamp
  fs.renameSync(localStore.dir, replaced)
  fs.renameSync(preparedDir, localStore.dir)
  report.swapped = true
  report.replaced = replaced

  const local = openStore(localStore.dir, localPassphrase)
  const localChecked = verifyStore(local)
  if (!localChecked.ok) {
    // Put the previous vault back: a broken swap must not leave the machine without a vault.
    fs.renameSync(localStore.dir, localStore.dir + '.broken-' + stamp)
    fs.renameSync(replaced, localStore.dir)
    throw new Error(
      'the swapped vault does not verify (' +
        [...new Set(localChecked.problems.map((problem) => problem.code))].join(', ') +
        '); the previous vault was restored',
    )
  }

  if (home) {
    const restored = restore(local, { home })
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
