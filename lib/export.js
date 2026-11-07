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
import { collectSessions, verifyStore } from './verify.js'

/**
 * Decide whether the destination has room for the copy, with a margin for the filesystem.
 * Pure on purpose: the caller reads the free space, the test does not need a full disk.
 * @param {{freeBytes: number, needBytes: number, margin?: number}} input
 * @returns {{ok: boolean, needBytes: number, freeBytes: number}}
 */
export function checkSpace(input) {
  const margin = input.margin ?? 1.05
  const needBytes = Math.ceil(input.needBytes * margin)
  return { ok: input.freeBytes >= needBytes, needBytes, freeBytes: input.freeBytes }
}

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

/** Session id → bytes of the visible lineage, for both sides of a transport. */
function sessionBytes(store) {
  const { sessions } = collectSessions(store)
  const map = new Map()
  for (const session of sessions.values()) map.set(session.sessionId, session.bytes)
  return map
}

/**
 * What is already at the destination, and does it hold anything this vault does not?
 *
 * A destination that cannot be opened with this passphrase is unknown, not empty: overwriting it
 * could destroy another vault. A destination that opens but has sessions the local vault lacks —
 * or the same session longer — holds work that has not been imported yet.
 *
 * @param {{target: string, passphrase: string, localStore: any}} options
 * @returns {{exists: boolean, opens: boolean, reason?: string, storeId?: string, externalNewer: Array<any>}}
 */
export function compareDestination(options) {
  const { target, passphrase, localStore } = options
  if (!fs.existsSync(path.join(target, 'meta.json'))) return { exists: false, opens: false, externalNewer: [] }

  let external
  try {
    external = openStore(target, passphrase)
    verifyStore(external)
  } catch (error) {
    return { exists: true, opens: false, reason: error && error.message ? error.message : String(error), externalNewer: [] }
  }

  const mine = sessionBytes(localStore)
  const theirs = sessionBytes(external)
  const externalNewer = []
  for (const [sessionId, bytes] of theirs) {
    const localBytes = mine.get(sessionId)
    if (localBytes === undefined) externalNewer.push({ sessionId, bytes, reason: 'only in the destination' })
    else if (bytes > localBytes) externalNewer.push({ sessionId, bytes, localBytes, reason: 'longer in the destination' })
  }
  return { exists: true, opens: true, storeId: external.meta.storeId, externalNewer }
}

/**
 * @param {{store: any, passphrase: string, to: string, now?: string, keyFile?: string|null,
 *          pluginVersion?: string|null, keepReplaced?: boolean, replace?: boolean}} options
 */
export function exportVault(options) {
  const {
    store,
    passphrase,
    to,
    now = toIso(),
    keyFile = null,
    pluginVersion = null,
    keepReplaced = false,
    replace = false,
  } = options
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
  const sourceBytes = measure(store.dir).bytes
  try {
    const stat = fs.statfsSync(to)
    const space = checkSpace({ freeBytes: stat.bavail * stat.bsize, needBytes: sourceBytes })
    if (!space.ok) {
      throw new Error('not enough space on ' + to + ': need ' + space.needBytes + ' bytes, ' + space.freeBytes + ' free')
    }
  } catch (error) {
    if (error.code === 'ENOSYS' || error.code === 'ERR_METHOD_NOT_IMPLEMENTED') {
      // statfs is not available everywhere; the copy still verifies afterwards.
    } else if (error.message.startsWith('not enough space')) {
      throw error
    }
  }
  let replaced = null
  if (fs.existsSync(target)) {
    // A destination that holds work this vault does not have must not be overwritten silently.
    const destination = compareDestination({ target, passphrase, localStore: store })
    if (!replace) {
      if (!destination.opens) {
        throw new Error(
          'the destination vault cannot be opened with this passphrase (' +
            destination.reason +
            '); use --replace only if you are sure it can be discarded',
        )
      }
      if (destination.externalNewer.length > 0) {
        const sample = destination.externalNewer
          .slice(0, 3)
          .map((item) => item.sessionId.slice(0, 20) + '… (' + item.reason + ')')
          .join(', ')
        throw new Error(
          'the destination vault has ' +
            destination.externalNewer.length +
            ' session(s) this vault does not have: ' +
            sample +
            '; import them first, or use --replace',
        )
      }
    }
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
