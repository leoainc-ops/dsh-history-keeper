/**
 * Reading the DSH session store: locating logs, parsing the header frame and
 * computing the project directory name the host uses.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

import { scanLog } from './frames.js'

const LOG_PATTERN = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/

/**
 * Reproduces the host's readable project-directory key: separators (`/`, `\`, `:`)
 * collapse into a single `-`, other unsafe code units become `~XXXX`, and the whole
 * key is wrapped in `--…--`. Truncation and separator lossiness are intentional and
 * match the host, so restored logs land exactly where DSH looks for them.
 * @param {string} cwd
 * @returns {string}
 */
export function projectKey(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) throw new TypeError('cwd must be a non-empty string')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const char = String.fromCharCode(code)
    if (char === '/' || char === '\\' || char === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (char !== '~' && /^[A-Za-z0-9._-]$/.test(char)) {
      readable += char
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return '--' + ((readable.replace(/^-+/, '') || 'root').slice(0, 251)) + '--'
}

/**
 * Decompress the first frame of a log (the session header) without touching the rest.
 * @param {Buffer} buffer
 * @returns {{header: any, version: number|null, firstFrameBytes: number}}
 */
export function readLogHeader(buffer) {
  const scan = scanLog(buffer)
  if (scan.frameEnds.length === 0) throw new Error('log has no complete frame')
  const firstFrame = buffer.subarray(0, scan.frameEnds[0])
  const text = zlib.zstdDecompressSync(firstFrame).toString('utf8')
  const line = text.split('\n').find((entry) => entry.trim().length > 0)
  if (!line) throw new Error('header frame is empty')
  const header = JSON.parse(line)
  return { header, version: typeof header.version === 'number' ? header.version : null, firstFrameBytes: scan.frameEnds[0] }
}

/**
 * Find every session log under a DSH home, choosing the highest generation per session.
 * @param {string} sessionsRoot
 * @returns {Array<{file: string, project: string, dirName: string, logName: string, version: number|null}>}
 */
export function findSessionLogs(sessionsRoot) {
  if (!fs.existsSync(sessionsRoot)) return []
  const found = []
  for (const project of fs.readdirSync(sessionsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(sessionsRoot, project.name)
    for (const session of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const sessionDir = path.join(projectDir, session.name)
      const candidates = []
      for (const file of fs.readdirSync(sessionDir, { withFileTypes: true })) {
        if (!file.isFile()) continue
        const match = LOG_PATTERN.exec(file.name)
        if (!match) continue
        candidates.push({ name: file.name, version: match[1] ? Number(match[1]) : 0 })
      }
      if (candidates.length === 0) continue
      candidates.sort((a, b) => b.version - a.version)
      const chosen = candidates[0]
      found.push({
        file: path.join(sessionDir, chosen.name),
        project: project.name,
        dirName: session.name,
        logName: chosen.name,
        version: chosen.version,
      })
    }
  }
  return found
}

/**
 * Where a restored log must be written: the host's own layout.
 * @param {string} home
 * @param {{cwd: string, sessionId: string}} session
 * @param {number} version
 * @returns {string}
 */
export function resolveRestorePath(home, session, version) {
  const projectDir = session.cwd ? projectKey(session.cwd) : '_no-cwd'
  return path.join(home, 'sessions', projectDir, session.sessionId, 'session.v' + version + '.jsonl.zstd')
}
