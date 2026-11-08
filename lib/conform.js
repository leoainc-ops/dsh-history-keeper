/**
 * Conformance for any vault, not just the reference one.
 *
 * `keeper conform` answers one question: does this vault satisfy the contract that `store/1`
 * promises, right now, on this machine? It runs the checks the conformance suite runs — open,
 * verify, restore byte for byte, refuse a wrong passphrase — and adds the two the handshake
 * introduced: a vault that asks for a newer format must be refused with a code, and the reader
 * must be able to state what it implements.
 *
 * It never writes to the vault: restore happens in a temporary home that is removed afterwards.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { checkCompatibility } from './handshake.js'
import { restore } from './restore.js'
import { openStore, STORE_FORMAT } from './store.js'
import { sha256 } from './util.js'
import { collectSessions, verifyStore } from './verify.js'
import { PLUGIN_VERSION } from './version.js'

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{passphrase: string, now?: string}} options
 */
export function conformVault(store, options = {}) {
  const checks = []
  const warnings = []
  const add = (name, ok, detail = '') => {
    checks.push({ name, ok, detail })
    return ok
  }

  const compat = checkCompatibility(store.meta, PLUGIN_VERSION)
  add('declares a format this build speaks', compat.errors.every((item) => item.code !== 'BAD_FORMAT'), String(store.meta.format))
  add('this reader can open the vault', compat.ok, compat.errors.map((item) => item.code).join(', '))
  add('refuses a vault that asks for a newer format', asksForNewer(store.meta), 'no FORMAT_TOO_NEW')

  if (!store.meta.writer || !store.meta.minReader) {
    warnings.push('the vault predates the handshake; run keeper upgrade to let it describe itself')
  }

  const verified = verifyStore(store)
  add('verify is ok', verified.ok, verified.problems.map((problem) => problem.code).join(', '))

  const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-conform-')), 'home')
  try {
    fs.mkdirSync(home, { recursive: true })
    const restored = restore(store, { home })
    add('restores every session', restored.created.length === verified.totals.sessions, restored.created.length + ' of ' + verified.totals.sessions)

    const { sessions } = collectSessions(store)
    let exact = 0
    const wrong = []
    for (const session of sessions.values()) {
      const created = restored.created.find((item) => item.sessionId === session.sessionId)
      if (!created) continue
      let bytes = null
      try {
        bytes = fs.readFileSync(created.target)
      } catch {
        continue
      }
      if (sha256(bytes) === sha256(session.buffer)) exact += 1
      else wrong.push(session.sessionId)
    }
    add('restores byte for byte', exact === sessions.size && wrong.length === 0, wrong.join(', '))
  } finally {
    fs.rmSync(path.dirname(home), { recursive: true, force: true })
  }

  add('refuses a wrong passphrase', refusesWrongPassphrase(store.dir, options.passphrase))

  return {
    kind: 'keeper-conform',
    version: 1,
    createdAt: options.now ?? new Date().toISOString(),
    ok: checks.every((item) => item.ok),
    checks,
    warnings,
    store: { dir: store.dir, storeId: store.meta.storeId, format: store.meta.format },
    reader: { plugin: PLUGIN_VERSION, format: STORE_FORMAT },
    totals: {
      sessions: verified.totals.sessions,
      frames: verified.totals.frames,
      bytes: verified.totals.bytes,
      attachments: verified.totals.attachments,
    },
  }
}

/** Does a reader of this build reject a vault that demands a newer format, with the code? */
function asksForNewer(meta) {
  const probe = { ...meta, minReader: { format: 'dsh-history-keeper/store/9000', plugin: '99.0.0' } }
  const result = checkCompatibility(probe, PLUGIN_VERSION)
  return result.ok === false && result.errors.some((item) => item.code === 'FORMAT_TOO_NEW')
}

/** A wrong passphrase must not open the vault. */
function refusesWrongPassphrase(dir, passphrase) {
  const wrong = 'not-the-passphrase-' + 'x'.repeat(20)
  if (wrong === passphrase) return false
  try {
    openStore(dir, wrong)
    return false
  } catch {
    return true
  }
}
