/**
 * `keeper doctor`: what the vault consumes, what is recoverable, and what is left lying around.
 *
 * It is read-only. Every line says one of three things: the vault is fine, there is something the
 * operator can reclaim, or there is a leftover that should be removed. The point is that resource
 * use is visible without reading five commands.
 */
import fs from 'node:fs'
import path from 'node:path'

import { collectGarbage } from './compact.js'
import { incomingPath, journalPath, readJournal, undoStatus } from './journal.js'
import { evaluatePolicy } from './policy.js'
import { listDeviceHeads, readAllManifests, readManifestChain } from './store.js'
import { collectSessions, verifyStore } from './verify.js'

const MB = 1024 * 1024
const human = (bytes) => (bytes >= MB ? (bytes / MB).toFixed(2) + ' MiB' : (bytes / 1024).toFixed(1) + ' KiB')

function dirSize(dir) {
  try {
    let total = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) total += dirSize(full)
      else if (entry.isFile()) total += fs.statSync(full).size
    }
    return total
  } catch {
    return 0
  }
}

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home: string, now?: string}} options
 */
export function runDoctor(store, options) {
  const home = options.home ?? path.dirname(store.dir)
  const findings = []
  const add = (level, id, message, action = null) => findings.push({ level, id, message, action })

  const verified = verifyStore(store)
  if (verified.ok) add('ok', 'verify', 'the vault verifies: ' + verified.totals.sessions + ' session(s), ' + human(verified.totals.bytes) + ', ' + verified.totals.frames + ' frame(s)')
  else add('problem', 'verify', 'the vault does NOT verify: ' + [...new Set(verified.problems.map((problem) => problem.code))].join(', '), 'keeper verify')

  // Garbage
  let garbage = null
  try {
    garbage = collectGarbage(store, { dryRun: true })
    if (garbage.removable > 0) {
      add('reclaim', 'garbage', garbage.removable + ' object(s) are no longer referenced: ' + human(garbage.bytes ?? 0) + ' recoverable', 'keeper gc --yes (close DSH first)')
    } else {
      add('ok', 'garbage', 'no unreferenced objects')
    }
  } catch (error) {
    add('problem', 'garbage', 'cannot compute garbage: ' + (error.message ?? error))
  }

  // Chain and compaction
  try {
    const chain = readAllManifests(store, { fresh: true })
    const policy = evaluatePolicy({ store, chain: readManifestChain(store), options: { minManifests: store.meta.retention?.compactAfterManifests ?? 50 } })
    const checkpoints = chain.filter((doc) => doc.kind === 'checkpoint').length
    add(
      policy.compact ? 'reclaim' : 'ok',
      'chain',
      chain.length + ' manifest(s), ' + checkpoints + ' checkpoint(s); ' + policy.reason,
      policy.compact ? 'keeper compact (close DSH first)' : null,
    )
    const heads = listDeviceHeads(store.dir)
    add('info', 'devices', heads.length + ' device head(s): ' + heads.map((head) => head.deviceName ?? head.deviceId.slice(0, 8)).join(', '))
  } catch (error) {
    add('problem', 'chain', 'cannot read the chain: ' + (error.message ?? error))
  }

  // Size invariant: the vault against the unique session bytes it holds.
  try {
    const sessions = collectSessions(store).sessions
    let unique = 0
    for (const session of sessions.values()) unique += session.bytes
    const vaultBytes = dirSize(store.dir)
    const ratio = unique > 0 ? vaultBytes / unique : 1
    const limit = 1.1
    add(
      ratio <= limit ? 'ok' : 'reclaim',
      'size',
      'vault ' + human(vaultBytes) + ' for ' + human(unique) + ' of sessions (ratio ' + ratio.toFixed(3) + ', limit ' + limit + ')',
      ratio <= limit ? null : 'compact + gc, or export and re-import',
    )
  } catch (error) {
    add('problem', 'size', 'cannot measure the size: ' + (error.message ?? error))
  }

  // Leftovers in the home: nothing of this should be a full copy of the vault.
  const leftovers = []
  const incoming = incomingPath(home)
  if (fs.existsSync(incoming)) leftovers.push({ name: path.basename(incoming), bytes: dirSize(incoming), note: 'the drop box holds a vault: import or remove it' })
  for (const entry of fs.readdirSync(home, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('history-keeper.incoming.failed-')) leftovers.push({ name: entry.name, bytes: dirSize(path.join(home, entry.name)), note: 'a failed import was moved aside: review and delete' })
    if (entry.name.startsWith('history-keeper.incoming.imported-')) leftovers.push({ name: entry.name, bytes: dirSize(path.join(home, entry.name)), note: 'an old staged copy: delete' })
  }
  for (const entry of fs.readdirSync(store.dir)) {
    if (entry.startsWith('meta.json.before-upgrade-')) {
      leftovers.push({ name: 'vault/' + entry, bytes: fs.statSync(path.join(store.dir, entry)).size, note: 'a pre-upgrade meta backup: delete after a few days' })
    }
  }
  if (fs.existsSync(path.join(home, 'pending'))) {
    leftovers.push({ name: 'pending', bytes: dirSize(path.join(home, 'pending')), note: 'locally packed tarballs: delete after installing' })
  }
  if (leftovers.length === 0) add('ok', 'leftovers', 'nothing lying around in ' + home)
  // Anything the operator should remove is a reclaim, whatever its size.
  for (const item of leftovers) add('reclaim', 'leftover', item.name + '  ' + human(item.bytes) + ' — ' + item.note)

  // Undo window
  const journal = readJournal(home)
  if (journal) {
    const status = undoStatus(home, options.now)
    add(status.canUndo ? 'info' : 'ok', 'journal', status.canUndo ? 'the last import can be undone until ' + journal.expiresAt.slice(0, 10) + ' (' + journal.sessionsCreated.length + ' session file(s))' : 'the undo window is closed: ' + (status.reason ?? ''))
  }

  const totals = {
    vaultBytes: dirSize(store.dir),
    storedBytes: verified.totals.bytes,
    reclaimableBytes: (garbage?.bytes ?? 0) + leftovers.filter((item) => item.note.includes('delete')).reduce((sum, item) => sum + item.bytes, 0),
  }

  return {
    kind: 'keeper-doctor',
    version: 1,
    createdAt: options.now ?? new Date().toISOString(),
    store: { dir: store.dir, storeId: store.meta.storeId, format: store.meta.format },
    findings,
    totals,
    ok: findings.every((item) => item.level !== 'problem'),
  }
}
