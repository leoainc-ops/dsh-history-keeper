/**
 * Restore: rebuild a DSH home from the store.
 *
 * Rules that must never be relaxed:
 *  - only what verification approved is written (collectSessions is the single path);
 *  - nothing existing is overwritten: an identical log is skipped, a different one is
 *    refused, and with --force the incoming copy is written aside, never on top;
 *  - the target layout is the host's own, so restored sessions appear in DSH as if
 *    they had always lived there.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { resolveAttachment, writeAttachment } from './attachments.js'
import { resolveRestorePath } from './session-log.js'
import { publishedAttachments } from './snapshot.js'
import { checkSession, hostVocabulary, sessionsRootOf } from './compat.js'
import { recordOrigins } from './origins.js'
import { atomicWrite, getObject } from './store.js'
import { collectSessions } from './verify.js'

/**
 * Restore every verified session into `home`.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home: string, dryRun?: boolean, force?: boolean, preflight?: boolean}} options
 */
export function restore(store, options) {
  const { home, dryRun = false, force = false, preflight = true } = options ?? {}
  const { sessions, archived, problems, chain } = collectSessions(store)
  // A session written by a newer harness cannot be read by this one: ask before writing.
  const host = preflight ? hostVocabulary({ sessionsRoot: sessionsRootOf(home) }) : { types: new Set(), complete: true }

  const report = {
    home,
    dryRun,
    created: [],
    identical: [],
    setAside: [],
    refused: [],
    incompatible: [],
    advisory: [],
    // Archived continuations are never restored; they are reported so the user knows they exist.
    archived: (archived ?? new Map()).size,
    attachments: [],
    problems: [...problems],
  }

  for (const session of sessions.values()) {
    if (preflight && !force) {
      const compat = checkSession(session.buffer, host.types, { complete: host.complete })
      if (!compat.readable) {
        report.incompatible.push({ sessionId: session.sessionId, unknownEvents: compat.unknown })
        continue
      }
      if (compat.unknown.length > 0) {
        // The vocabulary sample was cut short, so the difference is a warning, not a verdict.
        report.advisory.push({ sessionId: session.sessionId, unknownEvents: compat.unknown })
      }
    }

    const version = session.formatVersion ?? 4
    const target = resolveRestorePath(
      home,
      { cwd: session.header?.cwd ?? null, sessionId: session.sessionId },
      version,
    )

    let existing = null
    try {
      existing = fs.readFileSync(target)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        report.problems.push({ sessionId: session.sessionId, code: 'READ_TARGET_FAILED', message: error.message })
        continue
      }
    }

    if (existing !== null) {
      if (existing.equals(session.buffer)) {
        report.identical.push({ sessionId: session.sessionId, target })
        continue
      }
      if (!force) {
        report.refused.push({
          sessionId: session.sessionId,
          target,
          message: 'a different log already exists at the target; nothing was written',
        })
        continue
      }
      const aside = target + '.incoming-' + Date.now()
      if (!dryRun) atomicWrite(aside, session.buffer)
      report.setAside.push({ sessionId: session.sessionId, target: aside, message: 'existing log preserved; incoming copy written alongside' })
      continue
    }

    if (!dryRun) atomicWrite(target, session.buffer)
    report.created.push({ sessionId: session.sessionId, target, bytes: session.buffer.length })
  }

  // Attachments last: a session log restored next to a missing blob is still a usable
  // conversation, but the blob is what makes it complete.
  const root = path.join(home, 'attachments')
  for (const [hash, entry] of publishedAttachments(chain ?? [])) {
    let bytes
    try {
      bytes = getObject(store, entry.objectId, entry.cipherSha256)
    } catch (error) {
      report.problems.push({ hash, code: error.code ?? 'ATTACHMENT_OBJECT_FAILED', message: error.message })
      continue
    }
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (digest !== hash) {
      report.problems.push({ hash, code: 'ATTACHMENT_MISMATCH', message: 'blob content hashes to ' + digest })
      continue
    }
    if (dryRun) {
      const exists = resolveAttachment(root, hash) !== null
      report.attachments.push({ hash, bytes: bytes.length, action: exists ? 'present' : 'created' })
      continue
    }
    const written = writeAttachment(root, hash, bytes)
    report.attachments.push({ hash, bytes: bytes.length, action: written.action })
    if (written.action === 'conflict') {
      report.problems.push({
        hash,
        code: 'ATTACHMENT_CONFLICT',
        message: 'a different file already exists at ' + written.path + '; it was not overwritten',
      })
    }
  }

  if (!dryRun && report.created.length > 0) {
    // This machine publishes the session from now on, but it did not write it: keep the origin.
    recordOrigins(home, report.created.map((item) => item.sessionId), {
      deviceId: store.meta.deviceId,
      deviceName: store.meta.deviceName,
      storeId: store.meta.storeId,
    })
  }

  return report
}
