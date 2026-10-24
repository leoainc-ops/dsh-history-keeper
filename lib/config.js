import { randomBytes } from 'node:crypto'
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
  // Coalescing: how long a session's new bytes wait before they are published, so a burst of
  // flushes does not produce one manifest per turn. 0 disables the wait.
  snapshotMinIntervalMs: 30_000,
  // Secret gate: quarantine a session instead of publishing bytes that look like a credential.
  secretScan: true,
  secretScanAllow: [],
  secretScanEntropy: false,
  // Attachments: capture the blobs a published session references, never the whole directory.
  captureAttachments: true,
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
    store: input.store ? path.resolve(String(input.store)) : path.join(os.homedir(), '.dsh', 'history-keeper'),
    sessionsRoot,
    passphraseEnv: input.passphraseEnv ? String(input.passphraseEnv) : DEFAULTS.passphraseEnv,
    passphraseFile: input.passphraseFile ? path.resolve(String(input.passphraseFile)) : null,
    // Key file that `/keeper init` fills when the operator has not chosen a passphrase.
    keyFile: input.keyFile ? path.resolve(String(input.keyFile)) : path.join(os.homedir(), '.dsh', 'history-keeper.key'),
    deviceName: input.deviceName ? String(input.deviceName) : os.hostname(),
    autoSnapshotOnFlush: input.autoSnapshotOnFlush === undefined ? DEFAULTS.autoSnapshotOnFlush : Boolean(input.autoSnapshotOnFlush),
    debounceMs: Number.isFinite(Number(input.debounceMs)) ? Math.max(0, Number(input.debounceMs)) : DEFAULTS.debounceMs,
    maxChunkBytes: Number.isFinite(Number(input.maxChunkBytes)) ? Math.max(1, Number(input.maxChunkBytes)) : DEFAULTS.maxChunkBytes,
    snapshotMinIntervalMs: Number.isFinite(Number(input.snapshotMinIntervalMs))
      ? Math.max(0, Number(input.snapshotMinIntervalMs))
      : DEFAULTS.snapshotMinIntervalMs,
    secretScan: input.secretScan === undefined ? DEFAULTS.secretScan : Boolean(input.secretScan),
    secretScanAllow: Array.isArray(input.secretScanAllow) ? input.secretScanAllow.map(String) : [],
    secretScanEntropy: input.secretScanEntropy === undefined ? DEFAULTS.secretScanEntropy : Boolean(input.secretScanEntropy),
    captureAttachments: input.captureAttachments === undefined ? DEFAULTS.captureAttachments : Boolean(input.captureAttachments),
    // DSH keeps blobs next to the session store, under the same home.
    attachmentsRoot: input.attachmentsRoot
      ? path.resolve(String(input.attachmentsRoot))
      : path.join(path.dirname(sessionsRoot), 'attachments'),
  }

  if (!config.store) problems.push('config.store could not be resolved')
  return { config, problems }
}

/**
 * Read a passphrase from a single-line file.
 * @param {string} file
 * @returns {{passphrase: string|null, reason: string|null, length: number}}
 */
export function readPassphraseFile(file) {
  try {
    const text = fs
      .readFileSync(file, 'utf8')
      .replace(/^\uFEFF/u, '')
      .split(/\r?\n/u)[0]
      .trim()
    if (text.length >= 8) return { passphrase: text, reason: null, length: text.length }
    return { passphrase: null, reason: 'the passphrase file is shorter than 8 characters', length: text.length }
  } catch (error) {
    return { passphrase: null, reason: 'cannot read the passphrase file: ' + error.message, length: 0 }
  }
}

/**
 * Generate a passphrase and write it to a single-line key file.
 * @param {string} file
 * @returns {{passphrase: string, file: string, length: number}}
 */
export function generatePassphraseFile(file) {
  // 24 random bytes → 32 base32url characters: comfortably beyond any brute force and
  // still something a person can paste into a password manager.
  const passphrase = randomBytes(24).toString('base64url')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, passphrase + '\n', { encoding: 'utf8', mode: 0o600 })
  return { passphrase, file, length: passphrase.length }
}

/**
 * Resolve the store passphrase. Never from the config file itself: a file, a generated key
 * file, or an environment variable, so a shared profile patch cannot leak it.
 *
 * Order: an explicitly configured `passphraseFile` wins, then the key file that
 * `/keeper init` generates, and only then an ambient environment variable. An inherited
 * env var is invisible from inside the host process, and letting it shadow a configured
 * file is a bug we already hit once.
 * @param {any} config
 * @returns {{passphrase: string|null, reason: string|null, source: string, length: number}}
 */
export function resolvePassphrase(config) {
  if (config.passphraseFile) {
    const file = readPassphraseFile(config.passphraseFile)
    return { ...file, source: 'file ' + config.passphraseFile }
  }

  if (config.keyFile) {
    const file = readPassphraseFile(config.keyFile)
    if (file.passphrase) return { ...file, source: 'key file ' + config.keyFile }
  }

  const fromEnv = process.env[config.passphraseEnv]
  const source = 'env ' + config.passphraseEnv
  if (fromEnv && fromEnv.length >= 8) return { passphrase: fromEnv, reason: null, source, length: fromEnv.length }
  if (fromEnv) return { passphrase: null, reason: 'the passphrase in $' + config.passphraseEnv + ' is shorter than 8 characters', source, length: fromEnv.length }

  return {
    passphrase: null,
    reason: 'no passphrase yet: run /keeper init (or export ' + config.passphraseEnv + '=<passphrase>)',
    source: 'none',
    length: 0,
  }
}
