/**
 * Compaction.
 *
 * The manifest chain costs one file read per manifest: on a real vault that is several
 * seconds per command, and it only grows. A checkpoint is a manifest that carries *every*
 * chunk descriptor accumulated so far (with all their hashes) and starts a fresh chain, so
 * the next read is one file instead of hundreds.
 *
 * What compaction keeps: the bytes, the hash of every chunk, the prefix/end chain that proves
 * continuity, and the attachments. What it gives up: the record of *which* snapshot added
 * which chunk. That provenance lives in the old manifests, which stay on disk as
 * unreferenced objects until an explicit `gc` removes them.
 *
 * A checkpoint is never written by accident: `compact` runs only when the policy says so or
 * when the operator asks for it.
 */
import fs from 'node:fs'
import path from 'node:path'

import { getObject, readManifestChain, writeManifest } from './store.js'
import { toIso } from './util.js'

/**
 * Object ids the current chain still needs: manifests, chunk objects and attachment blobs.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @returns {Set<string>}
 */
function referencedIds(store) {
  const ids = new Set()
  let pointer = store.meta.manifest
  let guard = 0
  while (pointer) {
    if (guard++ > 200_000) throw new Error('manifest chain does not terminate')
    ids.add(pointer.id)
    const doc = JSON.parse(getObject(store, pointer.id, pointer.cipherSha256).toString('utf8'))
    for (const entry of Object.values(doc.sessions ?? {})) {
      for (const chunk of entry.chunks ?? []) ids.add(chunk.objectId)
    }
    for (const entry of Object.values(doc.attachments ?? {})) ids.add(entry.objectId)
    pointer = doc.prev ?? null
  }
  return ids
}

/**
 * Merge a chain into one cumulative manifest document.
 * @param {Array<any>} chain
 * @returns {{sessions: object, attachments: object|null, chunks: number}}
 */
export function mergeChain(chain) {
  const sessions = {}
  const attachments = {}
  let hasAttachments = false

  for (const doc of chain) {
    for (const [sessionId, entry] of Object.entries(doc.sessions ?? {})) {
      const current = sessions[sessionId] ?? { formatVersion: entry.formatVersion ?? null, header: entry.header ?? null, chunks: [] }
      if (entry.formatVersion !== undefined) current.formatVersion = entry.formatVersion
      if (entry.header) current.header = entry.header
      for (const chunk of entry.chunks ?? []) {
        const existing = current.chunks.find((item) => item.seq === chunk.seq)
        if (existing) Object.assign(existing, chunk)
        else current.chunks.push(chunk)
      }
      sessions[sessionId] = current
    }
    for (const [hash, entry] of Object.entries(doc.attachments ?? {})) {
      if (!attachments[hash]) {
        attachments[hash] = entry
        hasAttachments = true
      }
    }
  }

  let chunks = 0
  for (const entry of Object.values(sessions)) {
    entry.chunks.sort((a, b) => a.seq - b.seq)
    chunks += entry.chunks.length
  }
  return { sessions, attachments: hasAttachments ? attachments : null, chunks }
}

/**
 * Replace the current chain with one checkpoint manifest.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{now?: string, dryRun?: boolean}} [options]
 */
export function compact(store, options = {}) {
  const { now = toIso(), dryRun = false } = options

  if (dryRun) {
    const chain = readManifestChain(store, { fresh: true })
    const merged = mergeChain(chain)
    return {
      compacted: false,
      dryRun: true,
      wouldCompact: chain.length > 1,
      reason: chain.length > 1 ? 'a checkpoint would replace ' + chain.length + ' manifests' : 'already a single manifest',
      manifestsBefore: chain.length,
      manifestsAfter: 1,
      chunks: merged.chunks,
    }
  }

  // Serialise compaction so two writers cannot both build a checkpoint from the same head.
  const head = store.meta.manifest
  if (!head) return { compacted: false, reason: 'the chain is empty', manifestsBefore: 0, manifestsAfter: 0, chunks: 0 }

  const chain = readManifestChain(store, { fresh: true })
  if (chain.length === 1 && chain[0].kind === 'checkpoint') {
    return { compacted: false, reason: 'already a checkpoint', manifestsBefore: 1, manifestsAfter: 1, chunks: mergeChain(chain).chunks }
  }
  if (store.meta.manifest !== head) {
    return { compacted: false, reason: 'the store changed while compacting; nothing was written', manifestsBefore: chain.length, manifestsAfter: chain.length, chunks: 0 }
  }

  const merged = mergeChain(chain)
  const previousHead = { id: store.meta.manifest.id, cipherSha256: store.meta.manifest.cipherSha256 }
  const { doc, ref } = writeManifest(store, {
    deviceId: store.meta.deviceId,
    sessions: merged.sessions,
    attachments: merged.attachments,
    kind: 'checkpoint',
    covers: {
      manifests: chain.length,
      from: chain[0].seq,
      to: chain[chain.length - 1].seq,
      coveredFrom: chain[0].createdAt,
      coveredTo: chain[chain.length - 1].createdAt,
      previousHead,
    },
    prev: null,
    createdAt: now,
  })

  return {
    compacted: true,
    manifestsBefore: chain.length,
    manifestsAfter: 1,
    chunks: merged.chunks,
    manifestSeq: doc.seq,
    checkpointId: ref.id,
    coveredFrom: chain[0].createdAt,
    coveredTo: chain[chain.length - 1].createdAt,
  }
}

/**
 * Delete objects the current chain no longer references. Chunk and attachment objects are
 * always referenced by the checkpoint, so in practice this removes superseded manifests.
 * @param {{dir: string, meta: any, key: Buffer}} store
 * @param {{dryRun?: boolean, yes?: boolean}} [options]
 */
export function collectGarbage(store, options = {}) {
  const { dryRun = true, yes = false } = options
  if (!dryRun && !yes) throw new Error('refusing to delete objects without --yes')

  const keep = referencedIds(store)
  const objectsDir = path.join(store.dir, 'objects')
  const files = fs.readdirSync(objectsDir)
  const removable = []
  let bytes = 0
  for (const name of files) {
    if (!name.endsWith('.bin')) continue
    const id = name.slice(0, -4)
    if (keep.has(id)) continue
    const file = path.join(objectsDir, name)
    const size = fs.statSync(file).size
    removable.push({ id, bytes: size })
    bytes += size
  }

  const report = { dryRun, kept: keep.size, present: files.length, removable: removable.length, bytes, deleted: 0 }
  if (dryRun) return report

  for (const item of removable) {
    fs.rmSync(path.join(objectsDir, item.id + '.bin'), { force: true })
    report.deleted += 1
  }
  return report
}
