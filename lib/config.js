/**
 * Configuration for the host plugin.
 *
 * Validated by hand on purpose: the plugin must mount even when it is misconfigured, and
 * report the problem when a command runs. Throwing during `apply` is the failure mode that
 * makes a plugin silently disappear from the profile, which is exactly what we refuse to do.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_MAX_CHUNK_BYTES } from './chunk.js'

export const DEFAULTS = Object.freeze({
  sessionsRoot: null,
  passphraseEnv: 'KEEPER_PASSPHRASE',
  passphraseFile: null,
  autoSnapshotOnFlush: true,
  debounceMs: 2000,
  maxChunkBytes: DEFAULT_MAX_CHUNK_BYTES,
})

/**
 * @param {any} raw row config from cordis
 * @returns {{config: any, problems: string[]}}
 */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const problems = []

  const sessionsRoot = input.sessionsRoot
    ? path.resolve(String(input.sessionsRoot))
    : path.join(os.homedir(), '.dsh', 'sessions')

  const config = {
    store: input.store ? path.resolve(String(input.store)) : null,
    sessionsRoot,
    passphraseEnv: input.passphraseEnv ? String(input.passphraseEnv) : DEFAULTS.passphraseEnv,
    passphraseFile: input.passphraseFile ? path.resolve(String(input.passphraseFile)) : null,
    autoSnapshotOnFlush: input.autoSnapshotOnFlush === undefined ? DEFAULTS.autoSnapshotOnFlush : Boolean(input.autoSnapshotOnFlush),
    debounceMs: Number.isFinite(Number(input.debounceMs)) ? Math.max(0, Number(input.debounceMs)) : DEFAULTS.debounceMs,
    maxChunkBytes: Number.isFinite(Number(input.maxChunkBytes)) ? Math.max(1, Number(input.maxChunkBytes)) : DEFAULTS.maxChunkBytes,
  }

  if (!config.store) problems.push('config.store is required: point it at a keeper store directory')
  return { config, problems }
}

/**
 * Resolve the store passphrase. Never from the config file itself: an env var or a file
 * the operator controls, so a shared profile patch cannot leak it.
 * @param {any} config
 * @returns {{passphrase: string|null, reason: string|null}}
 */
export function resolvePassphrase(config) {
  const fromEnv = process.env[config.passphraseEnv]
  if (fromEnv && fromEnv.length >= 8) return { passphrase: fromEnv, reason: null }
  if (fromEnv) return { passphrase: null, reason: 'the passphrase in $' + config.passphraseEnv + ' is shorter than 8 characters' }

  if (config.passphraseFile) {
    try {
      const text = fs.readFileSync(config.passphraseFile, 'utf8').split(/\r?\n/)[0].trim()
      if (text.length >= 8) return { passphrase: text, reason: null }
      return { passphrase: null, reason: 'the passphrase file is shorter than 8 characters' }
    } catch (error) {
      return { passphrase: null, reason: 'cannot read the passphrase file: ' + error.message }
    }
  }

  return {
    passphrase: null,
    reason: 'no passphrase: export ' + config.passphraseEnv + '=<passphrase> (or set config.passphraseFile)',
  }
}
