/**
 * Export: verify the local vault and copy it to a pendrive, with a receipt.
 *
 * This is the sending half of the transport. It only READS the store: no snapshot, no repair, no
 * writes. That is deliberate — with DSH running, the plugin is the only writer, and a CLI write
 * competing with it is how a vault got corrupted in the field (see docs/LESSONS.md).
 *
 * The copy is verified *after* it is written, with the same passphrase, so the receipt can say
 * "this copy is readable", not just "this copy was copied".
 */
import fs from 'node:fs'
import path from 'node:path'

import { openStore } from './store.js'
import { sha256, toIso } from './util.js'
import { verifyStore } from './verify.js'

/** @param {string} root */
function measure(root) {
  let files = 0
  let bytes = 0
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
        continue
      }
      files += 1
      bytes += fs.statSync(full).size
    }
  }
  return { files, bytes }
}

/**
 * @param {{store: any, passphrase: string, to: string, now?: string, keyFile?: string|null,
 *          pluginVersion?: string|null, keepReplaced?: boolean}} options
 */
export function exportVault(options) {
  const { store, passphrase, to, now = toIso(), keyFile = null, pluginVersion = null, keepReplaced = true } = options
  if (!passphrase) throw new Error('export needs the passphrase to verify the copy')
  if (!to) throw new Error('export needs a destination directory')

  const verified = verifyStore(store)
  if (!verified.ok) {
    throw new Error(
      'the vault does not verify; nothing was copied (' + verified.problems.map((problem) => problem.code).join(', ') + ')',
    )
  }

  const stamp = now.replace(/[:.]/g, '-')
  const target = path.join(to, 'vault')
  let replaced = null
  if (fs.existsSync(target)) {
    if (keepReplaced) {
      replaced = target + '.replaced-' + stamp
      fs.renameSync(target, replaced)
    } else {
      fs.rmSync(target, { recursive: true, force: true })
    }
  }
  fs.mkdirSync(to, { recursive: true })
  fs.cpSync(store.dir, target, { recursive: true })

  // Verify what actually landed on the stick, not what was in the source.
  const copy = openStore(target, passphrase)
  const copyVerified = verifyStore(copy)
  const size = measure(target)

  const receipt = {
    kind: 'keeper-carry',
    receiptVersion: 2,
    createdAt: now,
    source: {
      store: path.resolve(store.dir),
      storeId: store.meta.storeId,
      deviceId: store.meta.deviceId,
      deviceName: store.meta.deviceName ?? null,
      format: store.meta.format ?? null,
      aead: store.meta.aead ?? null,
    },
    pluginVersion,
    totals: {
      sessions: verified.totals.sessions,
      archived: verified.totals.archived,
      frames: verified.totals.frames,
      bytes: verified.totals.bytes,
      attachments: verified.totals.attachments,
    },
    copy: { dir: target, files: size.files, bytes: size.bytes, replaced },
    verified: {
      ok: copyVerified.ok,
      sessions: copyVerified.totals.sessions,
      frames: copyVerified.totals.frames,
      bytes: copyVerified.totals.bytes,
      problems: copyVerified.problems.map((problem) => problem.code),
    },
  }

  if (keyFile && fs.existsSync(keyFile)) {
    // A fingerprint lets the other side confirm it holds the right phrase without carrying it.
    receipt.keyFingerprint = sha256(Buffer.from(fs.readFileSync(keyFile, 'utf8').trim(), 'utf8')).slice(0, 16)
  }

  const receiptPath = path.join(to, 'carry-' + stamp + '.json')
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', 'utf8')
  return { ...receipt, receiptPath, warning: copyVerified.ok ? null : 'the copy on the stick does not verify' }
}
