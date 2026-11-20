/**
 * Path translation: where a session's working directory becomes on this machine.
 *
 * A conversation carries the absolute `cwd` of the machine that produced it. Mounting it elsewhere
 * is not a rename: the destination path is a decision, and the decision has to be recorded, because
 * the original is what makes the conversation reproducible.
 *
 * The map lives next to the host home, so it can be read by the CLI, the plugin and a person.
 *
 * @module core/translations
 */
import fs from 'node:fs'
import path from 'node:path'

export const TRANSLATIONS_FILE = 'history-keeper-translations.json'

/** Where the map lives for a given DSH home. */
export function translationsFile(home) {
  return path.join(home, TRANSLATIONS_FILE)
}

/** An empty, valid map. */
export function emptyTranslations() {
  return { format: 'dsh-history-keeper/translations/1', entries: [] }
}

/** Read the map; a missing file is an empty map, a damaged one is refused. */
export function loadTranslations(home) {
  const file = translationsFile(home)
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return emptyTranslations()
    throw error
  }
  const parsed = JSON.parse(raw)
  if (parsed?.format !== 'dsh-history-keeper/translations/1' || !Array.isArray(parsed.entries)) {
    throw new Error('invalid translations file: ' + file)
  }
  return parsed
}

/** Write the map atomically (tmp + rename). */
export function saveTranslations(home, state) {
  const file = translationsFile(home)
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
  return file
}

/**
 * Add one mapping. The same pair twice is a no-op; the same origin mapped to a different
 * destination is refused, because silently changing it would move sessions between projects.
 * @param {{format: string, entries: Array<{from: string, to: string, createdAt: string}>}} state
 * @param {string} from
 * @param {string} to
 * @param {{now?: string}} [options]
 */
export function addTranslation(state, from, to, options = {}) {
  if (typeof from !== 'string' || from.length === 0) throw new Error('a translation needs an origin path')
  if (typeof to !== 'string' || to.length === 0) throw new Error('a translation needs a destination path')
  const existing = state.entries.find((entry) => samePath(entry.from, from))
  if (existing) {
    if (!samePath(existing.to, to)) {
      throw new Error('the origin ' + from + ' is already translated to ' + existing.to + '; refusing to change it')
    }
    return { added: false, entry: existing }
  }
  const entry = { from, to, createdAt: options.now ?? new Date().toISOString() }
  state.entries.push(entry)
  return { added: true, entry }
}

/** The map in the shape `buildPlan` expects. */
export function translateMap(state) {
  const map = {}
  for (const entry of state.entries) map[entry.from] = entry.to
  return map
}

/**
 * Resolve one working directory against the map.
 * @returns {{cwd: string, originalCwd: string|null, translated: boolean}}
 */
export function resolveCwd(cwd, state) {
  if (cwd === null || cwd === undefined) return { cwd: null, originalCwd: null, translated: false }
  const entry = state.entries.find((item) => samePath(item.from, cwd))
  if (!entry) return { cwd, originalCwd: cwd, translated: false }
  return { cwd: entry.to, originalCwd: cwd, translated: true }
}

/** Paths compare case-insensitively on Windows, which is where they are going to be used. */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  if (process.platform !== 'win32') return left === right
  return left.toLowerCase() === right.toLowerCase()
}
