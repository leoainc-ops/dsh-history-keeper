#!/usr/bin/env node
/**
 * Development aid: compare two vaults before writing the reconciliation.
 *
 * It answers, for two stores that grew independently: which sessions are in both, whether their
 * content is byte-identical, one a prefix of the other, or genuinely diverged — and what a
 * union would show. It is a *report*, not a merge: it never writes to either store.
 *
 * Usage:
 *   node scripts/reconcile-report.mjs --a <storeA> --a-key <fileA> --b <storeB> --b-key <fileB>
 *                                     [--json]
 *
 * The keys are paths to single-line passphrase files. If omitted, `KEEPER_KEY_A` /
 * `KEEPER_KEY_B` are used, so the passphrases never end up in the shell history.
 */
import fs from 'node:fs'
import process from 'node:process'

import { publishedAttachments } from '../lib/snapshot.js'
import { listDeviceHeads, openStore, readAllManifests } from '../lib/store.js'
import { collectSessions } from '../lib/verify.js'
import { humanBytes } from '../lib/util.js'

function parse(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    if (key === 'json') {
      options.json = true
      continue
    }
    options[key] = argv[++index]
  }
  return options
}

function passphrase(options, side) {
  const fileFlag = options[side + '-key']
  const fromEnv = process.env['KEEPER_KEY_' + side.toUpperCase()]
  if (!fileFlag && !fromEnv) throw new Error('missing --' + side + '-key <file> (or KEEPER_KEY_' + side.toUpperCase() + ')')
  const value = fromEnv ?? fs.readFileSync(fileFlag, 'utf8').split(/\r?\n/u)[0].trim()
  if (value.length < 8) throw new Error('the passphrase for ' + side + ' is shorter than 8 characters')
  return value
}

/** @param {string} dir @param {string} pass */
function survey(dir, pass) {
  const store = openStore(dir, pass)
  const heads = listDeviceHeads(dir)
  const chain = readAllManifests(store, { fresh: true })
  const { sessions, problems } = collectSessions(store)
  const attachments = publishedAttachments(chain)

  let frames = 0
  let bytes = 0
  const perSession = new Map()
  for (const session of sessions.values()) {
    frames += session.frames
    bytes += session.bytes
    perSession.set(session.sessionId, {
      sessionId: session.sessionId,
      frames: session.frames,
      bytes: session.bytes,
      buffer: session.buffer,
      cwd: session.header?.cwd ?? null,
    })
  }

  return {
    dir,
    storeId: store.meta.storeId ?? null,
    aead: store.meta.aead ?? null,
    devices: heads.map((head) => ({ deviceId: head.deviceId, deviceName: head.deviceName ?? null, seq: head.seq ?? null })),
    manifests: chain.length,
    sessions: perSession,
    frames,
    bytes,
    attachments: new Map([...attachments].map(([hash, entry]) => [hash, entry.bytes ?? null])),
    problems,
  }
}

/** @param {Buffer} a @param {Buffer} b */
function relation(a, b) {
  if (a.equals(b)) return { kind: 'identical', common: a.length }
  const short = a.length <= b.length ? a : b
  const long = a.length <= b.length ? b : a
  const prefix = long.subarray(0, short.length).equals(short)
  if (prefix) return { kind: short === a ? 'a-prefix' : 'b-prefix', common: short.length }
  let common = 0
  const limit = Math.min(a.length, b.length)
  while (common < limit && a[common] === b[common]) common += 1
  return { kind: 'diverged', common }
}

function main() {
  const options = parse(process.argv.slice(2))
  const a = survey(options.a, passphrase(options, 'a'))
  const b = survey(options.b, passphrase(options, 'b'))

  const both = [...a.sessions.keys()].filter((id) => b.sessions.has(id))
  const onlyA = [...a.sessions.keys()].filter((id) => !b.sessions.has(id))
  const onlyB = [...b.sessions.keys()].filter((id) => !a.sessions.has(id))

  const shared = both.map((id) => {
    const left = a.sessions.get(id)
    const right = b.sessions.get(id)
    const rel = relation(left.buffer, right.buffer)
    return {
      sessionId: id,
      a: { frames: left.frames, bytes: left.bytes },
      b: { frames: right.frames, bytes: right.bytes },
      relation: rel.kind,
      commonBytes: rel.common,
      cwd: left.cwd ?? right.cwd,
    }
  })

  const attachmentBoth = [...a.attachments.keys()].filter((hash) => b.attachments.has(hash))
  const duplicatedBytes = shared
    .filter((item) => item.relation === 'identical')
    .reduce((sum, item) => sum + item.a.bytes, 0)

  const report = {
    a: {
      dir: a.dir,
      storeId: a.storeId,
      aead: a.aead,
      devices: a.devices,
      manifests: a.manifests,
      sessions: a.sessions.size,
      frames: a.frames,
      bytes: a.bytes,
      attachments: a.attachments.size,
      problems: a.problems,
    },
    b: {
      dir: b.dir,
      storeId: b.storeId,
      aead: b.aead,
      devices: b.devices,
      manifests: b.manifests,
      sessions: b.sessions.size,
      frames: b.frames,
      bytes: b.bytes,
      attachments: b.attachments.size,
      problems: b.problems,
    },
    shared,
    onlyA: onlyA.map((id) => ({ sessionId: id, bytes: a.sessions.get(id).bytes, cwd: a.sessions.get(id).cwd })),
    onlyB: onlyB.map((id) => ({ sessionId: id, bytes: b.sessions.get(id).bytes, cwd: b.sessions.get(id).cwd })),
    attachments: { both: attachmentBoth, onlyA: [...a.attachments.keys()].filter((h) => !b.attachments.has(h)), onlyB: [...b.attachments.keys()].filter((h) => !a.attachments.has(h)) },
    union: {
      sessions: new Set([...a.sessions.keys(), ...b.sessions.keys()]).size,
      needsDecision: shared.filter((item) => item.relation === 'diverged').length,
      dedupableBytes: duplicatedBytes,
    },
  }

  if (options.json) {
    const serialisable = { ...report, a: { ...report.a }, b: { ...report.b } }
    console.log(JSON.stringify(serialisable, null, 2))
    return
  }

  const lines = []
  const short = (id) => id.slice(0, 20) + '…'
  for (const [label, side] of [['A', a], ['B', b]]) {
    lines.push('=== bóveda ' + label + ' ===')
    lines.push('  ruta       ' + side.dir)
    lines.push('  storeId    ' + (side.storeId ?? '?'))
    lines.push('  cifrado    ' + (side.aead ?? '?'))
    lines.push('  cabezas    ' + (side.devices.length === 0 ? 'legado (sin cabezas por dispositivo)' : side.devices.map((d) => (d.deviceName ?? '?') + ' (' + d.deviceId.slice(0, 8) + '…)').join(', ')))
    lines.push('  manifiestos ' + side.manifests + '   sesiones ' + side.sessions.size + '   frames ' + side.frames + '   ' + humanBytes(side.bytes))
    lines.push('  adjuntos   ' + side.attachments.size)
    if (side.problems.length > 0) lines.push('  problemas  ' + side.problems.length + ': ' + side.problems.map((p) => p.code).join(', '))
  }

  lines.push('')
  lines.push('=== sesiones presentes en las dos ===')
  if (shared.length === 0) lines.push('  ninguna')
  for (const item of shared) {
    const verdict =
      item.relation === 'identical'
        ? 'idénticas → una sola conversación'
        : item.relation === 'a-prefix'
          ? 'A es prefijo de B → gana B, sin conflicto'
          : item.relation === 'b-prefix'
            ? 'B es prefijo de A → gana A, sin conflicto'
            : 'DIVERGEN en el byte ' + item.commonBytes + ' → colas de ' + (item.a.bytes - item.commonBytes) + 'B y ' + (item.b.bytes - item.commonBytes) + 'B'
    lines.push('  ' + short(item.sessionId) + '  A=' + item.a.bytes + 'B  B=' + item.b.bytes + 'B')
    lines.push('      ' + verdict)
    if (item.cwd) lines.push('      proyecto: ' + item.cwd)
  }

  lines.push('')
  lines.push('=== solo en A (' + report.onlyA.length + ') ===')
  for (const item of report.onlyA) lines.push('  ' + short(item.sessionId) + '  ' + humanBytes(item.bytes))
  lines.push('=== solo en B (' + report.onlyB.length + ') ===')
  for (const item of report.onlyB) lines.push('  ' + short(item.sessionId) + '  ' + humanBytes(item.bytes))

  lines.push('')
  lines.push('=== adjuntos ===')
  lines.push('  en las dos: ' + report.attachments.both.length + '   solo A: ' + report.attachments.onlyA.length + '   solo B: ' + report.attachments.onlyB.length)

  lines.push('')
  lines.push('=== proyección de la unión ===')
  lines.push('  conversaciones: ' + report.union.sessions + ' (A ' + a.sessions.size + ' + B ' + b.sessions.size + ' - repetidas ' + shared.length + ')')
  lines.push('  bytes duplicados que el dedupe evitaría: ' + humanBytes(report.union.dedupableBytes))
  lines.push('  sesiones con dos colas distintas (requieren decisión): ' + report.union.needsDecision)

  console.log(lines.join('\n'))
}

try {
  main()
} catch (error) {
  console.error('reconcile-report: ' + (error && error.message ? error.message : String(error)))
  process.exit(1)
}
