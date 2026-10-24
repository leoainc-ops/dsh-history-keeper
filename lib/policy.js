/**
 * Compaction policy.
 *
 * Deterministic on purpose: the decision must be explainable from the numbers that produced
 * it ("compact: 63 manifests since the last checkpoint, 1,204 chunks, cap 50,000"), not
 * inferred. A local model may *propose* parameters one day (PLAN 9.4), but it never decides:
 * this function is the authority, and every limit it applies is a hard bound.
 *
 * The inputs are the store's own shape, not wall-clock intuition: how many manifests the chain
 * holds, how many chunks a checkpoint would carry, how big the store is, and how much disk is
 * left. Nothing about the conversation content is read here.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const POLICY_DEFAULTS = Object.freeze({
  /** Manifests since the last checkpoint before compaction is even considered. */
  minManifests: 50,
  /** A checkpoint larger than this is refused: reading it would cost more than the chain. */
  maxChunks: 50_000,
  /** Never compact with less than this much free space relative to the store size. */
  freeSpaceFactor: 1.5,
})

/**
 * Signals the policy reads. Exported so a future model can be fed the same numbers.
 * @param {{dir: string, meta: any}} store
 * @param {Array<any>} chain
 * @returns {object}
 */
export function collectSignals(store, chain) {
  let chunks = 0
  let bytes = 0
  for (const doc of chain) {
    for (const entry of Object.values(doc.sessions ?? {})) {
      for (const chunk of entry.chunks ?? []) {
        chunks += 1
        bytes += chunk.byteTo - chunk.byteFrom
      }
    }
  }
  const sinceCheckpoint = chain[0]?.kind === 'checkpoint' ? chain.length - 1 : chain.length

  let storeBytes = 0
  let freeDiskBytes = null
  try {
    const objectsDir = path.join(store.dir, 'objects')
    for (const name of fs.readdirSync(objectsDir)) {
      storeBytes += fs.statSync(path.join(objectsDir, name)).size
    }
  } catch {
    /* a store being inspected while it changes is fine: the number is advisory */
  }
  try {
    const stats = fs.statfsSync ? fs.statfsSync(store.dir) : null
    if (stats) freeDiskBytes = stats.bavail * stats.bsize
  } catch {
    freeDiskBytes = null
  }

  return {
    manifests: chain.length,
    sinceCheckpoint,
    chunks,
    publishedBytes: bytes,
    storeBytes,
    freeDiskBytes,
    platform: os.platform(),
  }
}

/**
 * Decide whether to compact.
 * @param {{store: {dir: string, meta: any}, chain: Array<any>, options?: object}} input
 * @returns {{compact: boolean, reason: string, signals: object, limits: object}}
 */
export function evaluatePolicy(input) {
  const { store, chain, options = {} } = input
  const limits = { ...POLICY_DEFAULTS, ...options }
  const signals = collectSignals(store, chain)

  if (chain.length <= 1 && chain[0]?.kind === 'checkpoint') {
    return { compact: false, reason: 'already a checkpoint', signals, limits }
  }
  if (signals.manifests === 0) {
    return { compact: false, reason: 'nothing published yet', signals, limits }
  }
  if (signals.sinceCheckpoint < limits.minManifests) {
    return {
      compact: false,
      reason: 'only ' + signals.sinceCheckpoint + ' manifest(s) since the last checkpoint (minimum ' + limits.minManifests + ')',
      signals,
      limits,
    }
  }
  if (signals.chunks > limits.maxChunks) {
    return {
      compact: false,
      reason: 'a checkpoint would carry ' + signals.chunks + ' chunks (cap ' + limits.maxChunks + '); refusing to build one that cannot be read quickly',
      signals,
      limits,
    }
  }
  if (signals.freeDiskBytes !== null && signals.freeDiskBytes < signals.storeBytes * limits.freeSpaceFactor) {
    return {
      compact: false,
      reason: 'free space ' + signals.freeDiskBytes + ' is below ' + limits.freeSpaceFactor + 'x the store size (' + signals.storeBytes + ')',
      signals,
      limits,
    }
  }

  return {
    compact: true,
    reason: 'compact: ' + signals.sinceCheckpoint + ' manifest(s) since the last checkpoint, ' + signals.chunks + ' chunk(s) fit the cap of ' + limits.maxChunks,
    signals,
    limits,
  }
}
