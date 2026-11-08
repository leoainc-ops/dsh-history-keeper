/**
 * Merge two or more vaults into a new one.
 *
 * The sources are never written to: a merge reads them, resolves each session, and builds a
 * fresh vault with the union. That makes the operation safe to repeat and safe to get wrong.
 *
 * The rules are the deck rules:
 *  - identical content       → one copy;
 *  - one a prefix of another → the longer lineage wins, silently;
 *  - genuinely diverged      → the owner's lineage stays visible and the other continuation is
 *                              preserved as an **archived** entry. Nothing is decided about how
 *                              to present it (that is C.4); nothing is lost either.
 *
 * Dedupe happens at the chunk level by content hash, so the shared prefix of a diverged pair —
 * and any session captured twice — is sealed once.
 */
import fs from 'node:fs'
import path from 'node:path'

import { buildChunks } from './chunk.js'
import { ownerBySession } from './inventory.js'
import { publishedAttachments } from './snapshot.js'
import { getObject, initStore, openStore, putObject, readAllManifests, withStoreLock, writeManifest } from './store.js'
import { sha256, toIso } from './util.js'
import { collectSessions, verifyStore } from './verify.js'

/** @param {Buffer} a @param {Buffer} b */
export function relation(a, b) {
  if (a.equals(b)) return 'identical'
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  if (long.subarray(0, short.length).equals(short)) return short === a ? 'a-prefix' : 'b-prefix'
  return 'diverged'
}

/**
 * Read a source store into a survey: sessions, attachments, owners.
 * @param {{dir: string, meta: any, key: Buffer}} store
 */
export function surveySource(store) {
  const chain = readAllManifests(store, { fresh: true })
  const { sessions } = collectSessions(store)
  const attachments = new Map()
  for (const [hash, entry] of publishedAttachments(chain)) {
    try {
      const bytes = getObject(store, entry.objectId, entry.cipherSha256)
      if (sha256(bytes) === hash) attachments.set(hash, { bytes })
    } catch {
      /* an unreadable blob is reported by verify; the merge does not guess */
    }
  }
  return {
    store,
    sessions,
    attachments,
    owners: ownerBySession(chain),
    deviceId: store.meta.deviceId,
    deviceName: store.meta.deviceName,
    storeId: store.meta.storeId,
  }
}

/**
 * Resolve the candidates of one session into a visible lineage plus archived continuations.
 * @param {string} sessionId
 * @param {Array<{survey: any, session: any}>} list
 * @returns {{visible: any, archived: Array<any>, action: string}}
 */
export function resolveSession(sessionId, list) {
  if (list.length === 1) return { visible: list[0], archived: [], action: 'single' }

  // A lineage that contains every other one wins: it is strictly more history.
  for (const candidate of list) {
    const containsAll = list.every(
      (other) => other === candidate || relation(other.session.buffer, candidate.session.buffer) === 'a-prefix',
    )
    if (containsAll) return { visible: candidate, archived: [], action: 'longer' }
  }

  // Otherwise pick by owner: the device whose manifest introduced chunk 1.
  const ownerOf = (item) => item.survey.owners.get(sessionId) ?? item.survey.deviceId
  const owner = ownerOf(list[0])
  const visible = list.find((item) => ownerOf(item) === owner) ?? list[0]
  const archived = list
    .filter((item) => item !== visible && relation(item.session.buffer, visible.session.buffer) === 'diverged')
    .map((item) => ({ ...item, archiveKey: sessionId + '@' + String(item.survey.owners.get(sessionId) ?? item.survey.deviceId).slice(0, 8) }))
  return { visible, archived, action: archived.length > 0 ? 'owner+archived' : 'owner' }
}

/**
 * @param {Array<{dir: string, meta: any, key: Buffer}>} stores in priority order
 * @param {{outDir: string, passphrase: string, dryRun?: boolean, deviceName?: string, now?: string, maxChunkBytes?: number, onDivergence?: 'owner'|'error'}} options
 */
export function mergeStores(stores, options) {
  const { outDir, passphrase, dryRun = false, deviceName = 'merged', now = toIso(), maxChunkBytes, onDivergence = 'owner' } = options
  if (!dryRun && !passphrase) throw new Error('merge needs the passphrase for the new store')
  if (onDivergence !== 'owner' && onDivergence !== 'error') {
    throw new Error("onDivergence must be 'owner' or 'error': a merged store keeps one visible conversation per session")
  }

  const surveys = stores.map((store) => surveySource(store))

  const candidates = new Map()
  for (const survey of surveys) {
    for (const session of survey.sessions.values()) {
      const list = candidates.get(session.sessionId) ?? []
      list.push({ survey, session })
      candidates.set(session.sessionId, list)
    }
  }

  const visible = []
  const archived = []
  for (const [sessionId, list] of candidates) {
    const resolved = resolveSession(sessionId, list)
    visible.push({ sessionId, ...resolved.visible, action: resolved.action })
    for (const item of resolved.archived) archived.push({ sessionId, ...item })
  }

  if (onDivergence === 'error' && archived.length > 0) {
    throw new Error(
      'the vaults disagree on ' +
        archived.length +
        ' continuation(s); rerun with --on-divergence=owner to keep the owner line and archive the other',
    )
  }

  const out = dryRun ? null : (() => {
    initStore(outDir, { passphrase, deviceName })
    return openStore(outDir, passphrase)
  })()

  const seen = new Map()
  const stats = { chunks: 0, dedupedChunks: 0, dedupedBytes: 0, objects: 0 }

  /** Seal one session's chunks into the new store, reusing identical plaintext. */
  const sealSession = (item) => {
    const built = buildChunks(item.session.buffer, { fromByte: 0, fromFrame: 0, maxChunkBytes })
    const chunks = []
    let seq = 0
    for (const chunk of built.chunks) {
      seq += 1
      stats.chunks += 1
      const plainSha256 = sha256(chunk.payload)
      const hit = seen.get(plainSha256)
      if (hit) {
        stats.dedupedChunks += 1
        stats.dedupedBytes += chunk.payload.length
        chunks.push({ ...hit, seq, byteFrom: chunk.byteFrom, byteTo: chunk.byteTo, frameFrom: chunk.frameFrom, frameTo: chunk.frameTo })
        continue
      }
      const object = dryRun ? null : putObject(out, chunk.payload)
      if (object) stats.objects += 1
      const descriptor = {
        seq,
        objectId: object?.id ?? null,
        cipherSha256: object?.cipherSha256 ?? null,
        cipherBytes: object?.cipherBytes ?? null,
        plainSha256,
        prefixSha256: chunk.prefixSha256,
        endSha256: chunk.endSha256,
        frameFrom: chunk.frameFrom,
        frameTo: chunk.frameTo,
        byteFrom: chunk.byteFrom,
        byteTo: chunk.byteTo,
        createdAt: now,
      }
      seen.set(plainSha256, descriptor)
      chunks.push(descriptor)
    }
    return { formatVersion: item.session.formatVersion, header: item.session.header, chunks, origin: originOf(item) }
  }

  const sessionsPayload = {}
  for (const item of visible) sessionsPayload[item.sessionId] = sealSession(item)
  const archivedPayload = {}
  for (const item of archived) archivedPayload[item.archiveKey] = { ...sealSession(item), sessionId: item.sessionId, archiveKey: item.archiveKey }

  // Attachments: content-addressed, so one copy per hash across every source.
  const attachmentPayload = {}
  for (const survey of surveys) {
    for (const [hash, { bytes }] of survey.attachments) {
      if (attachmentPayload[hash]) continue
      const object = dryRun ? null : putObject(out, bytes)
      if (object) stats.objects += 1
      attachmentPayload[hash] = {
        objectId: object?.id ?? null,
        cipherSha256: object?.cipherSha256 ?? null,
        cipherBytes: object?.cipherBytes ?? null,
        bytes: bytes.length,
        createdAt: now,
      }
    }
  }

  const report = {
    outDir,
    dryRun,
    sources: surveys.map((survey) => ({
      storeId: survey.storeId,
      deviceId: survey.deviceId,
      deviceName: survey.deviceName,
      sessions: survey.sessions.size,
      attachments: survey.attachments.size,
    })),
    sessions: visible.map((item) => ({
      sessionId: item.sessionId,
      bytes: item.session.buffer.length,
      frames: item.session.frames,
      cwd: item.session.header?.cwd ?? null,
      action: item.action,
      origin: originOf(item),
    })),
    archived: archived.map((item) => ({
      sessionId: item.sessionId,
      archiveKey: item.archiveKey,
      bytes: item.session.buffer.length,
      origin: originOf(item),
    })),
    attachments: Object.keys(attachmentPayload).length,
    stats,
    manifestSeq: null,
    verification: null,
  }

  if (dryRun) return report

  const { doc } = writeManifest(out, {
    deviceId: out.meta.deviceId,
    kind: 'merged',
    prev: null,
    sessions: sessionsPayload,
    archived: Object.keys(archivedPayload).length > 0 ? archivedPayload : null,
    attachments: Object.keys(attachmentPayload).length > 0 ? attachmentPayload : null,
    covers: {
      sources: surveys.map((survey) => ({ storeId: survey.storeId, deviceId: survey.deviceId })),
      mergedAt: now,
    },
    createdAt: now,
  })
  report.manifestSeq = doc.seq

  const verified = verifyStore(out)
  report.verification = {
    ok: verified.ok,
    sessions: verified.totals.sessions,
    archived: verified.totals.archived,
    frames: verified.totals.frames,
    bytes: verified.totals.bytes,
    attachments: verified.totals.attachments,
    problems: verified.problems.map((problem) => (problem.sessionId ? String(problem.sessionId).slice(0, 24) + ': ' : '') + problem.code),
  }
  return report
}

/** @param {{survey: any}} item */
function originOf(item) {
  return { deviceId: item.survey.deviceId, deviceName: item.survey.deviceName, storeId: item.survey.storeId }
}

/**
 * Bring a carried vault into the local one **in place**, without copying or re-sealing anything
 * that already exists.
 *
 * The old import built a new vault and swapped it in: the same bytes were sealed again with a new
 * ciphertext and the previous vault stayed on disk, so every trip multiplied the size. This writes
 * one additional manifest into the local vault instead:
 *  - a chunk whose plaintext is already stored is referenced, never sealed again;
 *  - only genuinely new bytes are sealed, once;
 *  - sessions that change are written with `reset`, so the new descriptor list is the lineage;
 *  - the previous archived lineages are re-listed so a reset does not lose them;
 *  - on any failure the previous head pointer and meta are restored.
 *
 * @param {{localStore: any, stickStore: any, device: any, now?: string, maxChunkBytes?: number,
 *          onDivergence?: 'owner'|'error', dryRun?: boolean}} options
 */
export function mergeIntoStore(options) {
  const { localStore, stickStore, device, now = toIso(), maxChunkBytes, onDivergence = 'owner', dryRun = false } = options
  if (!device || !device.deviceId) throw new Error('mergeIntoStore needs the device identity of this machine')

  return withStoreLock(localStore.dir, { timeoutMs: 60_000 }, () => {
    const localSurvey = surveySource(localStore)
    const stickSurvey = surveySource(stickStore)
    const surveys = [localSurvey, stickSurvey]

    const candidates = new Map()
    for (const survey of surveys) {
      for (const session of survey.sessions.values()) {
        const list = candidates.get(session.sessionId) ?? []
        list.push({ survey, session })
        candidates.set(session.sessionId, list)
      }
    }

    const visible = []
    const archived = []
    for (const [sessionId, list] of candidates) {
      const resolved = resolveSession(sessionId, list)
      visible.push({ sessionId, ...resolved.visible, action: resolved.action })
      for (const item of resolved.archived) archived.push({ sessionId, ...item })
    }
    if (onDivergence === 'error' && archived.length > 0) {
      throw new Error(
        'the vaults disagree on ' + archived.length + ' continuation(s); rerun with --on-divergence=owner to keep the owner line and archive the other',
      )
    }

    // Nothing new means nothing to write: importing the same vault twice must not grow the chain.
    const localSessions = localSurvey.sessions
    const changedSessions = visible.filter((item) => {
      const mine = localSessions.get(item.sessionId)
      return !mine || !mine.buffer.equals(item.session.buffer)
    })
    const existingArchiveKeys = new Set()
    for (const doc of readAllManifests(localStore, { fresh: true })) {
      for (const key of Object.keys(doc.archived ?? {})) existingArchiveKeys.add(key)
    }
    const newArchived = archived.filter((item) => !existingArchiveKeys.has(item.archiveKey))

    // Nothing new means nothing to write: importing the same vault twice must not grow the chain.
    const knownNow = publishedAttachments(readAllManifests(localStore, { fresh: true }))
    const newAttachmentsNow = [...stickSurvey.attachments.keys()].filter((hash) => !knownNow[hash])
    if (changedSessions.length === 0 && newArchived.length === 0 && newAttachmentsNow.length === 0 && !dryRun) {
      const verifiedNow = verifyStore(localStore)
      return {
        kind: 'keeper-import',
        version: 2,
        createdAt: now,
        dryRun: false,
        sources: surveys.map((survey) => ({ storeId: survey.storeId, deviceName: survey.deviceName, sessions: survey.sessions.size })),
        sessions: visible.map((item) => ({ sessionId: item.sessionId, bytes: item.session.buffer.length, action: item.action })),
        archived: archived.map((item) => ({ sessionId: item.sessionId, archiveKey: item.archiveKey, bytes: item.session.buffer.length })),
        attachments: 0,
        stats: { chunks: 0, reused: 0, sealed: 0, sealedBytes: 0 },
        changed: false,
        manifestSeq: null,
        verification: {
          ok: verifiedNow.ok,
          sessions: verifiedNow.totals.sessions,
          archived: verifiedNow.totals.archived,
          frames: verifiedNow.totals.frames,
          bytes: verifiedNow.totals.bytes,
          attachments: verifiedNow.totals.attachments,
          problems: verifiedNow.problems.map((problem) => problem.code),
        },
      }
    }

    // Every plaintext the local vault already stores, so identical chunks are referenced, not sealed.
    const chain = readAllManifests(localStore, { fresh: true })
    const index = new Map()
    for (const doc of chain) {
      for (const entry of [...Object.values(doc.sessions ?? {}), ...Object.values(doc.archived ?? {})]) {
        for (const chunk of entry.chunks ?? []) {
          if (chunk.plainSha256 && chunk.objectId) index.set(chunk.plainSha256, chunk)
        }
      }
    }

    // What each session already has, from the newest manifest that mentions it. Merging is
    // append-only: a session only receives the bytes it lacks, so its lineage stays contiguous
    // and nothing already published is re-chunked (re-chunking is what produced a BYTE_GAP).
    const lineage = new Map()
    for (const doc of chain) {
      for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
        if (!lineage.has(sessionId)) lineage.set(sessionId, entry.chunks ?? [])
      }
    }

    const stats = { chunks: 0, reused: 0, sealed: 0, sealedBytes: 0 }
    const buildEntry = (item) => {
      const existing = lineage.get(item.sessionId) ?? []
      const last = existing.length > 0 ? existing[existing.length - 1] : null
      const fromByte = last ? last.byteTo : 0
      const fromFrame = last ? last.frameTo : 0
      const built = buildChunks(item.session.buffer, { fromByte, fromFrame, maxChunkBytes })
      const base = last ? last.seq : 0
      const chunks = built.chunks.map((chunk, position) => {
        const plainSha256 = sha256(chunk.payload)
        stats.chunks += 1
        const hit = index.get(plainSha256)
        let object = hit
        if (!object) {
          stats.sealed += 1
          stats.sealedBytes += chunk.payload.length
          const sealed = dryRun ? { id: 'dry-run', cipherSha256: 'dry-run', cipherBytes: chunk.payload.length } : putObject(localStore, chunk.payload)
          object = { objectId: sealed.id, cipherSha256: sealed.cipherSha256, cipherBytes: sealed.cipherBytes, plainSha256 }
          index.set(plainSha256, object)
        } else {
          stats.reused += 1
        }
        return {
          seq: base + position + 1,
          objectId: object.objectId,
          cipherSha256: object.cipherSha256,
          cipherBytes: object.cipherBytes,
          plainSha256,
          prefixSha256: chunk.prefixSha256,
          endSha256: chunk.endSha256,
          frameFrom: chunk.frameFrom,
          frameTo: chunk.frameTo,
          byteFrom: chunk.byteFrom,
          byteTo: chunk.byteTo,
          createdAt: now,
        }
      })
      return { formatVersion: item.session.formatVersion, header: item.session.header, chunks, origin: originOf(item) }
    }

    const sessionsPayload = {}
    for (const item of visible) {
      const existing = lineage.get(item.sessionId) ?? []
      const last = existing.length > 0 ? existing[existing.length - 1] : null
      const have = last ? last.byteTo : 0
      if (have === item.session.buffer.length) continue // identical: nothing to write
      if (item.session.buffer.length < have) continue // history never shrinks
      sessionsPayload[item.sessionId] = buildEntry(item)
    }

    // Merging appends, so older archived lineages stay reachable without being listed again.
    const archivedPayload = {}
    for (const item of archived) {
      let key = item.archiveKey
      if (archivedPayload[key]) key = key + '-' + Object.keys(archivedPayload).length
      archivedPayload[key] = { ...buildEntry(item), sessionId: item.sessionId, archiveKey: key }
    }

    // Attachments that the carried vault has and this one does not yet.
    const attachmentPayload = {}
    const known = publishedAttachments(chain)
    for (const survey of [stickSurvey]) {
      for (const [hash, { bytes }] of survey.attachments) {
        if (known[hash] || attachmentPayload[hash]) continue
        const object = dryRun ? { id: 'dry-run', cipherSha256: 'dry-run', cipherBytes: bytes.length } : putObject(localStore, bytes)
        attachmentPayload[hash] = {
          objectId: object.id,
          cipherSha256: object.cipherSha256,
          cipherBytes: object.cipherBytes,
          bytes: bytes.length,
          createdAt: now,
        }
      }
    }

    const report = {
      kind: 'keeper-import',
      version: 2,
      createdAt: now,
      dryRun,
      sources: surveys.map((survey) => ({ storeId: survey.storeId, deviceName: survey.deviceName, sessions: survey.sessions.size })),
      sessions: visible.map((item) => ({ sessionId: item.sessionId, bytes: item.session.buffer.length, action: item.action })),
      archived: archived.map((item) => ({ sessionId: item.sessionId, archiveKey: item.archiveKey, bytes: item.session.buffer.length })),
      attachments: Object.keys(attachmentPayload).length,
      stats,
      changed: changedSessions.length > 0 || newArchived.length > 0 || newAttachmentsNow.length > 0,
      manifestSeq: null,
      verification: null,
    }
    if (dryRun) return report

    // Rollback: keep the two pointers that make the new manifest reachable.
    const metaBefore = JSON.stringify(localStore.meta)
    const headPath = path.join(localStore.dir, 'devices', String(device.deviceId) + '.json')
    const headBefore = fs.existsSync(headPath) ? fs.readFileSync(headPath, 'utf8') : null
    let doc
    try {
      ;({ doc } = writeManifest(localStore, {
        deviceId: device.deviceId,
        device,
        sessions: sessionsPayload,
        ...(Object.keys(archivedPayload).length > 0 ? { archived: archivedPayload } : {}),
        ...(Object.keys(attachmentPayload).length > 0 ? { attachments: attachmentPayload } : {}),
        createdAt: now,
      }))
    } catch (error) {
      restoreHead(metaBefore, headPath, headBefore, localStore)
      throw error
    }
    report.manifestSeq = doc.seq

    const verified = verifyStore(localStore)
    report.verification = {
      ok: verified.ok,
      sessions: verified.totals.sessions,
      archived: verified.totals.archived,
      frames: verified.totals.frames,
      bytes: verified.totals.bytes,
      attachments: verified.totals.attachments,
      problems: verified.problems.map((problem) => (problem.sessionId ? String(problem.sessionId).slice(0, 24) + ': ' : '') + problem.code),
    }
    if (!verified.ok) {
      // The vault must never be left in a state this code cannot read.
      restoreHead(metaBefore, headPath, headBefore, localStore)
      throw new Error('the merged vault does not verify (' + report.verification.problems.join(', ') + '); the previous state was restored')
    }
    return report
  })
}

/** Put the head and the meta pointer back the way they were before a failed write. */
function restoreHead(metaBefore, headPath, headBefore, store) {
  try {
    const meta = JSON.parse(metaBefore)
    fs.writeFileSync(path.join(store.dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')
    store.meta = meta
    if (headBefore === null) fs.rmSync(headPath, { force: true })
    else fs.writeFileSync(headPath, headBefore, 'utf8')
  } catch {
    /* the caller is already throwing; a failed rollback keeps the original error */
  }
}
