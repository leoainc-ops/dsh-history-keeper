/**
 * Snapshot: capture what is new in the local DSH store and seal it into the keeper.
 *
 * Invariants:
 *  - only complete frames are captured (a torn tail is skipped, never trimmed on disk);
 *  - the local log must still contain every byte already published (append-only);
 *  - for each chunk we record both the hash before it and the hash including it, so a
 *    reader can prove continuity without recomputing anything by hand.
 */
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_MAX_CHUNK_BYTES, buildChunks } from './chunk.js'
import { scanLog } from './frames.js'
import { findSessionLogs, readLogHeader } from './session-log.js'
import { putObject, readManifestChain, writeManifest } from './store.js'
import { sha256, toIso } from './util.js'

/** Per-session state accumulated from the manifest chain. */
export function publishedState(chain) {
  const state = new Map()
  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      const current = state.get(sessionId) ?? { frames: 0, bytes: 0, seq: 0, endSha256: null, formatVersion: null }
      let { frames, bytes, seq } = current
      let endSha256 = current.endSha256
      for (const chunk of entry.chunks ?? []) {
        seq = Math.max(seq, chunk.seq)
        if (chunk.byteTo >= bytes) {
          bytes = chunk.byteTo
          frames = chunk.frameTo
          endSha256 = chunk.endSha256
        }
      }
      state.set(sessionId, {
        frames,
        bytes,
        seq,
        endSha256,
        formatVersion: entry.formatVersion ?? current.formatVersion,
      })
    }
  }
  return state
}

/**
 * Capture new bytes from a DSH home.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home: string, maxChunkBytes?: number, sessionIds?: string[]|null, now?: string}} options
 */
export function snapshot(store, options) {
  const {
    home = null,
    sessionsRoot = null,
    maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES,
    sessionIds = null,
    now = toIso(),
  } = options ?? {}

  const root = sessionsRoot ?? (home ? path.join(home, 'sessions') : null)
  if (!root) throw new Error('snapshot needs either home or sessionsRoot')

  const report = {
    home: home ?? root,
    sessionsRoot: root,
    createdAt: now,
    sessions: [],
    skipped: [],
    problems: [],
    chunks: 0,
    bytes: 0,
    manifestSeq: null,
  }

  const logs = findSessionLogs(root)
  const chain = readManifestChain(store)
  const state = publishedState(chain)
  const payload = {}

  for (const log of logs) {
    let buffer
    try {
      buffer = fs.readFileSync(log.file)
    } catch (error) {
      report.problems.push({ file: log.file, code: 'READ_FAILED', message: error.message })
      continue
    }

    let header
    let version
    let committedBytes
    let committedFrames
    try {
      const info = readLogHeader(buffer)
      header = info.header
      version = log.version || info.version || header.version
      const scan = scanLog(buffer)
      committedBytes = scan.committedLength
      committedFrames = scan.frameCount
    } catch (error) {
      report.problems.push({ file: log.file, code: 'BAD_LOG', message: error.message })
      continue
    }

    const sessionId = header.id
    if (!sessionId) {
      report.problems.push({ file: log.file, code: 'BAD_HEADER', message: 'header has no session id' })
      continue
    }
    if (sessionIds && !sessionIds.includes(sessionId)) continue

    const previous = state.get(sessionId)
    if (previous && previous.bytes > 0) {
      if (committedBytes < previous.bytes) {
        report.problems.push({
          sessionId,
          code: 'LOCAL_BEHIND',
          message: 'local log has ' + committedBytes + ' bytes but ' + previous.bytes + ' are already published',
        })
        continue
      }
      const localPrefix = sha256(buffer.subarray(0, previous.bytes))
      if (previous.endSha256 && localPrefix !== previous.endSha256) {
        report.problems.push({
          sessionId,
          code: 'DIVERGED',
          message: 'local log no longer contains the published history (fork or rewrite); nothing was written',
        })
        continue
      }
    }

    const fromByte = previous?.bytes ?? 0
    const fromFrame = previous?.frames ?? 0
    if (fromFrame === committedFrames && fromByte === committedBytes) {
      report.skipped.push({ sessionId, code: 'UP_TO_DATE' })
      continue
    }

    let built
    try {
      built = buildChunks(buffer, { fromByte, fromFrame, maxChunkBytes })
    } catch (error) {
      report.problems.push({ sessionId, code: 'CHUNK_FAILED', message: error.message })
      continue
    }

    if (built.chunks.length === 0) {
      report.skipped.push({ sessionId, code: 'NO_COMPLETE_FRAMES' })
      continue
    }

    let seq = previous?.seq ?? 0
    const descriptors = []
    let sessionBytes = 0
    for (const chunk of built.chunks) {
      const object = putObject(store, chunk.payload)
      seq += 1
      sessionBytes += chunk.payload.length
      descriptors.push({
        seq,
        objectId: object.id,
        cipherSha256: object.cipherSha256,
        cipherBytes: object.cipherBytes,
        plainSha256: sha256(chunk.payload),
        prefixSha256: chunk.prefixSha256,
        endSha256: chunk.endSha256,
        frameFrom: chunk.frameFrom,
        frameTo: chunk.frameTo,
        byteFrom: chunk.byteFrom,
        byteTo: chunk.byteTo,
        createdAt: now,
      })
    }

    payload[sessionId] = {
      formatVersion: version,
      header: {
        id: sessionId,
        cwd: header.cwd ?? null,
        createdAt: header.createdAt ?? null,
        isSeeded: header.isSeeded ?? null,
      },
      chunks: descriptors,
    }
    report.chunks += descriptors.length
    report.bytes += sessionBytes
    report.sessions.push({
      sessionId,
      chunks: descriptors.length,
      bytes: sessionBytes,
      frames: descriptors[descriptors.length - 1].frameTo,
      tornTail: built.tornTail,
    })
  }

  if (Object.keys(payload).length > 0) {
    const { doc } = writeManifest(store, { deviceId: store.meta.deviceId, sessions: payload, createdAt: now })
    report.manifestSeq = doc.seq
  }

  return report
}
