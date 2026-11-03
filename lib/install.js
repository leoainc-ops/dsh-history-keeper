/**
 * Install a fused (or any corrected) session log into the DSH home, and publish it as the new
 * lineage of that session.
 *
 * Two separate operations, because they fail differently:
 *  - `installLog` writes `<home>/sessions/.../session.v<N>.jsonl.zstd`, keeping the file it replaces
 *    as `.superseded-<ts>`. It refuses a log that this host cannot read (vocabulary preflight) and
 *    refuses to run while the log is untouched by verification.
 *  - `rebaseline` makes that log the visible lineage in the vault and moves the previous lineages
 *    (visible and archived) to the archive. Without it, `snapshot` would see the new log as
 *    divergent from the published one and refuse to publish it, leaving the work unbacked.
 */
import fs from 'node:fs'
import path from 'node:path'

import { checkSession, hostVocabulary, sessionsRootOf } from './compat.js'
import { buildChunks } from './chunk.js'
import { readOrigins } from './origins.js'
import { decodePayload } from './payload.js'
import { resolveRestorePath, readLogHeader } from './session-log.js'
import { putObject, readAllManifests, withStoreLock, writeManifest } from './store.js'
import { sha256, toIso } from './util.js'
import { collectSessions, verifyStore } from './verify.js'

/**
 * @param {{buffer: Buffer, home: string, sessionId: string, now?: string, force?: boolean}} options
 */
export function installLog(options) {
  const { buffer, home, sessionId, now = toIso(), force = false } = options
  const decoded = decodePayload(buffer)
  if (!decoded.ok) throw new Error('the log cannot be decompressed: ' + decoded.failed)

  let header
  try {
    header = readLogHeader(buffer).header
  } catch (error) {
    throw new Error('the log has no readable header: ' + error.message)
  }
  if (header.id !== sessionId) throw new Error('the log belongs to ' + header.id + ', not ' + sessionId)

  const host = hostVocabulary({ sessionsRoot: sessionsRootOf(home) })
  const compat = checkSession(buffer, host.types, { complete: host.complete })
  if (!compat.readable && !force) {
    throw new Error('this host does not know ' + compat.unknown.join(', ') + '; pass --force to install it anyway')
  }

  const target = resolveRestorePath(home, { cwd: header.cwd ?? null, sessionId }, header.version ?? 4)
  if (!force && !fs.existsSync(target)) {
    throw new Error('no session log at ' + target + ': this command replaces a log, it does not create one')
  }

  const stamp = now.replace(/[:.]/g, '-')
  const supersededPath = target + '.superseded-' + stamp
  const report = { target, superseded: null, bytes: buffer.length, sessionId, events: decoded.text.split('\n').filter(Boolean).length - 1 }

  if (fs.existsSync(target)) {
    fs.copyFileSync(target, supersededPath)
    report.superseded = supersededPath
    report.supersededBytes = fs.statSync(supersededPath).size
  }

  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temp = target + '.tmp-' + process.pid
  fs.writeFileSync(temp, buffer)
  fs.renameSync(temp, target)

  // Read it back: a file that does not parse is worse than no install at all.
  const check = decodePayload(fs.readFileSync(target))
  if (!check.ok) {
    fs.copyFileSync(supersededPath, target)
    throw new Error('the installed log does not read back; the previous log was restored')
  }
  return report
}

/**
 * Publish the local log of a session as its new visible lineage, archiving the previous ones.
 *
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home: string, sessionId: string, now?: string, device?: any}} options
 */
export function rebaseline(store, options) {
  const { home, sessionId, now = toIso(), device = null } = options
  const sessionsRoot = sessionsRootOf(home)

  return withStoreLock(store.dir, { timeoutMs: 30_000 }, () => {
    const { sessions } = collectSessions(store)
    const visible = sessions.get(sessionId)

    // The local log that will become the lineage.
    const target = visible
      ? resolveRestorePath(home, { cwd: visible.header?.cwd ?? null, sessionId }, visible.formatVersion ?? 4)
      : null
    if (!target || !fs.existsSync(target)) throw new Error('no local log for ' + sessionId + ' under ' + home)
    const buffer = fs.readFileSync(target)
    const header = readLogHeader(buffer).header
    if (header.id !== sessionId) throw new Error('the local log belongs to ' + header.id)

    const built = buildChunks(buffer, { fromByte: 0, fromFrame: 0 })
    const chunks = built.chunks.map((chunk, index) => {
      const object = putObject(store, chunk.payload)
      return {
        seq: index + 1,
        objectId: object.id,
        cipherSha256: object.cipherSha256,
        cipherBytes: object.cipherBytes,
        plainSha256: sha256(chunk.payload),
        prefixSha256: chunk.prefixSha256,
        endSha256: chunk.endSha256,
        frameFrom: chunk.frameFrom,
        frameTo: chunk.frameTo,
        byteFrom: chunk.byteFrom,
        byteTo: chunk.byteTo,
        createdAt: now,
      }
    })

    const origins = readOrigins(home)
    const origin = origins[sessionId] ?? null
    const entry = {
      formatVersion: visible?.formatVersion ?? header.version ?? 4,
      header: { ...header },
      chunks,
      ...(origin ? { origin } : {}),
    }

    // Everything this session used to be becomes archive: nothing is dropped. The descriptors are
    // taken verbatim from the chain, so the old object ids stay reachable.
    const chain = readAllManifests(store, { fresh: true })
    let rawVisible = null
    const rawArchived = []
    for (const doc of chain) {
      if (doc.sessions?.[sessionId]) rawVisible = doc.sessions[sessionId]
      for (const [key, entry] of Object.entries(doc.archived ?? {})) {
        if ((entry.sessionId ?? key) === sessionId) rawArchived.push({ key, entry })
      }
    }
    const oldSeqs = []
    for (const entry of [rawVisible, ...rawArchived.map((item) => item.entry)]) {
      if (!entry) continue
      for (const chunk of entry.chunks ?? []) oldSeqs.push(chunk.seq)
    }
    // The published lineage must not be longer than the new one: a rebaseline replaces a lineage,
    // it never shortens history. Chunk counts differ (deltas vs one pass), so compare bytes.
    const oldBytes = [visible?.bytes ?? 0, ...rawArchived.map((item) => (item.entry.chunks ?? []).reduce((max, chunk) => Math.max(max, chunk.byteTo ?? 0), 0))].reduce((max, value) => Math.max(max, value), 0)
    if (buffer.length < oldBytes) {
      throw new Error(
        'the new log has ' + buffer.length + ' bytes but the published lineage has ' + oldBytes + '; refusing to shorten it',
      )
    }

    const archivedPayload = {}
    if (rawVisible) {
      archivedPayload[sessionId + '@previous'] = {
        sessionId,
        formatVersion: rawVisible.formatVersion,
        header: rawVisible.header,
        chunks: rawVisible.chunks,
        ...(rawVisible.origin ? { origin: rawVisible.origin } : {}),
      }
    }
    for (const item of rawArchived) {
      archivedPayload[item.key] = {
        sessionId,
        formatVersion: item.entry.formatVersion,
        header: item.entry.header,
        chunks: item.entry.chunks,
        ...(item.entry.origin ? { origin: item.entry.origin } : {}),
      }
    }

    const { ref } = writeManifest(store, {
      deviceId: device?.deviceId ?? store.meta.deviceId,
      device,
      sessions: { [sessionId]: entry },
      reset: { [sessionId]: true },
      ...(Object.keys(archivedPayload).length > 0 ? { archived: archivedPayload } : {}),
      createdAt: now,
    })

    const verified = verifyStore(store)
    return {
      sessionId,
      target,
      chunks: chunks.length,
      bytes: buffer.length,
      manifest: ref.id,
      archived: Object.keys(archivedPayload).length,
      verified: { ok: verified.ok, sessions: verified.totals.sessions, archived: verified.totals.archived, problems: verified.problems.map((problem) => problem.code) },
    }
  })
}

