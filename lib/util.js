import { createHash, randomBytes } from 'node:crypto'

/** @param {Buffer|string} data @returns {string} lowercase hex sha256 */
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** @returns {string} a random, opaque 128-bit identifier (hex) */
export function newId() {
  return randomBytes(16).toString('hex')
}

/** @param {Date} [date] @returns {string} ISO-8601 timestamp */
export function toIso(date = new Date()) {
  return date.toISOString()
}

/** @param {number} bytes @returns {string} human-readable size */
export function humanBytes(bytes) {
  if (bytes < 1024) return bytes + ' B'
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return value.toFixed(1) + ' ' + units[unit]
}
