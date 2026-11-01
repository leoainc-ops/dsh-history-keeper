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
import { buildChunks } from './chunk.js'
import { ownerBySession } from './inventory.js'
import { publishedAttachments } from './snapshot.js'
import { getObject, initStore, openStore, putObject, readAllManifests, writeManifest } from './store.js'
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
 * @param {{outDir: string, passphrase: string, dryRun?: boolean, deviceName?: string, now?: string, maxChunkBytes?: number}} options
 */
export function mergeStores(stores, options) {
  const { outDir, passphrase, dryRun = false, deviceName = 'merged', now = toIso(), maxChunkBytes } = options
  if (!dryRun && !passphrase) throw new Error('merge needs the passphrase for the new store')

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
