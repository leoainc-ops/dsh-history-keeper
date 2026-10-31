/**
 * Origin records.
 *
 * When a session is captured here after being restored from another machine, the manifest that
 * introduces it is *this* machine's: the true origin is lost. The panel of DSH groups by
 * workspace, and a plugin cannot relabel "Ungrouped", so the least we can do is keep the answer
 * to "where did this conversation come from" — in the vault, and in a local record for sessions
 * captured before the vault learned it.
 *
 * The record lives in the DSH home, outside the store, because it describes a local import.
 */
import fs from 'node:fs'
import path from 'node:path'

import { toIso } from './util.js'

export const ORIGINS_FILE = 'history-keeper-origins.json'

/** @param {string} home @returns {string} */
export function originsFile(home) {
  return path.join(home, ORIGINS_FILE)
}

/**
 * @param {string} home
 * @returns {Record<string, {deviceId: string, deviceName?: string, storeId?: string, importedAt?: string}>}
 */
export function readOrigins(home) {
  try {
    const parsed = JSON.parse(fs.readFileSync(originsFile(home), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Record the origin of sessions that were just copied into this home.
 * @param {string} home
 * @param {string[]} sessionIds
 * @param {{deviceId: string, deviceName?: string, storeId?: string}} origin
 * @returns {number} how many records were written
 */
export function recordOrigins(home, sessionIds, origin) {
  if (sessionIds.length === 0) return 0
  const current = readOrigins(home)
  const at = toIso()
  for (const sessionId of sessionIds) {
    if (current[sessionId]) continue
    current[sessionId] = {
      deviceId: origin.deviceId,
      deviceName: origin.deviceName ?? null,
      storeId: origin.storeId ?? null,
      importedAt: at,
    }
  }
  fs.mkdirSync(path.dirname(originsFile(home)), { recursive: true })
  fs.writeFileSync(originsFile(home), JSON.stringify(current, null, 2) + '\n', 'utf8')
  return sessionIds.length
}
