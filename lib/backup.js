/**
 * Backup: an exact, verified copy of a vault, taken while no writer can change it.
 *
 * It is the guard rail for a fusion: before a vault is touched there must be a copy that
 * (a) was taken with the store lock held, so the plugin cannot write in the middle,
 * (b) has a hash manifest, so its integrity can be proven later, and
 * (c) verifies as a keeper store. The original is never modified here.
 */
import fs from 'node:fs'
import path from 'node:path'

import { openStore, withStoreLock } from './store.js'
import { sha256, toIso } from './util.js'
import { verifyStore } from './verify.js'

/** @param {string} root @param {(file: string, rel: string) => void} visit */
function walkFiles(root, visit) {
  const queue = [root]
  while (queue.length > 0) {
    const current = queue.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(full)
        continue
      }
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (rel === 'LOCK') continue // ours, and it disappears when the lock is released
      visit(full, rel)
    }
  }
}

/**
 * @param {{dir: string, passphrase: string, to: string, now?: string, lockTimeoutMs?: number}} options
 */
export function backupVault(options) {
  const { dir, passphrase, to, now = toIso(), lockTimeoutMs = 30_000 } = options
  if (!passphrase) throw new Error('backupVault needs the passphrase to verify the copy')
  if (!to) throw new Error('backupVault needs a destination directory')
  if (path.resolve(to) === path.resolve(dir)) throw new Error('refusing to back up a vault onto itself')
  if (fs.existsSync(to) && fs.readdirSync(to).length > 0) throw new Error('destination exists and is not empty: ' + to)

  const hashes = {}
  let bytes = 0
  withStoreLock(dir, { timeout: lockTimeoutMs }, () => {
    fs.mkdirSync(path.dirname(path.resolve(to)), { recursive: true })
    fs.cpSync(dir, to, { recursive: true })
    walkFiles(to, (file, rel) => {
      const buffer = fs.readFileSync(file)
      hashes[rel] = sha256(buffer)
      bytes += buffer.length
    })
  })

  const copy = openStore(to, passphrase)
  const verified = verifyStore(copy)
  const manifest = {
    kind: 'keeper-backup',
    version: 1,
    createdAt: now,
    source: { dir: path.resolve(dir), storeId: copy.meta.storeId, deviceName: copy.meta.deviceName ?? null },
    copy: { dir: path.resolve(to), files: Object.keys(hashes).length, bytes },
    verified: {
      ok: verified.ok,
      sessions: verified.totals.sessions,
      archived: verified.totals.archived,
      frames: verified.totals.frames,
      bytes: verified.totals.bytes,
      attachments: verified.totals.attachments,
      problems: verified.problems.map((problem) => (problem.sessionId ? String(problem.sessionId).slice(0, 24) + ': ' : '') + problem.code),
    },
    filesSha256: sha256(JSON.stringify(hashes)),
    files: hashes,
  }
  const manifestPath = path.resolve(to) + '.manifest.json'
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')

  return {
    to: path.resolve(to),
    manifestPath,
    files: Object.keys(hashes).length,
    bytes,
    verified: manifest.verified,
    manifestSha256: manifest.filesSha256,
  }
}

/**
 * Prove that a backup is still the copy the manifest describes.
 * @param {string} dir
 * @param {string} manifestPath
 * @returns {{ok: boolean, missing: string[], changed: string[], files: number}}
 */
export function verifyBackup(dir, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const missing = []
  const changed = []
  let files = 0
  for (const [rel, expected] of Object.entries(manifest.files ?? {})) {
    const file = path.join(dir, rel.split('/').join(path.sep))
    if (!fs.existsSync(file)) {
      missing.push(rel)
      continue
    }
    files += 1
    if (sha256(fs.readFileSync(file)) !== expected) changed.push(rel)
  }
  return { ok: missing.length === 0 && changed.length === 0, missing, changed, files }
}
