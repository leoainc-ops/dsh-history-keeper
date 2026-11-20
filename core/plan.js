/**
 * The plan: what an apply *would* do, without doing it.
 *
 * This is the piece that turns "a vault and a home" into a list of decisions the user (or the
 * agent) can read before anything is written. It classifies every session against the destination,
 * translates the working directory when the operator says so, and reports what it cannot place.
 *
 * The plan is deliberately host-free: the caller injects how to read a session (`reader`) and what
 * the host can group (`translate`), so `core` never imports the host layer.
 *
 * @module core/plan
 */
import fs from 'node:fs'
import path from 'node:path'

import { resolveRestorePath } from './session-log.js'
import { collectSessions } from './verify.js'

/** Actions a session can get in a plan. */
export const ACTIONS = ['nueva', 'identica', 'divergente', 'ilegible', 'sin-destino']

/**
 * Build the plan for a vault against a DSH home.
 *
 * @param {{store: {dir: string, meta: any, key: Buffer}, home: string,
 *          mode?: 'archivo'|'uso', translate?: Record<string, string>,
 *          reader?: (session: any) => {readable: boolean, unknown?: string[]},
 *          attachments?: Array<{hash: string, bytes: number}>}} options
 * @returns {{mode: string, store: string, home: string, sessions: Array<any>,
 *            attachments: Array<any>, warnings: Array<any>, blocks: Array<any>,
 *            totals: Record<string, number>}}
 */
export function buildPlan(options) {
  const { store, home, mode = 'archivo', translate = {}, reader = null, attachments = [] } = options ?? {}
  const { sessions, archived, problems, chain } = collectSessions(store)

  const plan = {
    mode,
    store: store.dir,
    home,
    sessions: [],
    attachments: [],
    warnings: [],
    blocks: [],
    totals: { sessions: 0, nueva: 0, identica: 0, divergente: 0, ilegible: 0, sinDestino: 0, bytesToWrite: 0, archived: (archived ?? new Map()).size },
  }

  for (const problem of problems) plan.blocks.push({ code: problem.code, message: problem.message })

  for (const session of sessions.values()) {
    const sessionId = session.sessionId
    const originalCwd = session.header?.cwd ?? null
    const translated = originalCwd !== null && Object.prototype.hasOwnProperty.call(translate, originalCwd)
    const targetCwd = translated ? translate[originalCwd] : originalCwd
    const version = session.formatVersion ?? 4

    // `uso` is native publication: without a working directory the host cannot attach the session
    // to a workspace, and a translated one has to exist on this machine or `create` would fail.
    if (mode === 'uso' && (!targetCwd || !fs.existsSync(targetCwd))) {
      plan.sessions.push({
        sessionId,
        action: 'sin-destino',
        bytes: session.buffer.length,
        frames: session.frames,
        cwd: targetCwd,
        originalCwd,
        translated,
        reason: targetCwd ? 'the working directory does not exist on this host' : 'the session declares no cwd to attach to',
      })
      plan.totals.sinDestino += 1
      continue
    }

    const targetPath = targetCwd === null
      ? resolveRestorePath(home, { cwd: null, sessionId }, version)
      : resolveRestorePath(home, { cwd: targetCwd, sessionId }, version)

    if (reader) {
      const verdict = reader(session)
      if (verdict && verdict.readable === false) {
        plan.sessions.push({
          sessionId,
          action: 'ilegible',
          bytes: session.buffer.length,
          frames: session.frames,
          cwd: targetCwd,
          originalCwd,
          translated,
          targetPath,
          unknown: verdict.unknown ?? [],
        })
        plan.totals.ilegible += 1
        if (verdict.unknown && verdict.unknown.length > 0) {
          plan.warnings.push({ sessionId, code: 'UNKNOWN_EVENTS', unknown: verdict.unknown })
        }
        continue
      }
    }

    let action = 'nueva'
    let existing = null
    try {
      existing = fs.readFileSync(targetPath)
    } catch (error) {
      if (error.code !== 'ENOENT') plan.blocks.push({ sessionId, code: 'READ_TARGET_FAILED', message: error.message })
    }
    if (existing !== null) action = existing.equals(session.buffer) ? 'identica' : 'divergente'

    plan.sessions.push({
      sessionId,
      action,
      bytes: session.buffer.length,
      frames: session.frames,
      cwd: targetCwd,
      originalCwd,
      translated,
      targetPath,
    })
    plan.totals[action] += 1
    if (action === 'nueva') plan.totals.bytesToWrite += session.buffer.length
  }
  plan.totals.sessions = plan.sessions.length

  for (const attachment of attachments) {
    const target = attachmentTarget(home, attachment.hash)
    const present = fs.existsSync(target)
    plan.attachments.push({ hash: attachment.hash, bytes: attachment.bytes, action: present ? 'presente' : 'crear' })
  }

  if (plan.totals.divergente > 0) {
    plan.warnings.push({ code: 'DIVERGENT', sessions: plan.sessions.filter((s) => s.action === 'divergente').map((s) => s.sessionId) })
  }
  return plan
}

/** Where a blob lives in the host's attachment store. */
export function attachmentTarget(home, hash) {
  return path.join(home, 'attachments', 'v1', 'objects', hash.slice(0, 2), hash)
}
