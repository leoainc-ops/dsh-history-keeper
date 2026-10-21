/**
 * Test helpers. All session data here is SYNTHETIC: frames are generated on the fly and
 * never contain real conversations (see scripts/guard-no-sessions.mjs).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

import { projectKey } from '../lib/session-log.js'

/** @param {object} value @returns {Buffer} one checksummed Zstandard frame */
export function frameOf(value) {
  return zlib.zstdCompressSync(Buffer.from(JSON.stringify(value) + '\n', 'utf8'))
}

/**
 * Build a synthetic DSH session log: header frame + one frame per batch.
 * @param {{id: string, cwd?: string, version?: number, batches?: Array<Array<object>>}} spec
 * @returns {Buffer}
 */
export function makeLog(spec) {
  const { id, cwd = 'C:\\work\\demo', version = 4, batches = [[{ type: 'turn/start', seq: 1 }]] } = spec
  const frames = [frameOf({ type: 'session', version, id, cwd, createdAt: 1, isSeeded: false })]
  let seq = 1
  for (const batch of batches) {
    const rows = batch.map((row) => ({ seq: seq++, ...row }))
    frames.push(frameOf(rows.length === 1 ? rows[0] : { type: 'batch', rows }))
  }
  return Buffer.concat(frames)
}

/**
 * Write a session log into a DSH-home layout.
 * @param {string} home
 * @param {{id: string, log: Buffer, cwd?: string, dirName?: string}} spec
 * @returns {string} file path
 */
export function writeSession(home, spec) {
  const cwd = spec.cwd ?? 'C:\\work\\demo'
  const dir = path.join(home, 'sessions', projectKey(cwd), spec.dirName ?? spec.id)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'session.v4.jsonl.zstd')
  fs.writeFileSync(file, spec.log)
  return file
}

/** @param {string} prefix @returns {string} a fresh temp directory */
export function tempDir(prefix = 'keeper-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** @param {string} dir */
export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** All files under a directory, relative, sorted. @param {string} dir */
export function listFiles(dir) {
  const out = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(path.relative(dir, full).replaceAll('\\', '/'))
    }
  }
  if (fs.existsSync(dir)) walk(dir)
  return out.sort()
}
