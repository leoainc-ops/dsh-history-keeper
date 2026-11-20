/**
 * Mount: the plan, applied.
 *
 * Two ways to deliver the same conversation, chosen from what the host offers:
 *   - `archivo`: write the log byte for byte, exactly as the vault keeps it.
 *   - `uso`:    ask the host to create the session with the original id and the translated cwd, and
 *               attach it to its workspace.
 *
 * The function is the only place that applies a plan, and it is idempotent by construction: the plan
 * already classified what exists, and the native path reports `exists` instead of duplicating.
 *
 * @module lib/mount
 */
import fs from 'node:fs'
import path from 'node:path'

import { buildPlan } from '../core/plan.js'
import { atomicWrite } from '../core/store.js'
import { translateMap } from '../core/translations.js'
import { collectSessions } from '../core/verify.js'
import { publishNative } from '../host/publish-native.js'
import { attachToWorkspace } from '../host/workspaces.js'

/**
 * Apply a plan to a home.
 *
 * @param {{store: any, home: string, mode?: 'archivo'|'uso', translations?: any,
 *          persistence?: any, workspaceRegistry?: any, readEvents?: Function, reader?: Function,
 *          dryRun?: boolean, force?: boolean, only?: string[]}} options
 * @returns {Promise<{mode: string, home: string, dryRun: boolean, plan: any,
 *          created: any[], published: any[], attached: any[], identical: string[],
 *          refused: string[], skipped: any[], failed: any[]}>}
 */
export async function mountSessions(options) {
  const {
    store,
    home,
    mode = 'archivo',
    translations = null,
    persistence = null,
    workspaceRegistry = null,
    readEvents = null,
    reader = null,
    dryRun = false,
    force = false,
    only = null,
  } = options ?? {}

  const plan = buildPlan({ store, home, mode, translate: translations ? translateMap(translations) : {}, reader })
  const report = {
    mode,
    home,
    dryRun,
    plan,
    created: [],
    published: [],
    attached: [],
    identical: [],
    refused: [],
    skipped: [],
    failed: [],
  }
  if (dryRun) return report

  const { sessions } = collectSessions(store)
  for (const entry of plan.sessions) {
    if (Array.isArray(only) && !only.includes(entry.sessionId)) continue
    if (entry.action === 'identica') {
      report.identical.push(entry.sessionId)
      continue
    }
    if (entry.action === 'ilegible' || entry.action === 'sin-destino') {
      report.skipped.push({ sessionId: entry.sessionId, why: entry.action, reason: entry.reason })
      continue
    }
    if (entry.action === 'divergente' && !force && mode === 'archivo') {
      report.refused.push(entry.sessionId)
      continue
    }

    const session = sessions.get(entry.sessionId) ?? [...sessions.values()].find((item) => item.sessionId === entry.sessionId)
    if (!session) {
      report.failed.push({ sessionId: entry.sessionId, code: 'MISSING_SESSION' })
      continue
    }

    if (mode === 'uso') {
      const published = await publishNative({ session, persistence, cwd: entry.cwd, readEvents })
      if (published.status === 'failed') {
        report.failed.push({ sessionId: entry.sessionId, code: published.code, message: published.message })
        continue
      }
      if (published.status === 'created') {
        report.published.push({ sessionId: entry.sessionId, events: published.events, seal: published.seal, sealMatched: published.sealMatched })
      } else {
        report.identical.push(entry.sessionId)
      }
      const attached = await attachToWorkspace({ workspaceRegistry, sessionId: entry.sessionId, cwd: entry.cwd })
      if (attached.status === 'failed') report.failed.push({ sessionId: entry.sessionId, code: attached.code, message: attached.message })
      else report.attached.push({ sessionId: entry.sessionId, status: attached.status, workspaceId: attached.workspaceId })
      continue
    }

    // archivo: nothing existing is overwritten; a divergent copy is written aside with --force.
    if (entry.action === 'divergente' && force) {
      const aside = entry.targetPath + '.incoming-' + Date.now()
      fs.mkdirSync(path.dirname(aside), { recursive: true })
      atomicWrite(aside, session.buffer)
      report.created.push({ sessionId: entry.sessionId, target: aside, aside: true })
      continue
    }
    fs.mkdirSync(path.dirname(entry.targetPath), { recursive: true })
    atomicWrite(entry.targetPath, session.buffer)
    report.created.push({ sessionId: entry.sessionId, target: entry.targetPath, bytes: session.buffer.length })
  }

  return report
}
