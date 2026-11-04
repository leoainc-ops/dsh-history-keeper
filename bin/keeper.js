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
import { initStore, listDeviceHeads, openStore, readAllManifests, readManifestChain } from '../lib/store.js'
import { collectGarbage, compact } from '../lib/compact.js'
import { inventory } from '../lib/inventory.js'
import { exportVault } from '../lib/export.js'
import { importVault } from '../lib/import.js'
import { resolvePaths } from '../lib/paths.js'
import { mergeStores } from '../lib/merge.js'
import { resolveDevice } from '../lib/device.js'
import { backfillAttachments, publishedAttachments, publishedState, snapshot } from '../lib/snapshot.js'
import { verifyStore } from '../lib/verify.js'
import { restore } from '../lib/restore.js'
import { formatTime, humanBytes, toIso } from '../lib/util.js'

const USAGE = `keeper — encrypted, verifiable history keeper for DeepSeek Harness

usage: keeper <command> --store <dir> [options]

commands
  init       create a new store (generates a key file when no passphrase is set)
  snapshot   capture new session bytes into the store
  attachments  capture blobs referenced by already-published sessions
  compact    replace the manifest chain with one checkpoint
  gc         delete objects the chain no longer references (needs --yes)
  merge      combine two vaults into a new one (sources untouched)
  inventory  sessions grouped by the device they came from
  paths      where every keeper file lives on this machine
  export     verify the vault and copy it to a pendrive, with a receipt
  import     verify a carried vault, merge it, and (with --swap) make it the local one
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
  --min-interval <ms>      coalesce flushes per session (default 0: publish everything now)
  --no-secret-scan         publish even if a credential is detected (quarantine is the default)
  --no-attachments         do not capture the blobs sessions reference
  --allow-rule <id>        disable one secret rule (repeatable)
  --force                  publish even inside the window, or past a quarantine

merge options
  --a <dir> --a-key <file>   first vault and its passphrase file
  --b <dir> --b-key <file>   second vault and its passphrase file
  --out <dir> --out-key <f>  new vault directory and its passphrase file

restore options
  --dry-run                show the plan, write nothing
  --no-preflight           write sessions this host cannot read (they will not open)
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
    // Accept both `--key value` and `--key=value`.
    let key = token.slice(2)
    let inline = null
    const eq = key.indexOf('=')
    if (eq >= 0) {
      inline = key.slice(eq + 1)
      key = key.slice(0, eq)
    }
    if (key === 'json' || key === 'dry-run' || key === 'force' || key === 'no-secret-scan' || key === 'no-attachments' || key === 'entropy' || key === 'yes' || key === 'no-preflight' || key === 'swap') {
      options[key] = true
      continue
    }
    const value = inline ?? argv[++i]
    if (value === undefined) fail('missing value for --' + key)
    if (key === 'session') options.session.push(value)
    else if (key === 'allow-rule') options['allow-rule'] = [...(options['allow-rule'] ?? []), value]
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

  // The key must be resolved for the SAME vault the command opens: otherwise a command given an
  // explicit --store would borrow this machine's key, open the wrong store and report a confusing
  // "wrong passphrase" instead of "passphrase not set".
  const keyFile = path.resolve(
    options['key-file'] ??
      resolvePaths({ home: options.home ?? defaultHome(), vault: options.store ?? null }).key,
  )
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
  // The canonical layout decides when no flag is given, so the CLI, the plugin and the operator
  // scripts resolve the same vault and key (lib/paths.js is the single source of truth).
  const layout = resolvePaths({
    home: options.home ?? defaultHome(),
    vault: options.store ?? null,
    key: options['key-file'] ?? null,
  })
  const store = options.store ?? layout.vault
  if (!fs.existsSync(path.join(store, 'meta.json'))) {
    fail('no keeper store at ' + store + ' (run: keeper init, or pass --store <dir>)')
  }
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
  const device = resolveDevice({ configDir: home, deviceName: options['device-name'] })

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
      captureAttachments: options['no-attachments'] !== true,
      minIntervalMs: options['min-interval'] ? Number(options['min-interval']) : 0,
      force: options.force === true,
      secretScan: options['no-secret-scan'] !== true,
      secretScanAllow: options['allow-rule'] ?? [],
      secretScanEntropy: options.entropy === true,
      device,
    })
    const lines = []
    lines.push('snapshot ' + formatTime(result.createdAt))
    lines.push('  sessions captured: ' + result.sessions.length + '  chunks: ' + result.chunks + '  bytes: ' + humanBytes(result.bytes))
    for (const item of result.sessions) {
      lines.push('  + ' + item.sessionId + '  ' + item.chunks + ' chunk(s)  ' + humanBytes(item.bytes) + (item.tornTail ? '  (torn tail skipped)' : ''))
    }
    for (const item of result.skipped) lines.push('  = ' + item.sessionId + '  ' + item.code.toLowerCase().replaceAll('_', ' '))
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? item.file) + '  ' + item.code + ': ' + item.message)
    if (result.quarantined > 0) {
      lines.push('  quarantined ' + result.quarantined + ' session(s): nothing was published for them')
      lines.push('  publish anyway with --force, or disable one rule with --allow-rule <id>')
    }
    if (result.attachments.length > 0) lines.push('  attachments: ' + result.attachments.length + ' blob(s)  ' + humanBytes(result.attachmentBytes))
    if (result.manifestSeq !== null) lines.push('  manifest: ' + result.manifestSeq)
    print(result, options, lines.join('\n'))
    if (result.problems.length > 0) process.exit(1)
    return
  }

  if (command === 'verify') {
    const store = openFrom(options)
    const result = verifyStore(store)
    const lines = ['verify: ' + (result.ok ? 'ok' : 'PROBLEMS') + '  sessions: ' + result.totals.sessions + '  frames: ' + result.totals.frames + '  bytes: ' + humanBytes(result.totals.bytes) + (result.totals.attachments > 0 ? '  attachments: ' + result.totals.attachments + ' (' + humanBytes(result.totals.attachmentBytes) + ')' : '')]
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? '?') + '  ' + item.code + ': ' + item.message)
    print(result, options, lines.join('\n'))
    if (!result.ok) process.exit(1)
    return
  }

  if (command === 'attachments') {
    const store = openFrom(options)
    const report = backfillAttachments(store, {
      home,
      dryRun: Boolean(options['dry-run']),
      attachmentsRoot: options['attachments-root'] ?? null,
      device,
    })
    const lines = [
      'attachments backfill' + (report.dryRun ? '  (dry run)' : ''),
      '  sessions scanned: ' + report.scanned,
      '  references without a captured blob: ' + report.found.length,
      '  captured now: ' + report.captured.length + (report.manifestSeq !== null ? '  manifest: ' + report.manifestSeq : ''),
    ]
    for (const item of report.captured) lines.push('  + ' + item.hash.slice(0, 12) + '…  ' + humanBytes(item.bytes))
    for (const item of report.found) {
      if (!report.captured.some((entry) => entry.hash === item.hash)) lines.push('  · ' + item.hash.slice(0, 12) + '…  would be captured')
    }
    for (const item of report.missing) lines.push('  ! ' + item.hash.slice(0, 12) + '…  referenced but not on disk (session ' + item.sessionId + ')')
    for (const item of report.problems) lines.push('  ! ' + (item.hash ?? item.sessionId ?? '?') + '  ' + item.code + ': ' + item.message)
    print(report, options, lines.join('\n'))
    if (report.problems.length > 0 || report.missing.length > 0) process.exit(1)
    return
  }

  if (command === 'compact') {
    const store = openFrom(options)
    const result = compact(store, { dryRun: Boolean(options['dry-run']), device })
    const lines = [
      'compaction' + (result.dryRun ? '  (dry run)' : ''),
      '  manifests before: ' + result.manifestsBefore + '  after: ' + result.manifestsAfter,
      '  chunks carried by the checkpoint: ' + result.chunks,
      '  ' + (result.reason ?? (result.compacted ? 'checkpoint written' : 'nothing to do')) +
        (result.manifestSeq !== undefined ? '  manifest: ' + result.manifestSeq : ''),
    ]
    print(result, options, lines.join('\n'))
    return
  }

  if (command === 'gc') {
    const store = openFrom(options)
    const dryRun = options.yes !== true
    const report = collectGarbage(store, { dryRun, yes: options.yes === true })
    const lines = [
      'garbage collection' + (dryRun ? '  (dry run: pass --yes to delete)' : ''),
      '  objects present: ' + report.present + '  referenced: ' + report.kept,
      '  unreferenced: ' + report.removable + '  bytes: ' + humanBytes(report.bytes),
      dryRun ? '  nothing was deleted' : '  deleted: ' + report.deleted,
    ]
    print(report, options, lines.join('\n'))
    return
  }

  if (command === 'merge') {
    const sides = []
    for (const side of ['a', 'b']) {
      const dir = options[side]
      const keyFile = options[side + '-key']
      if (!dir || !keyFile) fail('merge needs --' + side + ' <store> and --' + side + '-key <passphrase file>')
      if (!fs.existsSync(path.join(dir, 'meta.json'))) fail('no keeper store at ' + dir)
      const pass = readPassphraseFile(keyFile)
      if (!pass.passphrase) fail('cannot read the passphrase for ' + side + ': ' + pass.reason)
      sides.push(openStore(path.resolve(dir), pass.passphrase))
    }
    const outDir = options.out
    const outKey = options['out-key']
    if (!outDir) fail('merge needs --out <new store directory>')
    const outPassFile = outKey ?? null
    const outPass = outPassFile ? readPassphraseFile(outPassFile) : { passphrase: null }
    const onDivergence = options['on-divergence'] ?? 'owner'
    if (onDivergence !== 'owner' && onDivergence !== 'error') {
      fail("--on-divergence accepts 'owner' (default) or 'error': a merged store keeps one visible conversation per session")
    }
    const dryRun = Boolean(options['dry-run'])
    if (!dryRun) {
      if (!outPass.passphrase) fail('merge needs --out-key <passphrase file> for the new store')
      if (fs.existsSync(path.join(outDir, 'meta.json'))) fail('a store already exists at ' + outDir + '; pick a new directory')
    }

    const report = mergeStores(sides, {
      outDir: path.resolve(outDir),
      passphrase: outPass.passphrase,
      dryRun,
      deviceName: options['device-name'] ?? 'merged',
      maxChunkBytes: options['max-chunk-bytes'] ? Number(options['max-chunk-bytes']) : undefined,
      onDivergence: options['on-divergence'] ?? 'owner',
    })

    const lines = [
      'merge' + (dryRun ? '  (dry run: nothing written)' : '  -> ' + report.outDir),
    ]
    for (const source of report.sources) {
      lines.push('  source ' + (source.deviceName ?? '?') + '  ' + String(source.storeId).slice(0, 8) + '…  ' + source.sessions + ' session(s)  ' + source.attachments + ' attachment(s)')
    }
    lines.push('')
    for (const session of report.sessions) {
      lines.push('  ' + session.sessionId.slice(0, 22) + '…  ' + humanBytes(session.bytes).padStart(10) + '  ' + session.action + '  origin ' + (session.origin.deviceName ?? '?'))
    }
    for (const item of report.archived) {
      lines.push('  ' + item.sessionId.slice(0, 22) + '…  ' + humanBytes(item.bytes).padStart(10) + '  archived (' + (item.origin.deviceName ?? '?') + ')  ' + item.archiveKey)
    }
    lines.push('')
    lines.push('  sessions visible: ' + report.sessions.length + '   archived: ' + report.archived.length)
    lines.push('  attachments: ' + report.attachments)
    lines.push('  chunks sealed: ' + report.stats.chunks + '   reused: ' + report.stats.dedupedChunks + ' (' + humanBytes(report.stats.dedupedBytes) + ' not stored twice)')
    if (report.verification) {
      lines.push('  verification: ' + (report.verification.ok ? 'ok' : 'PROBLEMS') + '  sessions ' + report.verification.sessions + '  archived ' + report.verification.archived + '  frames ' + report.verification.frames + '  ' + humanBytes(report.verification.bytes))
      if (report.verification.problems.length > 0) lines.push('  ! ' + report.verification.problems.join(', '))
    }
    print(report, options, lines.join('\n'))
    if (report.verification && !report.verification.ok) process.exit(1)
    return
  }

  if (command === 'inventory') {
    const store = openFrom(options)
    const report = inventory(store, { home })
    const lines = [
      'inventory of ' + store.dir,
      '  host vocabulary: ' + report.hostVocabulary.types + ' event type(s) from ' + report.hostVocabulary.scanned + ' session(s)',
    ]
    for (const group of report.devices) {
      lines.push('')
      lines.push('  device ' + (group.deviceName ?? '(sin nombre)') + '  ' + group.deviceId.slice(0, 8) + '…  ' + group.sessions.length + ' session(s)')
      void 0
      for (const row of group.sessions) {
        const local =
          row.local === 'absent' ? 'not here' : row.local === 'identical' ? 'here, identical' : row.local === 'behind' ? 'here, behind' : row.local === 'ahead' ? 'here, ahead' : 'here, DIFFERENT'
        const compat = row.readable
          ? (row.advisory && row.unknownEvents.length > 0 ? 'readable (warn: ' + row.unknownEvents.slice(0, 2).join(', ') + ')' : 'readable')
          : 'NOT readable (' + row.unknownEvents.slice(0, 3).join(', ') + (row.unknownEvents.length > 3 ? ', …' : '') + ')'
        lines.push('    ' + row.sessionId.slice(0, 22) + '…  ' + humanBytes(row.bytes).padStart(9) + '  ' + local.padEnd(16) + '  ' + compat)
        if (row.cwd) lines.push('        ' + row.cwd)
      }
    }
    if ((report.archived ?? []).length > 0) {
      lines.push('')
      lines.push('  archived continuations (kept, never restored): ' + report.archived.length)
      for (const item of report.archived) {
        lines.push('    ' + item.sessionId.slice(0, 22) + '…  ' + humanBytes(item.bytes).padStart(9) + '  ' + (item.cwd ?? ''))
      }
    }
    print(report, options, lines.join('\n'))
    return
  }

  if (command === 'paths') {
    const layout = resolvePaths({ home, vault: options.store ?? null, key: options['key-file'] ?? null })
    const exists = (value) => (fs.existsSync(value) ? '' : '  (does not exist yet)')
    const lines = [
      'keeper layout for this machine',
      '  home        ' + layout.home,
      '  vault       ' + layout.vault + exists(layout.vault) + (layout.usingLegacy ? '   <- legacy location' : ''),
      '  key         ' + layout.key + exists(layout.key),
      '  device      ' + layout.device + exists(layout.device),
      '  origins     ' + layout.origins,
      '  sessions    ' + layout.sessions,
      '  attachments ' + layout.attachments,
      '  replaced    ' + layout.replacedPrefix + '<timestamp>',
      '  backups     ' + layout.backupPrefix + '<timestamp>',
      '  stick       ' + layout.stick,
    ]
    if (layout.legacy) lines.push('', '  a vault from the previous layout exists at ' + layout.legacy + '; `keeper status` uses it until it is moved to the canonical path')
    print(layout, options, lines.join('\n'))
    return
  }

  if (command === 'import') {
    const from = options.from
    if (!from) fail('import needs --from <directory on the pendrive created by keeper export>')
    const stickRoot = path.resolve(from)
    const stickDir = path.join(stickRoot, 'vault')
    if (!fs.existsSync(path.join(stickDir, 'meta.json'))) {
      fail('no carried vault at ' + stickDir + ' (run keeper export on the other machine first)')
    }

    let stickKey = options['stick-key'] ?? null
    if (!stickKey) {
      const keyDir = path.join(stickRoot, 'key')
      if (fs.existsSync(keyDir)) {
        const files = fs.readdirSync(keyDir).filter((name) => !name.startsWith('.'))
        if (files.length === 1) stickKey = path.join(keyDir, files[0])
      }
    }
    if (!stickKey) fail('import needs --stick-key <passphrase file for the carried vault>')

    const localPass = passphraseFrom(options)
    const layout = resolvePaths({ home, vault: options.store ?? null, key: options['key-file'] ?? null })
    const localStore = openStore(layout.vault, localPass.passphrase)
    const stickPass = readPassphraseFile(stickKey)
    if (!stickPass.passphrase) fail('cannot read the passphrase of the carried vault: ' + stickPass.reason)
    let stickStore
    try {
      stickStore = openStore(stickDir, stickPass.passphrase)
    } catch (error) {
      if (error.code === 'BAD_FORMAT') {
        fail('the carried vault uses a format this keeper does not know (' + error.message + '); update the plugin on this machine')
      }
      throw error
    }

    const report = importVault({
      stickStore,
      localStore,
      localPassphrase: localPass.passphrase,
      stickPassphrase: stickPass.passphrase,
      home,
      swap: options.swap === true,
      onDivergence: options['on-divergence'] ?? 'owner',
    })

    const lines = [
      'import from ' + stickDir + (report.swapped ? '  (swapped into place)' : '  (prepared, nothing live was touched)'),
      '  carried vault: verified  ' + report.stick.totals.sessions + ' session(s)  ' + report.stick.totals.frames + ' frame(s)  ' + humanBytes(report.stick.totals.bytes),
      '  merged: ' + report.merge.sessions + ' session(s)  ' + report.merge.archived + ' archived  ' + report.merge.verification.frames + ' frame(s)  ' + humanBytes(report.merge.verification.bytes),
      '  dedupe: ' + humanBytes(report.merge.dedupedBytes) + ' not stored twice',
      '  this host can read ' + report.preflight.readable + ' of them' + (report.preflight.unreadable.length > 0 ? ', not ' + report.preflight.unreadable.length + ' (they need a newer DSH)' : ''),
    ]
    if (report.swapped) {
      lines.push('  previous vault: ' + report.replaced)
      if (report.restored) {
        lines.push('  restore into ' + report.restored.home)
        lines.push('    created: ' + report.restored.created.length + '   identical: ' + report.restored.identical.length + '   refused: ' + report.restored.refused.length + '   unreadable: ' + report.restored.incompatible.length)
        for (const item of report.restored.created) lines.push('    + ' + item.sessionId + '  ' + humanBytes(item.bytes))
        for (const item of report.restored.refused) lines.push('    ! ' + item.sessionId + '  ' + item.reason)
        for (const item of report.restored.incompatible) lines.push('    x ' + item.sessionId + '  skipped: this host does not know ' + item.unknownEvents.join(', '))
        lines.push('  reopen DSH to see them')
      }
    } else {
      lines.push('  next: run this again with --swap, with DSH closed, to make it the local vault')
    }
    print(report, options, lines.join('\n'))
    return
  }

  if (command === 'export') {
    const to = options.to
    if (!to) fail('export needs --to <directory on the pendrive>')
    const layout = resolvePaths({ home, vault: options.store ?? null, key: options['key-file'] ?? null })
    const pass = passphraseFrom(options)
    const store = openStore(layout.vault, pass.passphrase)
    const pkgPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'package.json')
    let pluginVersion = null
    try {
      pluginVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
    } catch {
      pluginVersion = null
    }
    const report = exportVault({
      store,
      passphrase: pass.passphrase,
      to: path.resolve(to),
      keyFile: options['key-file'] ?? layout.key,
      pluginVersion,
      keepReplaced: options['no-keep-replaced'] !== true,
    })
    const lines = [
      'export  ' + report.copy.dir,
      '  vault: ' + report.source.storeId + '  device ' + (report.source.deviceName ?? '?') + '  format ' + (report.source.format ?? '?'),
      '  verified: ' + (report.verified.ok ? 'ok' : 'PROBLEMS') + '  ' + report.totals.sessions + ' session(s)  ' + report.totals.frames + ' frame(s)  ' + humanBytes(report.totals.bytes),
      '  copy: ' + report.copy.files + ' file(s)  ' + humanBytes(report.copy.bytes),
      report.copy.replaced ? '  previous copy kept at ' + report.copy.replaced : '  first copy on the stick',
      '  receipt: ' + report.receiptPath,
      report.keyFingerprint ? '  key fingerprint: ' + report.keyFingerprint + '  (the passphrase itself did not travel)' : '  key fingerprint: not computed',
    ]
    if (report.warning) lines.push('  ! ' + report.warning)
    print(report, options, lines.join('\n'))
    if (!report.verified.ok) process.exit(1)
    return
  }

  if (command === 'status') {
    const store = openFrom(options)
    const chain = readAllManifests(store)
    const published = publishedState(chain)
    const blobs = publishedAttachments(chain)
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
      archived: (published.archived ?? []).length,
      attachments: { blobs: blobs.size, bytes: [...blobs.values()].reduce((sum, entry) => sum + (entry.bytes ?? 0), 0) },
      checkedAt: toIso(),
    }
    const lines = [
      'store    ' + store.dir,
      'device   ' + device.deviceName + ' (' + device.deviceId + ')  heads in store: ' + listDeviceHeads(store.dir).length,
      'snapshots ' + chain.length + (result.lastManifestAt ? '  last ' + formatTime(result.lastManifestAt) : ''),
      'published ' + publishSummary.sessions + ' session(s)  ' + publishSummary.frames + ' frame(s)  ' + humanBytes(publishSummary.bytes),
      'archived  ' + (published.archived ?? []).length + ' continuation(s) kept from a device that was not the owner',
      'attachments ' + blobs.size + ' blob(s)  ' + humanBytes([...blobs.values()].reduce((sum, entry) => sum + (entry.bytes ?? 0), 0)),
    ]
    print(result, options, lines.join('\n'))
    return
  }

  if (command === 'restore') {
    const store = openFrom(options)
    const result = restore(store, {
      home,
      dryRun: Boolean(options['dry-run']),
      force: Boolean(options.force),
      preflight: options['no-preflight'] !== true,
    })
    const lines = ['restore into ' + result.home + (result.dryRun ? '  (dry run)' : '')]
    for (const item of result.created) lines.push('  + ' + item.sessionId + '  ' + humanBytes(item.bytes) + '  ' + item.target)
    for (const item of result.identical) lines.push('  = ' + item.sessionId + '  already present and identical')
    for (const item of result.setAside) lines.push('  ~ ' + item.sessionId + '  ' + item.message)
    for (const item of result.refused) lines.push('  ! ' + item.sessionId + '  ' + item.message + '  (' + item.target + ')')
    for (const item of result.incompatible ?? []) {
      lines.push('  x ' + item.sessionId + '  skipped: this host does not know ' + item.unknownEvents.join(', ') + ' (use --force to write it anyway)')
    }
    for (const item of result.attachments ?? []) {
      lines.push('  ' + (item.action === 'created' ? '+' : item.action === 'present' ? '=' : '~') + ' attachment ' + item.hash.slice(0, 12) + '…  ' + humanBytes(item.bytes) + '  ' + item.action)
    }
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? '?') + '  ' + item.code + ': ' + item.message)
    const touched = result.created.length + result.identical.length + result.setAside.length + result.refused.length
    lines.push('  sessions considered: ' + touched)
    if ((result.archived ?? 0) > 0) {
      lines.push('  archived continuations in the vault: ' + result.archived + '  (kept, never restored — see keeper inventory)')
    }
    if ((result.attachments ?? []).length > 0) lines.push('  attachments considered: ' + result.attachments.length)
    print(result, options, lines.join('\n'))
    if (result.problems.length > 0) process.exit(1)
    if (result.refused.length > 0 || (result.incompatible ?? []).length > 0) process.exit(3) // completed, with refusals
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
