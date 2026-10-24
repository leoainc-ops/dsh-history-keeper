/**
 * Verification and materialization.
 *
 * Verification walks the manifest chain (checking every hash that references each
 * manifest), reconstructs each session from its chunks and re-checks the whole chain
 * of content hashes, decrypting with the store key. It never writes to the store.
 *
 * `collectSessions` is the single reconstruction path: both `verify` and `restore`
 * consume it, so what restore writes is exactly what verify approved.
 */
import { createHash } from 'node:crypto'

import { readLogHeader } from './session-log.js'
import { getObject, readManifestChain } from './store.js'

/**
 * Rebuild every session from the store.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @returns {{sessions: Map<string, any>, problems: Array<any>}}
 */
export function collectSessions(store) {
  const entries = new Map()
  const problems = []

  let chain
  try {
    // Fresh: verification must read the chain from disk, never from the in-process cache,
    // or a deleted or corrupted object could go unreported after a status call.
    chain = readManifestChain(store, { fresh: true })
  } catch (error) {
    // A damaged manifest chain is a verification RESULT, never an exception that escapes:
    // callers must be able to report it and refuse to write anything.
    return { sessions: new Map(), problems: [{ code: error.code ?? 'CHAIN_FAILED', message: error.message }] }
  }

  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      const current = entries.get(sessionId) ?? {
        sessionId,
        formatVersion: entry.formatVersion ?? null,
        header: entry.header ?? null,
        chunks: [],
      }
      for (const chunk of entry.chunks ?? []) current.chunks.push(chunk)
      entries.set(sessionId, current)
    }
  }

  const sessions = new Map()
  for (const [sessionId, entry] of entries) {
    const chunks = entry.chunks.slice().sort((a, b) => a.seq - b.seq)
    const running = createHash('sha256')
    const parts = []
    let bytes = 0
    let frames = 0
    let expectedSeq = 1
    let broken = false

    for (const chunk of chunks) {
      if (chunk.seq !== expectedSeq) {
        problems.push({ sessionId, code: 'SEQ_GAP', message: 'expected chunk ' + expectedSeq + ', found ' + chunk.seq })
        broken = true
        break
      }
      expectedSeq += 1

      if (chunk.byteFrom !== bytes) {
        problems.push({ sessionId, chunk: chunk.seq, code: 'BYTE_GAP', message: 'byteFrom ' + chunk.byteFrom + ' but ' + bytes + ' reconstructed' })
        broken = true
        break
      }
      if (chunk.frameFrom !== frames) {
        problems.push({ sessionId, chunk: chunk.seq, code: 'FRAME_GAP', message: 'frameFrom ' + chunk.frameFrom + ' but ' + frames + ' reconstructed' })
        broken = true
        break
      }
      const prefix = running.copy().digest('hex')
      if (prefix !== chunk.prefixSha256) {
        problems.push({ sessionId, chunk: chunk.seq, code: 'PREFIX_MISMATCH', message: 'chunk does not link to the previous history' })
        broken = true
        break
      }

      let plaintext
      try {
        plaintext = getObject(store, chunk.objectId, chunk.cipherSha256)
      } catch (error) {
        problems.push({ sessionId, chunk: chunk.seq, code: error.code ?? 'OBJECT_FAILED', message: error.message })
        broken = true
        break
      }

      const plainHash = createHash('sha256').update(plaintext).digest('hex')
      if (plainHash !== chunk.plainSha256) {
        problems.push({ sessionId, chunk: chunk.seq, code: 'PLAINTEXT_MISMATCH', message: 'decrypted content does not match its hash' })
        broken = true
        break
      }

      running.update(plaintext)
      const end = running.copy().digest('hex')
      if (end !== chunk.endSha256) {
        problems.push({ sessionId, chunk: chunk.seq, code: 'END_MISMATCH', message: 'chunk end hash does not match' })
        broken = true
        break
      }

      parts.push(plaintext)
      bytes = chunk.byteTo
      frames = chunk.frameTo
    }

    if (broken) continue

    const buffer = Buffer.concat(parts)
    if (buffer.length !== bytes) {
      problems.push({ sessionId, code: 'LENGTH_MISMATCH', message: buffer.length + ' bytes reconstructed, manifest says ' + bytes })
      continue
    }

    try {
      const info = readLogHeader(buffer)
      if (info.header.id !== sessionId) {
        problems.push({ sessionId, code: 'HEADER_MISMATCH', message: 'log header declares ' + info.header.id })
        continue
      }
    } catch (error) {
      problems.push({ sessionId, code: 'HEADER_INVALID', message: error.message })
      continue
    }

    sessions.set(sessionId, {
      sessionId,
      formatVersion: entry.formatVersion,
      header: entry.header,
      chunks: chunks.length,
      frames,
      bytes,
      buffer,
    })
  }

  return { sessions, problems, chain }
}

/**
 * Verify attachment blobs referenced by the chain: decrypt each one and prove that its
 * content still hashes to the name the session references.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {Array<any>} chain
 * @returns {{blobs: Array<{hash: string, bytes: number}>, problems: Array<any>}}
 */
export function verifyAttachments(store, chain) {
  const blobs = []
  const problems = []
  const seen = new Set()
  for (const doc of chain) {
    for (const [hash, entry] of Object.entries(doc.attachments ?? {})) {
      if (seen.has(hash)) continue
      seen.add(hash)
      let plaintext
      try {
        plaintext = getObject(store, entry.objectId, entry.cipherSha256)
      } catch (error) {
        problems.push({ hash, code: error.code ?? 'ATTACHMENT_OBJECT_FAILED', message: error.message })
        continue
      }
      const digest = createHash('sha256').update(plaintext).digest('hex')
      if (digest !== hash) {
        problems.push({ hash, code: 'ATTACHMENT_MISMATCH', message: 'blob content hashes to ' + digest })
        continue
      }
      if (entry.bytes !== undefined && entry.bytes !== plaintext.length) {
        problems.push({ hash, code: 'ATTACHMENT_LENGTH', message: plaintext.length + ' bytes, manifest says ' + entry.bytes })
        continue
      }
      blobs.push({ hash, bytes: plaintext.length })
    }
  }
  return { blobs, problems }
}

/**
 * Verify a store end to end.
 * @param {{dir: string, meta: any, key: Buffer}} store
 */
export function verifyStore(store) {
  const { sessions, problems, chain } = collectSessions(store)
  const list = []
  let frames = 0
  let bytes = 0
  for (const session of sessions.values()) {
    list.push({ sessionId: session.sessionId, chunks: session.chunks, frames: session.frames, bytes: session.bytes })
    frames += session.frames
    bytes += session.bytes
  }

  const attachments = verifyAttachments(store, chain ?? [])
  problems.push(...attachments.problems)
  const attachmentBytes = attachments.blobs.reduce((sum, blob) => sum + blob.bytes, 0)

  return {
    ok: problems.length === 0,
    sessions: list,
    attachments: attachments.blobs,
    problems,
    totals: { sessions: list.length, frames, bytes, attachments: attachments.blobs.length, attachmentBytes },
  }
}
