/**
 * Bring an existing vault up to what this build knows — without touching its history.
 *
 * The format is additive, so a vault written before the handshake and before retention is still
 * readable; it simply does not *declare* those things. This module adds what is missing to
 * `meta.json` and records the upgrade in `meta.upgrades`, so the vault carries the same promises
 * as a new one:
 *
 *   writer, minReader   the version handshake (M3)
 *   retention           the space policy (M1), which the next compaction uses
 *
 * What it never does: re-seal an object, rewrite a manifest, move a head. The bytes of history are
 * untouched; only the description of the vault changes. That is why it is cheap and safe, and why
 * it does not grow the vault by a single byte of session data.
 */
import fs from 'node:fs'
import path from 'node:path'

import { checkCompatibility } from './handshake.js'
import { atomicWrite, withStoreLock } from './store.js'
import { STORE_FORMAT } from './store.js'
import { toIso } from './util.js'
import { verifyStore } from './verify.js'
import { PLUGIN_VERSION } from './version.js'

export const DEFAULT_RETENTION = { autoGc: true, compactAfterManifests: 50, keepReplacedCopies: 0 }

/**
 * What would change. Pure: no input is mutated.
 * @param {any} meta
 * @param {{version?: string, now?: string, retention?: boolean}} [options]
 */
export function planUpgrade(meta, options = {}) {
  const version = options.version ?? PLUGIN_VERSION
  const now = options.now ?? toIso()
  const withRetention = options.retention !== false
  const changes = []
  const next = { ...meta }

  const compat = checkCompatibility(meta, version)
  if (!compat.ok) {
    return { ok: false, error: compat.errors.map((item) => item.message).join('; '), changes: [], meta: next }
  }

  if (!next.writer) {
    next.writer = { plugin: version, at: now, origin: 'upgrade' }
    changes.push('writer')
  }
  if (!next.minReader) {
    next.minReader = { format: next.format ?? STORE_FORMAT, plugin: version }
    changes.push('minReader')
  }
  if (withRetention && !next.retention) {
    next.retention = { ...DEFAULT_RETENTION }
    changes.push('retention')
  }

  if (changes.length > 0) {
    const history = Array.isArray(meta.upgrades) ? meta.upgrades : []
    next.upgrades = [
      ...history,
      {
        at: now,
        by: version,
        changes,
        from: {
          writer: meta.writer?.plugin ?? null,
          minReader: meta.minReader?.plugin ?? null,
          retention: meta.retention ?? null,
        },
      },
    ]
  }

  return { ok: true, error: null, changes, meta: next, alreadyCurrent: changes.length === 0 }
}

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{version?: string, now?: string, dryRun?: boolean, retention?: boolean}} [options]
 */
export function upgradeVault(store, options = {}) {
  const now = options.now ?? toIso()
  return withStoreLock(store.dir, { timeoutMs: 30_000 }, () => {
    const metaPath = path.join(store.dir, 'meta.json')
    const fresh = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    const plan = planUpgrade(fresh, { ...options, now })
    if (!plan.ok) throw new Error(plan.error)
    if (plan.alreadyCurrent) return { kind: 'keeper-upgrade', status: 'current', changes: [], now }

    // The old description is kept: a one-file rollback, next to the vault, not inside it.
    const backup = metaPath + '.before-upgrade-' + now.replace(/[:.]/g, '-')
    if (!options.dryRun) fs.copyFileSync(metaPath, backup)
    if (options.dryRun) return { kind: 'keeper-upgrade', status: 'planned', changes: plan.changes, backup: null, now }

    atomicWrite(metaPath, Buffer.from(JSON.stringify(plan.meta, null, 2) + '\n', 'utf8'))
    store.meta = plan.meta

    const verified = verifyStore(store)
    if (!verified.ok) {
      // Put the old description back: the upgrade must never leave a vault that cannot verify.
      fs.copyFileSync(backup, metaPath)
      store.meta = fresh
      throw new Error('the vault does not verify after the upgrade; the previous meta was restored')
    }
    return {
      kind: 'keeper-upgrade',
      status: 'upgraded',
      changes: plan.changes,
      backup,
      writer: plan.meta.writer,
      minReader: plan.meta.minReader,
      retention: plan.meta.retention ?? null,
      verification: { ok: verified.ok, sessions: verified.totals.sessions, bytes: verified.totals.bytes },
      now,
    }
  })
}
