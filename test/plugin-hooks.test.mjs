import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { initStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'correct horse battery staple'
const ENV = 'KEEPER_PASSPHRASE_HOOKS'

function fakeContext({ withEventBus = true } = {}) {
  const commands = []
  const listeners = new Map()
  const warnings = []
  const ctx = {
    commands: { register: (definition) => commands.push(definition) },
    effect: (factory) => factory(),
    logger: { warn: (message) => warnings.push(message) },
    commandsRegistered: commands,
    listeners,
    warnings,
  }
  if (withEventBus) ctx.on = (event, handler) => listeners.set(event, handler)
  return ctx
}

function makeRow(overrides = {}) {
  const root = tempDir('keeper-hooks-')
  const home = path.join(root, 'home')
  const sessionsRoot = path.join(home, 'sessions')
  const storeDir = path.join(root, 'store')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, {
    id: 'session-hooks',
    cwd: 'C:\\work\\hooks',
    log: makeLog({ id: 'session-hooks', cwd: 'C:\\work\\hooks', batches: [[{ type: 'turn/start' }]] }),
  })
  initStore(storeDir, { passphrase: PASS, deviceName: 'hooks-test' })
  return { root, sessionsRoot, storeDir, config: { store: storeDir, sessionsRoot, passphraseEnv: ENV, ...overrides } }
}

test.beforeEach(() => {
  process.env[ENV] = PASS
})
test.afterEach(() => {
  delete process.env[ENV]
})

test('status proves the hooks are attached when the host has an event bus', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  const ctx = fakeContext()
  apply(ctx, row.config)

  const status = await ctx.commandsRegistered[0].handler({ rawInput: 'status' })
  assert.equal(status.kind, 'success', status.text)
  assert.match(status.text, /hooks\s+attached \(session\/flush \+ session\/disposed\)/)
})

test('a host without an event bus says so instead of silently never capturing', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  const ctx = fakeContext({ withEventBus: false })

  assert.doesNotThrow(() => apply(ctx, row.config))
  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0], /no event bus/)

  const status = await ctx.commandsRegistered[0].handler({ rawInput: 'status' })
  assert.match(status.text, /hooks\s+UNAVAILABLE/)
  assert.match(status.text, /use \/keeper snapshot/)
})

test('turning automatic capture off is visible in status', async (t) => {
  const row = makeRow({ autoSnapshotOnFlush: false })
  t.after(() => removeDir(row.root))
  const ctx = fakeContext()
  apply(ctx, row.config)

  const status = await ctx.commandsRegistered[0].handler({ rawInput: 'status' })
  assert.match(status.text, /hooks\s+disabled by config/)
})
