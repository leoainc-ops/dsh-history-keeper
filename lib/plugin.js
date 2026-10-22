/**
 * Host plugin: registers `/keeper` and captures sessions automatically.
 *
 * Boundaries that keep this safe inside a running host:
 *  - capture only ever READS the session store and writes sealed objects;
 *  - the published history is never overwritten and a divergent local log is refused;
 *  - `restore` is deliberately NOT available here: it writes into the live session store,
 *    and a running host would not notice. It stays a CLI operation, with DSH closed.
 */
import fs from 'node:fs'

import { normalizeConfig, resolvePassphrase } from './config.js'
import { findSessionLogs, readLogHeader } from './session-log.js'
import { publishedState, snapshot as runSnapshot } from './snapshot.js'
import { initStore, openStore, readManifestChain } from './store.js'
import { humanBytes } from './util.js'
import { verifyStore } from './verify.js'

export const COMMAND = 'keeper'

const USAGE = [
  'usage — /keeper [status | snapshot | verify | help]',
  '  status    what the vault holds, what is pending, what this machine is missing',
  '  snapshot  capture new session bytes now',
  '  verify    check every object, hash and chain',
  '  help      this text',
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
  const state = { timer: null, running: false, pending: false, lastRunAt: null, lastError: null, hooks: { flush: false, disposed: false } }

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
        return {
          error: failClosed(
            'wrong passphrase for this store (source: ' + pass.source + ', ' + pass.length + ' characters). ' +
              'The store was created with a different passphrase than the one this source provides.',
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

    const chain = readManifestChain(opened.store)
    const published = publishedState(chain)
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
      'device   ' + opened.store.meta.deviceName + ' (' + opened.store.meta.deviceId + ')',
      'passphrase ' + opened.pass.source + ' (' + opened.pass.length + ' chars)',
      'hooks    ' + hooks,
      'snapshots ' + chain.length + (chain.length > 0 ? '  last ' + chain[chain.length - 1].createdAt : ''),
      'vault holds ' + published.size + ' session(s)  ' + publishedFrames + ' frame(s)  ' + humanBytes(publishedBytes),
      'this machine ' + local.length + ' session(s)  pending ' + pending.length + (missingHere.length > 0 ? '  missing here ' + missingHere.length : ''),
      state.lastRunAt ? 'last auto snapshot ' + state.lastRunAt : 'auto snapshot idle',
    ]
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

  function doSnapshot() {
    const opened = open()
    if (opened.error) return opened.error
    const result = runSnapshot(opened.store, { sessionsRoot: config.sessionsRoot, maxChunkBytes: config.maxChunkBytes })
    state.lastRunAt = result.createdAt
    state.lastError = result.problems.length > 0 ? result.problems.map((problem) => problem.code).join(', ') : null
    const lines = [
      'snapshot ' + result.createdAt,
      'captured ' + result.sessions.length + ' session(s)  ' + result.chunks + ' chunk(s)  ' + humanBytes(result.bytes),
    ]
    for (const item of result.sessions) lines.push('  + ' + item.sessionId + '  ' + humanBytes(item.bytes))
    for (const item of result.skipped) lines.push('  = ' + item.sessionId + '  ' + item.code.toLowerCase().replaceAll('_', ' '))
    for (const item of result.problems) lines.push('  ! ' + (item.sessionId ?? item.file) + '  ' + item.code + ': ' + item.message)
    return { kind: result.problems.length > 0 ? 'error' : 'success', text: lines.join('\n') }
  }

  function doVerify() {
    const opened = open()
    if (opened.error) return opened.error
    const result = verifyStore(opened.store)
    const lines = ['verify ' + (result.ok ? 'ok' : 'PROBLEMS') + '  sessions ' + result.totals.sessions + '  frames ' + result.totals.frames + '  ' + humanBytes(result.totals.bytes)]
    for (const problem of result.problems) lines.push('  ! ' + (problem.sessionId ?? '?') + '  ' + problem.code + ': ' + problem.message)
    return { kind: result.ok ? 'success' : 'error', text: lines.join('\n') }
  }

  async function handler(invocation) {
    const action = String(invocation?.rawInput ?? '').trim().split(/\s+/u)[0]?.toLowerCase() || 'status'
    try {
      if (action === 'help') return { kind: 'success', text: USAGE }
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

  function schedule(reason) {
    if (!config.autoSnapshotOnFlush) return
    if (state.timer) clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      state.timer = null
      runNow(reason)
    }, config.debounceMs)
    if (typeof state.timer.unref === 'function') state.timer.unref()
  }

  function runNow() {
    if (state.running) {
      state.pending = true
      return
    }
    state.running = true
    try {
      const result = doSnapshot()
      if (result.kind === 'error') warn('[keeper] auto snapshot: ' + result.text.replaceAll('\n', ' | '))
    } catch (error) {
      warn('[keeper] auto snapshot failed: ' + (error && error.message ? error.message : String(error)))
    } finally {
      state.running = false
      if (state.pending) {
        state.pending = false
        schedule('pending')
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
    ctx.on('session/disposed', () => schedule('dispose'))
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
