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

/**
 * Render an ISO-8601 instant for a human, in the machine's local time zone.
 * Timestamps are STORED in UTC (an instant must be unambiguous across devices in
 * different zones); they are only converted here, at the edge, for display.
 * @param {string} iso
 * @returns {string} e.g. "2026-10-22 00:54:29 (UTC-03:00)"
 */
export function formatTime(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const pad = (value) => String(value).padStart(2, '0')
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const hours = pad(Math.floor(Math.abs(offsetMinutes) / 60))
  const minutes = pad(Math.abs(offsetMinutes) % 60)
  const local = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
    ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  return local + ' (UTC' + sign + hours + ':' + minutes + ')'
}