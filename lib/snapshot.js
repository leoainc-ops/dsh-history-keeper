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

import { findAttachmentRefs, readAttachment, resolveAttachment } from './attachments.js'
import { DEFAULT_MAX_CHUNK_BYTES, buildChunks } from './chunk.js'
import { scanLog } from './frames.js'
import { decodePayload } from './payload.js'
import { scanText } from './secrets.js'
import { findSessionLogs, readLogHeader } from './session-log.js'
import { putObject, readAllManifests, readManifestChain, writeManifest } from './store.js'
import { collectSessions } from './verify.js'
import { sha256, toIso } from './util.js'

/**
 * Attachment blobs the chain already holds, keyed by the sha256 the session references.
 * @param {Array<any>} chain
 * @returns {Map<string, any>}
 */
export function publishedAttachments(chain) {
  const blobs = new Map()
  for (const doc of chain) {
    for (const [hash, entry] of Object.entries(doc.attachments ?? {})) {
      if (!blobs.has(hash)) blobs.set(hash, entry)
    }
  }
  return blobs
}

/**
 * Capture attachments referenced by sessions that are already published.
 *
 * Incremental capture only looks at the bytes it is about to publish, so a session captured
 * before attachment support existed keeps its references going nowhere. This walks every
 * published session's full reconstructed log once and captures the blobs that are still
 * missing — explicitly, on demand, never as a surprise during an automatic capture.
 *
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home?: string, attachmentsRoot?: string, dryRun?: boolean, now?: string}} options
 */
export function backfillAttachments(store, options = {}) {
  const { home = null, attachmentsRoot = null, dryRun = false, now = toIso(), device = null } = options
  const root = attachmentsRoot ?? (home ? path.join(home, 'attachments') : null)
  if (!root) throw new Error('backfill needs either home or attachmentsRoot')

  const known = publishedAttachments(readAllManifests(store))
  const { sessions, problems } = collectSessions(store)
  const report = { scanned: 0, found: [], captured: [], missing: [], problems: [...problems], manifestSeq: null }
  const toStore = {}

  for (const session of sessions.values()) {
    report.scanned += 1
    const decoded = decodePayload(session.buffer)
    if (!decoded.ok) {
      report.problems.push({ sessionId: session.sessionId, code: 'DECODE_FAILED', message: decoded.failed })
      continue
    }
    for (const hash of findAttachmentRefs(decoded.text)) {
      if (known.has(hash) || toStore[hash]) continue
      const file = resolveAttachment(root, hash)
      if (!file) {
        report.missing.push({ sessionId: session.sessionId, hash })
        continue
      }
      report.found.push({ sessionId: session.sessionId, hash })
      if (dryRun) continue
      const read = readAttachment(file, hash)
      if (!read.verified) {
        report.problems.push({ sessionId: session.sessionId, hash, code: 'ATTACHMENT_MISMATCH', message: 'the file does not hash to the name the session references' })
        continue
      }
      const object = putObject(store, read.bytes)
      toStore[hash] = {
        objectId: object.id,
        cipherSha256: object.cipherSha256,
        cipherBytes: object.cipherBytes,
        bytes: read.bytes.length,
        createdAt: now,
      }
      report.captured.push({ sessionId: session.sessionId, hash, bytes: read.bytes.length })
    }
  }

  if (Object.keys(toStore).length > 0) {
    const { doc } = writeManifest(store, { deviceId: device?.deviceId ?? store.meta.deviceId, device, sessions: {}, attachments: toStore, createdAt: now })
    report.manifestSeq = doc.seq
  }
  return report
}

/** Per-session state accumulated from the manifest chain. */
export function publishedState(chain) {
  const state = new Map()
  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      const current = state.get(sessionId) ?? { frames: 0, bytes: 0, seq: 0, endSha256: null, formatVersion: null, lastPublishedAt: null }
      let { frames, bytes, seq } = current
      let endSha256 = current.endSha256
      let lastPublishedAt = current.lastPublishedAt
      for (const chunk of entry.chunks ?? []) {
        seq = Math.max(seq, chunk.seq)
        if (chunk.createdAt && (!lastPublishedAt || chunk.createdAt > lastPublishedAt)) lastPublishedAt = chunk.createdAt
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
        lastPublishedAt,
        formatVersion: entry.formatVersion ?? current.formatVersion,
      })
    }
  }
  return state
}

/**
 * Capture new bytes from a DSH home.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{home?: string, sessionsRoot?: string, maxChunkBytes?: number, sessionIds?: string[]|null, now?: string,
 *          minIntervalMs?: number, force?: boolean, secretScan?: boolean, secretScanAllow?: string[],
 *          secretScanEntropy?: boolean, captureAttachments?: boolean, attachmentsRoot?: string}} options
 */
export function snapshot(store, options) {
  const {
    home = null,
    sessionsRoot = null,
    maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES,
    sessionIds = null,
    now = toIso(),
    minIntervalMs = 0,
    force = false,
    secretScan = true,
    secretScanAllow = [],
    secretScanEntropy = false,
    captureAttachments = true,
    attachmentsRoot = null,
    device = null,
  } = options ?? {}

  const root = sessionsRoot ?? (home ? path.join(home, 'sessions') : null)
  if (!root) throw new Error('snapshot needs either home or sessionsRoot')
  const blobsRoot = attachmentsRoot ?? (home ? path.join(home, 'attachments') : null)

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
    quarantined: 0,
    attachments: [],
    attachmentBytes: 0,
  }

  const logs = findSessionLogs(root)
  const chain = readAllManifests(store)
  const state = publishedState(chain)
  const knownAttachments = publishedAttachments(chain)
  const payload = {}
  const attachmentPayload = {}

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

    // Coalescing: a session that was published moments ago keeps its new bytes pending, so a
    // burst of flushes does not produce a manifest per turn. The caller reschedules; `force`
    // (manual snapshot, or the session closing) always publishes.
    if (previous?.lastPublishedAt && minIntervalMs > 0 && !force) {
      const ageMs = Date.parse(now) - Date.parse(previous.lastPublishedAt)
      if (Number.isFinite(ageMs) && ageMs < minIntervalMs) {
        report.skipped.push({ sessionId, code: 'THROTTLED', retryInMs: Math.max(0, minIntervalMs - ageMs) })
        continue
      }
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

    // Decode once: the secret gate and attachment capture both read the same text.
    const needsText = (secretScan && !force) || captureAttachments
    const pendingBytes = needsText ? Buffer.concat(built.chunks.map((chunk) => chunk.payload)) : null
    const decoded = needsText ? decodePayload(pendingBytes) : null

    // Secret gate: inspect the bytes about to be published, before anything is sealed. A hit
    // quarantines the whole session — nothing of it is written — and never prints the value.
    if (secretScan && !force) {
      if (!decoded.ok) {
        report.quarantined += 1
        report.problems.push({
          sessionId,
          code: 'SCAN_FAILED',
          message: decoded.failed + '; nothing was published for this session',
        })
        continue
      }
      const matches = scanText(decoded.text, { allow: secretScanAllow, entropy: secretScanEntropy })
      if (matches.length > 0) {
        report.quarantined += 1
        report.problems.push({
          sessionId,
          code: 'QUARANTINED',
          rule: matches[0].rule,
          line: matches[0].line,
          message:
            'looks like it contains a secret (' +
            matches.map((match) => match.rule + ' at line ' + match.line).join(', ') +
            '); nothing was published. Re-run with --force to publish anyway, or allow the rule.',
        })
        continue
      }
    }

    // Attachments: capture only the blobs this session actually references, and only once.
    if (captureAttachments && decoded?.ok) {
      for (const hash of findAttachmentRefs(decoded.text)) {
        if (knownAttachments.has(hash) || attachmentPayload[hash]) continue
        const file = blobsRoot ? resolveAttachment(blobsRoot, hash) : null
        if (!file) {
          report.problems.push({
            sessionId,
            code: 'ATTACHMENT_MISSING',
            hash,
            message: 'the session references an attachment that is not in the DSH attachments directory',
          })
          continue
        }
        let read
        try {
          read = readAttachment(file, hash)
        } catch (error) {
          report.problems.push({ sessionId, code: 'ATTACHMENT_READ_FAILED', hash, message: error.message })
          continue
        }
        if (!read.verified) {
          report.problems.push({
            sessionId,
            code: 'ATTACHMENT_MISMATCH',
            hash,
            message: 'the attachment file content does not match the hash the session references',
          })
          continue
        }
        const object = putObject(store, read.bytes)
        attachmentPayload[hash] = {
          objectId: object.id,
          cipherSha256: object.cipherSha256,
          cipherBytes: object.cipherBytes,
          bytes: read.bytes.length,
          createdAt: now,
        }
        report.attachments.push({ hash, bytes: read.bytes.length })
        report.attachmentBytes += read.bytes.length
      }
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

  if (Object.keys(payload).length > 0 || Object.keys(attachmentPayload).length > 0) {
    const { doc } = writeManifest(store, {
      deviceId: device?.deviceId ?? store.meta.deviceId,
      device,
      sessions: payload,
      attachments: Object.keys(attachmentPayload).length > 0 ? attachmentPayload : null,
      createdAt: now,
    })
    report.manifestSeq = doc.seq
  }

  return report
}
