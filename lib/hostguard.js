/**
 * Host guard: a CLI write must not race the plugin for the same vault.
 *
 * With DSH open, the plugin is the writer. A CLI `snapshot`, `compact`, `gc`, `import` or
 * `restore` on the same vault competes with it; that is how a vault got a hole in the field on
 * 2026-11-02 (see docs/LESSONS.md). The lock and the compare-and-swap added in M2 make the race
 * detectable, but the honest behaviour is to refuse before starting.
 *
 * The plugin writes a small marker in the DSH home when it mounts and refreshes it on every
 * capture. The CLI reads it: if the process is alive, writes are refused with a clear message.
 * A marker from a crashed host is ignored and cleaned up, so it can never block a store forever.
 */
import fs from 'node:fs'
import path from 'node:path'

import { toIso } from './util.js'

export const HOST_FILE = 'history-keeper-host.json'

/** @param {string} home */
export function hostMarkerPath(home) {
  return path.join(home, HOST_FILE)
}

/** @param {string} home @param {Record<string, unknown>} [extra] */
export function writeHostMarker(home, extra = {}) {
  const marker = { pid: process.pid, updatedAt: toIso(), ...extra }
  fs.mkdirSync(path.dirname(hostMarkerPath(home)), { recursive: true })
  fs.writeFileSync(hostMarkerPath(home), JSON.stringify(marker, null, 2) + '\n', 'utf8')
}

/** @param {string} home */
export function clearHostMarker(home) {
  try {
    fs.rmSync(hostMarkerPath(home), { force: true })
  } catch {
    /* an unreadable marker is not worth failing a shutdown over */
  }
}

/** @param {number} pid */
function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/**
 * @param {string} home
 * @returns {{running: boolean, pid: number|null, updatedAt: string|null, marker: any|null}}
 */
export function hostStatus(home) {
  let marker
  try {
    marker = JSON.parse(fs.readFileSync(hostMarkerPath(home), 'utf8'))
  } catch {
    return { running: false, pid: null, updatedAt: null, marker: null }
  }
  const pid = Number(marker.pid)
  const running = Number.isInteger(pid) && pid > 0 && pidAlive(pid)
  return { running, pid: running ? pid : null, updatedAt: marker.updatedAt ?? null, marker }
}

/**
 * Refuse a CLI write while the host holds the vault.
 * @param {string} home
 * @param {{allow?: boolean}} [options]
 * @returns {{running: boolean, pid: number|null}}
 */
export function assertHostClosed(home, options = {}) {
  const status = hostStatus(home)
  if (status.running && options.allow !== true) {
    throw new Error(
      'DSH is open on this machine (host pid ' +
        status.pid +
        '): the plugin is the writer of this vault. Close DSH before running a write command, or use --allow-host-open only if you know the plugin is idle.',
    )
  }
  if (!status.running && status.marker) clearHostMarker(home)
  return { running: status.running, pid: status.pid }
}
