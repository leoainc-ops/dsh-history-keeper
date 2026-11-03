/**
 * The carry loop: prepare a vault for a pendrive, and mount it on the other machine.
 *
 * Two operations, one per side:
 *  - `packVault`   (machine that sends): update the local vault, verify it, and copy it to the
 *                  stick together with a receipt. The passphrase never travels by default.
 *  - `landVault`   (machine that receives): verify the stick vault, merge it with the local one,
 *                  and make the result the local vault. The previous local vault is kept aside.
 *
 * The loop stays consistent only if both sides use the same passphrase for the carried vault, so
 * `landVault` seals the merged vault with the **stick's** passphrase and writes it to the local
 * key path the plugin will use. The stick vault's owner is preserved through the manifests.
 */
import fs from 'node:fs'
import path from 'node:path'

import { mergeStores } from './merge.js'
import { snapshot } from './snapshot.js'
import { listDeviceHeads, openStore } from './store.js'
import { sha256, toIso } from './util.js'
import { verifyStore } from './verify.js'

export const CARRY_RECEIPT = 'carry.json'

/**
 * Update the local vault, verify it and copy it to the stick.
 *
 * @param {{store: any, home: string, to: string, keyFile?: string|null, withKey?: string|null, now?: string, maxChunkBytes?: number}} options
 */
export function packVault(options) {
  const { store, home, to, keyFile = null, withKey = null, now = toIso(), maxChunkBytes, device = null } = options
  if (!to) throw new Error('packVault needs a destination directory on the stick')

  const captured = snapshot(store, { home, minIntervalMs: 0, maxChunkBytes, device })
  const verified = verifyStore(store)

  const vaultDir = path.join(to, 'vault')
  const previous = fs.existsSync(vaultDir)
  if (previous) fs.rmSync(vaultDir, { recursive: true, force: true })
  fs.mkdirSync(to, { recursive: true })
  fs.cpSync(store.dir, vaultDir, { recursive: true })

  const receipt = {
    kind: 'keeper-carry',
    version: 1,
    createdAt: now,
    source: { store: store.dir, storeId: store.meta.storeId, deviceId: store.meta.deviceId, deviceName: store.meta.deviceName },
    captured: { sessions: captured.sessions.length, chunks: captured.chunks, bytes: captured.bytes, manifest: captured.manifestSeq ?? null },
    verified: {
      ok: verified.ok,
      sessions: verified.totals.sessions,
      archived: verified.totals.archived,
      frames: verified.totals.frames,
      bytes: verified.totals.bytes,
      attachments: verified.totals.attachments,
    },
    vault: { dir: vaultDir, metaSha256: sha256(fs.readFileSync(path.join(vaultDir, 'meta.json'))) },
    keyCarried: false,
  }

  if (withKey) {
    // Explicit, never the default: the stick then holds the secret and the vault together.
    const keyDir = path.join(to, 'key')
    fs.mkdirSync(keyDir, { recursive: true })
    fs.copyFileSync(withKey, path.join(keyDir, path.basename(withKey)))
    receipt.keyCarried = true
    receipt.keyFile = path.join(keyDir, path.basename(withKey))
  } else if (keyFile) {
    // A fingerprint lets the other side confirm it has the right phrase without carrying it.
    const text = fs.readFileSync(keyFile, 'utf8').trim()
    receipt.keyFingerprint = sha256(Buffer.from(text, 'utf8')).slice(0, 16)
  }

  fs.writeFileSync(path.join(to, CARRY_RECEIPT), JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  return { ...receipt, previousReplaced: previous }
}

/**
 * Mount the stick vault into this machine: verify it, merge it with the local vault, and make the
 * result the local vault.
 *
 * @param {{from: string, localStore: any, localPassphrase: string, stickStore: any, stickPassphrase: string,
 *          keyOut: string, now?: string, keepReplaced?: boolean, maxChunkBytes?: number, onDivergence?: 'owner'|'error'}} options
 */
export function landVault(options) {
  const {
    from,
    localStore,
    stickStore,
    stickPassphrase,
    keyOut,
    now = toIso(),
    keepReplaced = true,
    maxChunkBytes,
    onDivergence = 'owner',
  } = options
  if (!keyOut) throw new Error('landVault needs keyOut: the path this machine will use as its passphrase file')

  const stickVerified = verifyStore(stickStore)
  if (!stickVerified.ok) {
    const codes = [...new Set(stickVerified.problems.map((problem) => problem.code))].join(', ')
    throw new Error('the vault on the stick does not verify (' + codes + '); nothing was mounted')
  }

  const stamp = now.replace(/[:.]/g, '-')
  const mergedDir = localStore.dir + '.merged-' + stamp
  const report = mergeStores([localStore, stickStore], {
    outDir: mergedDir,
    passphrase: stickPassphrase,
    deviceName: localStore.meta.deviceName ?? 'merged',
    now,
    maxChunkBytes,
    onDivergence,
  })

  const merged = openStore(mergedDir, stickPassphrase)
  const mergedVerified = verifyStore(merged)
  if (!mergedVerified.ok) {
    fs.rmSync(mergedDir, { recursive: true, force: true })
    throw new Error('the merged vault did not verify; the local vault was left untouched')
  }

  // Swap: the previous local vault is kept aside, never deleted.
  const replacedDir = localStore.dir + '.replaced-' + stamp
  fs.renameSync(localStore.dir, replacedDir)
  fs.renameSync(mergedDir, localStore.dir)

  // The plugin reads this file: it must hold the phrase of the vault now in place.
  fs.mkdirSync(path.dirname(keyOut), { recursive: true })
  fs.writeFileSync(keyOut, stickPassphrase + '\n', { encoding: 'utf8', mode: 0o600 })

  return {
    kind: 'keeper-land',
    version: 1,
    createdAt: now,
    from,
    localStore: localStore.dir,
    replaced: keepReplaced ? replacedDir : null,
    keyOut,
    stick: { storeId: stickStore.meta.storeId, deviceName: stickStore.meta.deviceName, verified: stickVerified.totals },
    merged: report.verification,
    sessions: report.sessions.length,
    archived: report.archived.length,
    dedupedBytes: report.stats.dedupedBytes,
    heads: listDeviceHeads(localStore.dir).length,
  }
}
