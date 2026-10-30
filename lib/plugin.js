/**
 * Host plugin: registers `/keeper` and captures sessions automatically.
 *
 * Boundaries that keep this safe inside a running host:
 *  - capture only ever READS the session store and writes sealed objects;
 *  - the published history is never overwritten and a divergent local log is refused;
 *  - `restore` is deliberately NOT available here: it writes into the live session store,
 *    and a running host would not notice. It stays a CLI operation, with DSH closed.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { compact } from './compact.js'
import { resolveDevice } from './device.js'
import { generatePassphraseFile, normalizeConfig, resolvePassphrase } from './config.js'
import { evaluatePolicy } from './policy.js'
import { findSessionLogs, readLogHeader } from './session-log.js'
import { publishedAttachments, publishedState, snapshot as runSnapshot } from './snapshot.js'
import { initStore, listDeviceHeads, openStore, readAllManifests, readManifestChain } from './store.js'
import { formatTime, humanBytes } from './util.js'
import { verifyStore } from './verify.js'

export const COMMAND = 'keeper'

const USAGE = [
  'usage — /keeper [init | status | snapshot | verify | help]',
  '  init      create the vault (generates a passphrase if you have not set one)',
  '  status    what the vault holds, what is pending, what this machine is missing',
  '  snapshot  capture new session bytes now',
  '  verify    check every object, hash and chain',
  '  help      this text',
  '',
  'everything has defaults: with no config the vault lives in ~/.dsh/history-keeper and',
  'sessions are read from ~/.dsh/sessions.',
  '',
  'restore is a CLI operation (it writes the live session store):',
  '  keeper restore --store <dir> --home <dsh home>',
].join('\n')

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx host context
 * @param {any} raw raw row config
 */
export function mountKeeper(ctx, raw) {
  const { config, problems } = normalizeConfig(raw)
  // This machine's identity lives in its own home, never in the shared store.
  const device = resolveDevice({ configDir: path.dirname(config.sessionsRoot), deviceName: config.deviceName })
  const state = { timer: null, running: false, pending: false, lastRunAt: null, lastError: null, quarantined: [], throttledRetryMs: null, forceNext: false, lastPolicy: null, lastCompact: null, hooks: { flush: false, disposed: false } }

  const warn = (message) => {
    try {
      ctx.logger?.warn?.(message)
    } catch {
      /* a logging failure must never break the host */
    }
  }

  function failClosed(reason) {
    return { kind: 'error', text: 'keeper: ' + reason }
  }

  function open() {
    const pass = resolvePassphrase(config)
    if (!pass.passphrase) return { error: failClosed(pass.reason) }
    if (!config.store) return { error: failClosed('config.store is required') }
    if (!fs.existsSync(config.store + '/meta.json')) {
      return { error: failClosed('no keeper store at ' + config.store + ' (run: keeper init --store ' + config.store + ')') }
    }
    try {
      return { store: openStore(config.store, pass.passphrase), pass }
    } catch (error) {
      if (error && error.name === 'KeeperCryptoError') {
        // Diagnostics that make a mismatch actionable without exposing the secret: which store
        // was opened, from which source, and a fingerprint of (storeId + passphrase) so the
        // operator can compare it against the same computation done outside the host.
        let meta = null
        try {
          meta = JSON.parse(fs.readFileSync(path.join(config.store, 'meta.json'), 'utf8'))
        } catch {
          meta = null
        }
        const fingerprint = createHash('sha256')
          .update(String(meta?.storeId ?? '') + '\u0000' + pass.passphrase)
          .digest('hex')
          .slice(0, 8)
        return {
          error: failClosed(
            'wrong passphrase (store ' + config.store + ' id ' + (meta?.storeId ?? 'unknown') +
              ', source: ' + pass.source + ', ' + pass.length + ' chars, fingerprint ' + fingerprint + ')',
          ),
        }
      }
      throw error
    }
  }

  function localSessions() {
    const logs = findSessionLogs(config.sessionsRoot)
    const sessions = []
    for (const log of logs) {
      try {
        const buffer = fs.readFileSync(log.file)
        const info = readLogHeader(buffer)
        sessions.push({ id: info.header.id, file: log.file, bytes: buffer.length })
      } catch {
        /* an unreadable log is reported by snapshot, not here */
      }
    }
    return sessions
  }

  function renderStatus() {
    const opened = open()
    if (opened.error) return opened.error

    const chain = readAllManifests(opened.store)
    const published = publishedState(chain)
    const blobs = publishedAttachments(chain)
    const local = localSessions()

    let publishedBytes = 0
    let publishedFrames = 0
    for (const entry of published.values()) {
      publishedBytes += entry.bytes
      publishedFrames += entry.frames
    }

    const localIds = new Set(local.map((entry) => entry.id))
    const missingHere = [...published.keys()].filter((id) => !localIds.has(id))
    const pending = local.filter((entry) => {
      const entryPublished = published.get(entry.id)
      return !entryPublished || entry.bytes > entryPublished.bytes
    })

    const hooks = !config.autoSnapshotOnFlush
      ? 'disabled by config'
      : state.hooks.flush && state.hooks.disposed
        ? 'attached (session/flush + session/disposed)'
        : state.hooks.flush || state.hooks.disposed
          ? 'PARTIAL (' + (state.hooks.flush ? 'flush' : 'disposed') + ' only): automatic capture may miss turns'
          : 'UNAVAILABLE (this host exposes no event bus): use /keeper snapshot'

    const lines = [
      'vault    ' + config.store,
      'device   ' + device.deviceName + ' (' + device.deviceId + ')  heads in store: ' + listDeviceHeads(opened.store.dir).length,
      'passphrase ' + opened.pass.source + ' (' + opened.pass.length + ' chars)',
      'hooks    ' + hooks,
      'coalescing ' + (config.snapshotMinIntervalMs > 0 ? Math.round(config.snapshotMinIntervalMs / 1000) + 's per session' : 'off (one manifest per flush)'),
      'secret scan ' + (config.secretScan ? 'on' + (config.secretScanAllow.length > 0 ? ' (allowed rules: ' + config.secretScanAllow.join(', ') + ')' : '') : 'OFF — credentials would be published'),
      'snapshots ' + chain.length + (chain[0]?.kind === 'checkpoint' ? ' (starts at a checkpoint)' : '') + (chain.length > 0 ? '  last ' + formatTime(chain[chain.length - 1].createdAt) : '') + (config.autoCompact ? '  auto-compact after ' + config.compactMinManifests : '  manual compaction'),
      'vault holds ' + published.size + ' session(s)  ' + publishedFrames + ' frame(s)  ' + humanBytes(publishedBytes),
      'this machine ' + local.length + ' session(s)  pending ' + pending.length + (missingHere.length > 0 ? '  missing here ' + missingHere.length : ''),
      blobs.size > 0
        ? 'attachments ' + blobs.size + ' blob(s)  ' + humanBytes([...blobs.values()].reduce((sum, entry) => sum + (entry.bytes ?? 0), 0))
        : 'attachments none captured',
      state.lastRunAt ? 'last auto snapshot ' + formatTime(state.lastRunAt) : 'auto snapshot idle',
    ]
    if (state.quarantined.length > 0) {
      lines.push('quarantined ' + state.quarantined.length + ' session(s) in the last run: ' + state.quarantined.join(', '))
    }
    if (state.lastError) lines.push('last error ' + state.lastError)
    if (missingHere.length > 0) {
      lines.push('')
      lines.push('sessions in the vault that this machine does not have:')
      for (const id of missingHere.slice(0, 10)) lines.push('  - ' + id)
      if (missingHere.length > 10) lines.push('  … and ' + (missingHere.length - 10) + ' more')
      lines.push('restore them with the CLI (DSH closed): keeper restore --store ' + config.store + ' --home <dsh home>')
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  function doInit() {
    const metaFile = path.join(config.store, 'meta.json')
    if (fs.existsSync(metaFile)) {
      const pass = resolvePassphrase(config)
      return {
        kind: 'success',
        text: 'keeper is already initialized\n  vault ' + config.store + '\n  passphrase source: ' + pass.source,
      }
    }

    let pass = resolvePassphrase(config)
    let generated = null
    if (!pass.passphrase) {
      generated = generatePassphraseFile(config.keyFile)
      pass = { passphrase: generated.passphrase, source: 'generated key file ' + generated.file, length: generated.length }
    }

    const created = initStore(config.store, { passphrase: pass.passphrase, deviceName: config.deviceName })
    const lines = [
      'keeper initialized',
      '  vault ' + created.dir,
      '  device ' + created.meta.deviceName + ' (' + created.meta.deviceId + ')',
      '  cipher ' + created.meta.aead,
      '  passphrase source: ' + pass.source,
    ]
    if (generated) {
      lines.push(
        '',
        'A passphrase was generated and written to:',
        '  ' + generated.file,
        '',
        'It is not printed here on purpose: everything printed in a conversation is stored in',
        'the session history. Copy that file into a password manager and keep it away from the',
        'vault itself. Without it the vault cannot be opened — there is no recovery path.',
      )
    }
    lines.push('', 'next: /keeper snapshot')
    return { kind: 'success', text: lines.join('\n') }
  }

  function doSnapshot(force = true) {
    const opened = open()
    if (opened.error) return opened.error
    const result = runSnapshot(opened.store, {
      sessionsRoot: config.sessionsRoot,
      maxChunkBytes: config.maxChunkBytes,
      minIntervalMs: config.snapshotMinIntervalMs,
      force,
      secretScan: config.secretScan,
      secretScanAllow: config.secretScanAllow,
      secretScanEntropy: config.secretScanEntropy,
      captureAttachments: config.captureAttachments,
      attachmentsRoot: config.attachmentsRoot,
      device,
      lockTimeoutMs: 1_000,
    })
    state.quarantined = result.problems.filter((problem) => problem.code === 'QUARANTINED').map((problem) => problem.sessionId)
    const throttled = result.skipped.filter((item) => item.code === 'THROTTLED')
    state.throttledRetryMs = throttled.length > 0 ? Math.min(...throttled.map((item) => item.retryInMs)) : null
    state.lastRunAt = result.createdAt
    state.lastError = result.problems.length > 0 ? result.problems.map((problem) => problem.code).join(', ') : null

    // Compaction: policy decides, never a timer. The decision and its reason are kept so
    // `/keeper status` can explain why the chain looks the way it does.
    if (config.autoCompact) {
      try {
        const chain = readManifestChain(opened.store)
        const decision = evaluatePolicy({ store: opened.store, chain, options: { minManifests: config.compactMinManifests } })
        state.lastPolicy = decision
        if (decision.compact) {
          state.lastCompact = compact(opened.store, { device })
        }
      } catch (error) {
        warn('[keeper] compaction skipped: ' + (error && error.message ? error.message : String(error)))
      }
    }

    const lines = [
      'snapshot ' + formatTime(result.createdAt),
      'captured ' + result.sessions.length + ' session(s)  ' + result.chunks + ' chunk(s)  ' + humanBytes(result.bytes),
    ]
    for (const item of result.sessions) lines.push('  + ' + item.sessionId + '  ' + humanBytes(item.bytes))
    if (result.attachments.length > 0) {
      lines.push('  attachments ' + result.attachments.length + ' blob(s)  ' + humanBytes(result.attachmentBytes))
    }
    for (const item of result.skipped) lines.push('  = ' + item.sessionId + '  ' + item.code.toLowerCase().replaceAll('_', ' '))
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? item.file) + '  ' + item.code + ': ' + item.message)
    if (state.lastCompact?.compacted) {
      lines.push(
        '  compacted ' + state.lastCompact.manifestsBefore + ' manifest(s) into one checkpoint  ' +
          '([' + state.lastCompact.chunks + ' chunk(s)])',
      )
    }
    return { kind: result.problems.length > 0 ? 'error' : 'success', text: lines.join('\n') }
  }

  function doVerify() {
    const opened = open()
    if (opened.error) return opened.error
    const result = verifyStore(opened.store)
    const lines = [
      'verify ' + (result.ok ? 'ok' : 'PROBLEMS') +
        '  sessions ' + result.totals.sessions +
        '  frames ' + result.totals.frames +
        '  ' + humanBytes(result.totals.bytes) +
        (result.totals.attachments > 0 ? '  attachments ' + result.totals.attachments + ' (' + humanBytes(result.totals.attachmentBytes) + ')' : ''),
    ]
    for (const problem of result.problems) lines.push('  ! ' + (problem.sessionId ?? '?') + '  ' + problem.code + ': ' + problem.message)
    return { kind: result.ok ? 'success' : 'error', text: lines.join('\n') }
  }

  async function handler(invocation) {
    const action = String(invocation?.rawInput ?? '').trim().split(/\s+/u)[0]?.toLowerCase() || 'status'
    try {
      if (action === 'help') return { kind: 'success', text: USAGE }
      if (action === 'init') return doInit()
      if (action === 'status') return renderStatus()
      if (action === 'snapshot') return doSnapshot()
      if (action === 'verify') return doVerify()
      if (action === 'restore') {
        return failClosed(
          'restore is a CLI-only operation: it writes the live session store, so it is not available from inside DSH. ' +
            'Close DSH and run: keeper restore --store ' + (config.store ?? '<dir>') + ' --home <dsh home> [--dry-run]',
        )
      }
      return { kind: 'error', text: USAGE }
    } catch (error) {
      return failClosed(error && error.message ? error.message : String(error))
    }
  }

  function schedule(reason, force = false) {
    if (!config.autoSnapshotOnFlush) return
    if (force) state.forceNext = true
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      runNow(reason)
    }, config.debounceMs)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  }

  /** A session was coalesced: come back exactly when its window opens. */
  function scheduleAfter(ms) {
    if (!config.autoSnapshotOnFlush) return
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      runNow('throttled')
    }, Math.max(250, ms))
    if (typeof state.timer.unref === 'function') state.timer.unref()
  }

  function runNow() {
    if (state.running) {
      state.pending = true
      return
    }
    state.running = true
    const forced = state.forceNext === true
    state.forceNext = false
    try {
      const result = doSnapshot(forced)
      if (result.kind === 'error') warn('[keeper] auto snapshot: ' + result.text.replaceAll('\n', ' | '))
    } catch (error) {
      if (error && error.code === 'STORE_BUSY') {
        // Another writer (a CLI command, usually) holds the store: come back shortly instead of
        // blocking the host or, worse, forking the chain.
        scheduleAfter(2_000)
        return
      }
      warn('[keeper] auto snapshot failed: ' + (error && error.message ? error.message : String(error)))
    } finally {
      state.running = false
      if (state.pending) {
        state.pending = false
        schedule('pending')
      } else if (state.throttledRetryMs !== null) {
        const wait = state.throttledRetryMs
        state.throttledRetryMs = null
        scheduleAfter(wait)
      }
    }
  }

  ctx.commands.register({
    name: COMMAND,
    description: 'Encrypted, verifiable history keeper: status, snapshot or verify the vault.',
    input: { hint: '[status | snapshot | verify | help]' },
    handler,
  })

  if (typeof ctx.on === 'function') {
    ctx.on('session/flush', () => schedule('flush'))
    ctx.on('session/disposed', () => schedule('dispose', true))
    state.hooks.flush = true
    state.hooks.disposed = true
  } else {
    warn('[keeper] this host exposes no event bus: automatic capture is unavailable, use /keeper snapshot')
  }

  ctx.effect?.(() => () => {
    if (state.timer) clearTimeout(state.timer)
    state.timer = null
  })

  if (problems.length > 0) warn('[keeper] configuration problems: ' + problems.join('; '))

  return { command: COMMAND, config, problems }
}

export { USAGE }
