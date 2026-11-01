/**
 * Inventory: what the vault holds, grouped by the device each session came from.
 *
 * The panel of DSH groups sessions by workspace, and a plugin cannot relabel "Ungrouped". This
 * report answers the same question the user asks before mounting a vault — *what do I have, from
 * where, and will it open here* — using the data the vault already stores: the device that
 * published each session and the vocabulary of the host that will read it.
 *
 * It is read-only: nothing is written, nothing is restored.
 */
import fs from 'node:fs'

import { checkSession, hostVocabulary, sessionsRootOf } from './compat.js'
import { readOrigins } from './origins.js'
import { findSessionLogs, readLogHeader } from './session-log.js'
import { listDeviceHeads, readAllManifests } from './store.js'
import { collectSessions } from './verify.js'

/**
 * Device that published a session first: the one whose manifest introduced its chunk 1.
 * @param {Array<any>} chain
 * @returns {Map<string, string>} sessionId → deviceId
 */
export function ownerBySession(chain) {
  const owners = new Map()
  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      if (owners.has(sessionId)) continue
      const chunks = entry.chunks ?? []
      const introduces = chunks.some((chunk) => chunk.seq === 1)
      if (introduces) owners.set(sessionId, doc.deviceId ?? 'unknown')
    }
  }
  for (const doc of chain) {
    for (const sessionId of Object.keys(doc.sessions ?? {})) {
      if (!owners.has(sessionId)) owners.set(sessionId, doc.deviceId ?? 'unknown')
    }
  }
  return owners
}

/** @param {string} sessionsRoot @returns {Map<string, {file: string, bytes: number}>} */
export function localSessionFiles(sessionsRoot) {
  const files = new Map()
  for (const log of findSessionLogs(sessionsRoot)) {
    try {
      const buffer = fs.readFileSync(log.file)
      const header = readLogHeader(buffer).header
      if (header?.id) files.set(header.id, { file: log.file, bytes: buffer.length })
    } catch {
      /* an unreadable local log is simply not part of the inventory */
    }
  }
  return files
}

function compareLocal(local, published) {
  if (local === null) return 'absent'
  if (local.equals(published)) return 'identical'
  if (local.length < published.length && published.subarray(0, local.length).equals(local)) return 'behind'
  if (local.length > published.length && local.subarray(0, published.length).equals(published)) return 'ahead'
  return 'diverged'
}

/**
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home: string, sessionsRoot?: string}} options
 * @returns {{devices: Array<{deviceId: string, deviceName: string|null, sessions: Array<any>}>, sessions: Array<any>, hostVocabulary: {types: number, scanned: number, empty: boolean}}}
 */
export function inventory(store, options) {
  const sessionsRoot = options.sessionsRoot ?? sessionsRootOf(options.home)
  const chain = readAllManifests(store, { fresh: true })
  const owners = ownerBySession(chain)
  // An entry may carry the origin recorded when it was imported or merged: prefer it.
  const declared = new Map()
  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      if (entry.origin?.deviceId && !declared.has(sessionId)) declared.set(sessionId, entry.origin)
    }
  }
  const local = localSessionFiles(sessionsRoot)
  const host = hostVocabulary({ sessionsRoot })
  const imported = readOrigins(options.home)
  const { sessions, archived } = collectSessions(store)

  const names = new Map()
  for (const head of listDeviceHeads(store.dir)) names.set(head.deviceId, head.deviceName ?? null)
  if (store.meta?.deviceId && !names.has(store.meta.deviceId)) names.set(store.meta.deviceId, store.meta.deviceName ?? null)

  const rows = []
  for (const session of sessions.values()) {
    const ownerId = declared.get(session.sessionId)?.deviceId ?? owners.get(session.sessionId) ?? 'unknown'
    const localFile = local.get(session.sessionId)
    const localBytes = localFile ? fs.readFileSync(localFile.file) : null
    const compat = checkSession(session.buffer, host.types, { complete: host.complete })
    const record = imported[session.sessionId]
    rows.push({
      sessionId: session.sessionId,
      bytes: session.bytes,
      frames: session.frames,
      cwd: session.header?.cwd ?? null,
      owner: record
        ? { deviceId: record.deviceId, deviceName: record.deviceName ?? names.get(record.deviceId) ?? null, imported: true }
        : {
            deviceId: ownerId,
            deviceName: declared.get(session.sessionId)?.deviceName ?? names.get(ownerId) ?? null,
            imported: Boolean(declared.get(session.sessionId)),
          },
      local: compareLocal(localBytes, session.buffer),
      readable: compat.readable,
      advisory: compat.advisory,
      unknownEvents: compat.unknown,
    })
  }

  rows.sort((a, b) => {
    const owner = String(a.owner.deviceName ?? a.owner.deviceId).localeCompare(String(b.owner.deviceName ?? b.owner.deviceId))
    if (owner !== 0) return owner
    return String(a.cwd ?? '').localeCompare(String(b.cwd ?? '')) || a.sessionId.localeCompare(b.sessionId)
  })

  const byDevice = new Map()
  for (const row of rows) {
    const key = row.owner.deviceId
    if (!byDevice.has(key)) byDevice.set(key, { deviceId: key, deviceName: row.owner.deviceName, sessions: [] })
    byDevice.get(key).sessions.push(row)
  }

  const archivedRows = [...archived.values()].map((entry) => ({
    sessionId: entry.sessionId,
    bytes: entry.bytes,
    frames: entry.frames,
    cwd: entry.header?.cwd ?? null,
  }))

  return {
    devices: [...byDevice.values()],
    sessions: rows,
    archived: archivedRows,
    hostVocabulary: { types: host.types.size, scanned: host.scanned, empty: host.empty },
  }
}
