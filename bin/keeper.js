#!/usr/bin/env node
/**
 * keeper — CLI for dsh-history-keeper.
 *
 * Works without DSH running: that is the point. When a machine is gone, the plugin is
 * not available, so the recovery path must be plain Node and nothing else.
 *
 * Passphrase: read from the environment variable named by --passphrase-env
 * (default KEEPER_PASSPHRASE). Never from argv, never stored.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { generatePassphraseFile, readPassphraseFile } from '../lib/config.js'
import { initStore, openStore, readManifestChain } from '../lib/store.js'
import { publishedState, snapshot } from '../lib/snapshot.js'
import { verifyStore } from '../lib/verify.js'
import { restore } from '../lib/restore.js'
import { formatTime, humanBytes, toIso } from '../lib/util.js'

const USAGE = `keeper — encrypted, verifiable history keeper for DeepSeek Harness

usage: keeper <command> --store <dir> [options]

commands
  init       create a new store (generates a key file when no passphrase is set)
  snapshot   capture new session bytes into the store
  verify     check every object, hash and chain
  status     what the store holds and what is unpublished
  restore    rebuild a DSH home from the store

common options
  --store <dir>            store directory (required)
  --home <dir>             DSH home (default: $DSH_HOME or ~/.dsh)
  --passphrase-env <name>  env var holding the passphrase (default KEEPER_PASSPHRASE)
  --json                   machine-readable output

init options
  --device-name <name>     label stored with this device (default: hostname)

snapshot options
  --session <id>           limit to one session (repeatable)
  --max-chunk-bytes <n>    target chunk size (default 1048576)

restore options
  --dry-run                show the plan, write nothing
  --force                  keep the existing log and write the incoming copy aside
`

function parse(argv) {
  const options = { _: [], session: [] }
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      options._.push(token)
      continue
    }
    const key = token.slice(2)
    if (key === 'json' || key === 'dry-run' || key === 'force') {
      options[key] = true
      continue
    }
    const value = argv[++i]
    if (value === undefined) fail('missing value for --' + key)
    if (key === 'session') options.session.push(value)
    else options[key] = value
  }
  return options
}

function fail(message, code = 2) {
  console.error('keeper: ' + message)
  process.exit(code)
}

function defaultHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
}

/** Where `init` writes a generated passphrase when the operator has not set one. */
function defaultKeyFile() {
  return path.join(os.homedir(), '.dsh', 'history-keeper.key')
}

/**
 * Resolve the passphrase: environment variable first (an explicit choice), then a key
 * file, and on `init` a freshly generated key written to the key file.
 * @param {any} options
 * @param {{allowGenerate?: boolean}} [behaviour]
 * @returns {{passphrase: string, source: string, generated: string|null}}
 */
function passphraseFrom(options, behaviour = {}) {
  const name = options['passphrase-env'] ?? 'KEEPER_PASSPHRASE'
  const fromEnv = process.env[name]
  if (fromEnv && fromEnv.length >= 8) return { passphrase: fromEnv, source: 'env ' + name, generated: null }
  if (fromEnv) fail('the passphrase in $' + name + ' is shorter than 8 characters')

  const keyFile = path.resolve(options['key-file'] ?? defaultKeyFile())
  const file = readPassphraseFile(keyFile)
  if (file.passphrase) return { passphrase: file.passphrase, source: 'key file ' + keyFile, generated: null }
  if (file.reason && !/cannot read/u.test(file.reason)) fail(file.reason + ': ' + keyFile)

  if (behaviour.allowGenerate) {
    const generated = generatePassphraseFile(keyFile)
    return { passphrase: generated.passphrase, source: 'generated key file ' + keyFile, generated: keyFile }
  }

  fail('passphrase not set: export ' + name + '=<passphrase>, or pass --key-file <path>, or run: keeper init')
}

function openFrom(options) {
  const store = options.store
  if (!store) fail('--store <dir> is required')
  if (!fs.existsSync(path.join(store, 'meta.json'))) fail('no keeper store at ' + store)
  return openStore(path.resolve(store), passphraseFrom(options).passphrase)
}

function print(result, options, text) {
  if (options.json) console.log(JSON.stringify(result, null, 2))
  else if (text) console.log(text)
}

function main() {
  const options = parse(process.argv.slice(2))
  const command = options._[0] ?? 'status'
  const home = path.resolve(options.home ?? defaultHome())

  if (command === 'init') {
    const store = options.store ?? path.join(os.homedir(), '.dsh', 'history-keeper')
    const pass = passphraseFrom(options, { allowGenerate: true })
    const created = initStore(path.resolve(store), {
      passphrase: pass.passphrase,
      deviceName: options['device-name'] ?? os.hostname(),
    })
    const result = {
      ok: true,
      store: created.dir,
      storeId: created.meta.storeId,
      deviceId: created.meta.deviceId,
      deviceName: created.meta.deviceName,
      kdf: created.meta.kdf.alg,
      aead: created.meta.aead,
      passphraseSource: pass.source,
      generatedKeyFile: pass.generated,
    }
    const lines = [
      'store created at ' + created.dir,
      '  device: ' + created.meta.deviceName + ' (' + created.meta.deviceId + ')',
      '  cipher: ' + created.meta.aead,
      '  passphrase source: ' + pass.source,
    ]
    if (pass.generated) {
      lines.push(
        '',
        'A passphrase was generated and written to:',
        '  ' + pass.generated,
        '',
        'It is not printed on purpose: terminal output ends up in logs and transcripts.',
        'Copy that file into a password manager and keep it away from the vault itself.',
        'Without it the vault cannot be opened — there is no recovery path.',
      )
    }
    print(result, options, lines.join('\n'))
    return
  }

  if (command === 'snapshot') {
    const store = openFrom(options)
    const result = snapshot(store, {
      home,
      maxChunkBytes: options['max-chunk-bytes'] ? Number(options['max-chunk-bytes']) : undefined,
      sessionIds: options.session.length > 0 ? options.session : null,
    })
    const lines = []
    lines.push('snapshot ' + formatTime(result.createdAt))
    lines.push('  sessions captured: ' + result.sessions.length + '  chunks: ' + result.chunks + '  bytes: ' + humanBytes(result.bytes))
    for (const item of result.sessions) {
      lines.push('  + ' + item.sessionId + '  ' + item.chunks + ' chunk(s)  ' + humanBytes(item.bytes) + (item.tornTail ? '  (torn tail skipped)' : ''))
    }
    for (const item of result.skipped) lines.push('  = ' + item.sessionId + '  ' + item.code.toLowerCase().replaceAll('_', ' '))
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? item.file) + '  ' + item.code + ': ' + item.message)
    if (result.manifestSeq !== null) lines.push('  manifest: ' + result.manifestSeq)
    print(result, options, lines.join('\n'))
    if (result.problems.length > 0) process.exit(1)
    return
  }

  if (command === 'verify') {
    const store = openFrom(options)
    const result = verifyStore(store)
    const lines = ['verify: ' + (result.ok ? 'ok' : 'PROBLEMS') + '  sessions: ' + result.totals.sessions + '  frames: ' + result.totals.frames + '  bytes: ' + humanBytes(result.totals.bytes)]
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? '?') + '  ' + item.code + ': ' + item.message)
    print(result, options, lines.join('\n'))
    if (!result.ok) process.exit(1)
    return
  }

  if (command === 'status') {
    const store = openFrom(options)
    const chain = readManifestChain(store)
    const published = publishedState(chain)
    const publishSummary = [...published.values()].reduce((acc, entry) => {
      acc.sessions += 1
      acc.bytes += entry.bytes
      acc.frames += entry.frames
      return acc
    }, { sessions: 0, bytes: 0, frames: 0 })
    const result = {
      ok: true,
      store: store.dir,
      storeId: store.meta.storeId,
      device: { id: store.meta.deviceId, name: store.meta.deviceName },
      snapshots: chain.length,
      lastManifestAt: chain.length > 0 ? chain[chain.length - 1].createdAt : null,
      published: publishSummary,
      checkedAt: toIso(),
    }
    const lines = [
      'store    ' + store.dir,
      'device   ' + store.meta.deviceName + ' (' + store.meta.deviceId + ')',
      'snapshots ' + chain.length + (result.lastManifestAt ? '  last ' + formatTime(result.lastManifestAt) : ''),
      'published ' + publishSummary.sessions + ' session(s)  ' + publishSummary.frames + ' frame(s)  ' + humanBytes(publishSummary.bytes),
    ]
    print(result, options, lines.join('\n'))
    return
  }

  if (command === 'restore') {
    const store = openFrom(options)
    const result = restore(store, { home, dryRun: Boolean(options['dry-run']), force: Boolean(options.force) })
    const lines = ['restore into ' + result.home + (result.dryRun ? '  (dry run)' : '')]
    for (const item of result.created) lines.push('  + ' + item.sessionId + '  ' + humanBytes(item.bytes) + '  ' + item.target)
    for (const item of result.identical) lines.push('  = ' + item.sessionId + '  already present and identical')
    for (const item of result.setAside) lines.push('  ~ ' + item.sessionId + '  ' + item.message)
    for (const item of result.refused) lines.push('  ! ' + item.sessionId + '  ' + item.message + '  (' + item.target + ')')
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? '?') + '  ' + item.code + ': ' + item.message)
    const touched = result.created.length + result.identical.length + result.setAside.length + result.refused.length
    lines.push('  sessions considered: ' + touched)
    print(result, options, lines.join('\n'))
    if (result.refused.length > 0 || result.problems.length > 0) process.exit(1)
    return
  }

  if (command === 'help' || command === '--help') {
    console.log(USAGE)
    return
  }

  fail('unknown command: ' + command + '\n\n' + USAGE)
}

try {
  main()
} catch (error) {
  console.error('keeper: ' + (error && error.message ? error.message : String(error)))
  process.exit(1)
}
