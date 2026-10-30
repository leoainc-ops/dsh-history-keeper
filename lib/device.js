/**
 * Device identity.
 *
 * A device id must NOT live inside the shared store: if both machines read the same
 * `meta.json`, they would claim the same identity and write to the same head — the original
 * C.1 defect. Each machine keeps its record in its own home, and the store only holds one
 * head file per device, under `devices/<deviceId>.json`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { newId, toIso } from './util.js'

export const DEVICE_FILE = 'history-keeper-device.json'

/**
 * Where this machine keeps its identity. Deliberately outside the store: it is local state,
 * never something that travels with the vault.
 * @param {{configDir?: string}} [options]
 * @returns {string}
 */
export function deviceFile(options = {}) {
  return path.join(options.configDir ?? path.join(os.homedir(), '.dsh'), DEVICE_FILE)
}

/**
 * Read or create this machine's device record.
 * @param {{configDir?: string, deviceName?: string, deviceId?: string}} [options]
 * @returns {{deviceId: string, deviceName: string, createdAt: string, file: string}}
 */
export function resolveDevice(options = {}) {
  const file = deviceFile(options)
  const name = options.deviceName ?? os.hostname()

  if (options.deviceId) {
    return { deviceId: options.deviceId, deviceName: name, createdAt: toIso(), file }
  }

  try {
    const record = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof record.deviceId === 'string' && /^[0-9a-f]{32}$/.test(record.deviceId)) {
      return {
        deviceId: record.deviceId,
        deviceName: record.deviceName ?? name,
        createdAt: record.createdAt ?? toIso(),
        file,
      }
    }
  } catch {
    /* first run, or a damaged record: create a fresh one below */
  }

  const created = { deviceId: newId(), deviceName: name, createdAt: toIso() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(created, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
  return { ...created, file }
}
