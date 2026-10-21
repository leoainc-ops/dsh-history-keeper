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
import fs from 'node:fs'

import { resolveRestorePath } from './session-log.js'
import { atomicWrite } from './store.js'
import { collectSessions } from './verify.js'

/**
 * Restore every verified session into `home`.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home: string, dryRun?: boolean, force?: boolean}} options
 */
export function restore(store, options) {
  const { home, dryRun = false, force = false } = options ?? {}
  const { sessions, problems } = collectSessions(store)

  const report = {
    home,
    dryRun,
    created: [],
    identical: [],
    setAside: [],
    refused: [],
    problems: [...problems],
  }

  for (const session of sessions.values()) {
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

  return report
}
