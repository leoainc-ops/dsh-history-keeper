/**
 * Version handshake.
 *
 * The vault travels between machines that may run different versions of the plugin and different
 * versions of DSH. The format is additive, so a newer writer produces a vault an older reader can
 * usually still read — but "usually" is not a promise. The vault therefore says what it is:
 *
 *   meta.writer    { plugin, at }              who wrote it, and when the vault was created
 *   meta.minReader { format, plugin }          the oldest reader that can open it
 *
 * On open, a reader compares its own version with those fields:
 *  - a format it does not know is an error (the store layer already refuses with BAD_FORMAT);
 *  - a `minReader.format` newer than the one this build speaks is an error (FORMAT_TOO_NEW);
 *  - a `minReader.plugin` newer than this build is a warning: the vault is readable, but a newer
 *    plugin may have written fields this one will ignore.
 *
 * Nothing here rewrites a vault: the check is read-only and its result is a message.
 */
import { STORE_FORMAT } from './store.js'
import { toIso } from './util.js'

/** Format identity as a number: 'store/2' → 2. Unknown shapes are compared as 0. */
export function formatVersionOf(format) {
  const match = typeof format === 'string' ? /^dsh-history-keeper\/store\/(\d+)$/.exec(format) : null
  return match ? Number(match[1]) : 0
}

/** Parse `<major>.<minor>.<patch>[-rc.<n>]`; returns null when it is not a version. */
export function parseVersion(value) {
  if (typeof value !== 'string') return null
  // Pre-releases matter: 2.0 will ship as alpha/beta/rc before it is a release, and a parser that
  // only knows "-rc.N" silently turns every other pre-release into "cannot compare" (0), which is
  // how a downlevel export stops being refused.
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/i.exec(value.trim())
  if (!match) return null
  const stage = match[4] ? match[4].toLowerCase() : null
  const parsed = {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rc: stage === null ? Number.POSITIVE_INFINITY : Number(match[5]),
  }
  if (stage !== null && stage !== 'rc') parsed.stage = stage
  return parsed
}

/** Negative when a < b, zero when equal, positive when a > b. Pre-releases sort before releases. */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return 0
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key]
  }
  // alpha < beta < rc < release, and inside a stage the number decides.
  const stageRank = (version) =>
    version.stage === 'alpha' ? 0 : version.stage === 'beta' ? 1 : version.rc === Number.POSITIVE_INFINITY ? 3 : 2
  if (stageRank(left) !== stageRank(right)) return stageRank(left) - stageRank(right)
  if (left.rc !== right.rc) return left.rc - right.rc
  return 0
}

/**
 * Fields a new vault declares about itself.
 * @param {string} pluginVersion
 * @param {{format?: string}} [options]
 */
export function buildHandshake(pluginVersion, options = {}) {
  return {
    writer: { plugin: pluginVersion, at: toIso() },
    minReader: { format: options.format ?? STORE_FORMAT, plugin: pluginVersion },
  }
}

/**
 * @param {any} meta
 * @param {string} currentVersion this build's plugin version
 * @returns {{ok: boolean, errors: Array<{code: string, message: string}>, warnings: Array<{code: string, message: string}>}}
 */
export function checkCompatibility(meta, currentVersion) {
  const errors = []
  const warnings = []
  const mine = formatVersionOf(STORE_FORMAT)
  const theirs = formatVersionOf(meta?.format)
  if (theirs !== mine) {
    errors.push({
      code: 'BAD_FORMAT',
      message: 'the vault uses format ' + String(meta?.format) + '; this keeper speaks ' + STORE_FORMAT,
    })
  }

  const minReader = meta?.minReader
  if (minReader) {
    const minFormat = formatVersionOf(minReader.format)
    if (minFormat > mine) {
      errors.push({
        code: 'FORMAT_TOO_NEW',
        message:
          'the vault requires format ' +
          String(minReader.format) +
          ' or newer; this keeper speaks ' +
          STORE_FORMAT +
          ' (update the plugin on this machine)',
      })
    }
    if (minReader.plugin && compareVersions(minReader.plugin, currentVersion) > 0) {
      warnings.push({
        code: 'PLUGIN_OUTDATED',
        message:
          'the vault was written for plugin ' +
          minReader.plugin +
          ' or newer; this machine runs ' +
          currentVersion +
          '. It should still be readable, but a newer plugin may have written fields this one ignores.',
      })
    }
  }

  const writer = meta?.writer?.plugin
  if (writer && compareVersions(writer, currentVersion) > 0 && !minReader?.plugin) {
    warnings.push({
      code: 'WRITER_NEWER',
      message: 'the vault was written by plugin ' + writer + '; this machine runs ' + currentVersion,
    })
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** Human-readable lines for a status or a command result. */
export function describeCompatibility(result) {
  return [...result.errors.map((item) => 'error: ' + item.message), ...result.warnings.map((item) => 'warning: ' + item.message)]
}
