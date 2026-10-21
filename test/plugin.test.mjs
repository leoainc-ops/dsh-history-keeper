import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'
import { initStore, openStore } from '../lib/store.js'

const PASS = 'correct horse battery staple'
const ENV = 'KEEPER_PASSPHRASE_TEST'

function fakeContext() {
  const commands = []
  const listeners = new Map()
  const disposers = []
  const warnings = []
  return {
    commands: { register: (definition) => commands.push(definition) },
    on: (event, handler) => listeners.set(event, handler),
    effect: (factory) => disposers.push(factory()),
    logger: { warn: (message) => warnings.push(message) },
    commandsRegistered: commands,
    listeners,
    disposers,
    warnings,
  }
}

function makeRow(overrides = {}) {
  const root = tempDir('keeper-plugin-')
  const home = path.join(root, 'home')
  const sessionsRoot = path.join(home, 'sessions')
  const storeDir = path.join(root, 'store')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, {
    id: 'session-plugin',
    cwd: 'C:\\work\\plugin',
    log: makeLog({ id: 'session-plugin', cwd: 'C:\\work\\plugin', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }),
  })
  return { root, home, sessionsRoot, storeDir, config: { store: storeDir, sessionsRoot, passphraseEnv: ENV, ...overrides } }
}

async function invoke(definition, rawInput) {
  return definition.handler({ rawInput, agent: null, signal: undefined })
}

test.beforeEach(() => {
  process.env[ENV] = PASS
})
test.afterEach(() => {
  delete process.env[ENV]
})

test('mounts, registers /keeper and installs one disposer without throwing', (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  const ctx = fakeContext()

  const mounted = apply(ctx, row.config)

  assert.equal(mounted.command, 'keeper')
  assert.equal(ctx.commandsRegistered.length, 1)
  assert.equal(ctx.commandsRegistered[0].name, 'keeper')
  assert.equal(typeof ctx.commandsRegistered[0].handler, 'function')
  assert.equal(ctx.listeners.has('session/flush'), true)
  assert.equal(ctx.listeners.has('session/disposed'), true)
  assert.equal(ctx.disposers.length, 1)
  assert.doesNotThrow(() => ctx.disposers[0]())
})

test('a missing store is reported on use, never at mount', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  const ctx = fakeContext()
  apply(ctx, row.config)

  const result = await invoke(ctx.commandsRegistered[0], 'status')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /no keeper store/)
  assert.match(result.text, /keeper init/)
})

test('a missing passphrase fails closed with instructions', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  initStore(row.storeDir, { passphrase: PASS, deviceName: 'plugin-test' })
  delete process.env[ENV]

  const ctx = fakeContext()
  apply(ctx, row.config)
  const result = await invoke(ctx.commandsRegistered[0], 'snapshot')

  assert.equal(result.kind, 'error')
  assert.match(result.text, new RegExp(ENV))
})

test('snapshot, status and verify work through the command surface', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  initStore(row.storeDir, { passphrase: PASS, deviceName: 'plugin-test' })
  const ctx = fakeContext()
  apply(ctx, row.config)
  const command = ctx.commandsRegistered[0]

  const before = await invoke(command, 'status')
  assert.equal(before.kind, 'success')
  assert.match(before.text, /this machine 1 session/)
  assert.match(before.text, /vault holds 0 session/)

  const snap = await invoke(command, 'snapshot')
  assert.equal(snap.kind, 'success', snap.text)
  assert.match(snap.text, /captured 1 session/)

  const verified = await invoke(command, 'verify')
  assert.equal(verified.kind, 'success', verified.text)
  assert.match(verified.text, /verify ok/)

  const after = await invoke(command, 'status')
  assert.match(after.text, /vault holds 1 session/)

  const again = await invoke(command, 'snapshot')
  assert.equal(again.kind, 'success')
  assert.match(again.text, /captured 0 session/)
})

test('restore is refused inside the host and points at the CLI', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  initStore(row.storeDir, { passphrase: PASS, deviceName: 'plugin-test' })
  const ctx = fakeContext()
  apply(ctx, row.config)

  const result = await invoke(ctx.commandsRegistered[0], 'restore')
  assert.equal(result.kind, 'error')
  assert.match(result.text, /CLI/)
  assert.match(result.text, /keeper restore --store/)
})

test('unknown actions answer with usage instead of a stack trace', async (t) => {
  const row = makeRow()
  t.after(() => removeDir(row.root))
  initStore(row.storeDir, { passphrase: PASS, deviceName: 'plugin-test' })
  const ctx = fakeContext()
  apply(ctx, row.config)

  const unknown = await invoke(ctx.commandsRegistered[0], 'nonsense')
  assert.equal(unknown.kind, 'error')
  assert.match(unknown.text, /usage/)

  const help = await invoke(ctx.commandsRegistered[0], 'help')
  assert.equal(help.kind, 'success')
  assert.match(help.text, /usage/)
})

test('a session flush schedules an automatic snapshot', async (t) => {
  const row = makeRow({ debounceMs: 10 })
  t.after(() => removeDir(row.root))
  initStore(row.storeDir, { passphrase: PASS, deviceName: 'plugin-test' })
  const ctx = fakeContext()
  apply(ctx, row.config)

  assert.equal(ctx.listeners.get('session/flush')(), undefined)
  await new Promise((resolve) => setTimeout(resolve, 120))

  const store = openStore(row.storeDir, PASS)
  assert.equal(store.meta.snapshots, 1, 'the flush hook must have captured the session')
  assert.equal(ctx.warnings.length, 0)
})

test('an automatic snapshot with a wrong passphrase warns instead of breaking the host', async (t) => {
  const row = makeRow({ debounceMs: 10 })
  t.after(() => removeDir(row.root))
  initStore(row.storeDir, { passphrase: PASS, deviceName: 'plugin-test' })
  process.env[ENV] = 'a completely different passphrase'

  const ctx = fakeContext()
  assert.doesNotThrow(() => apply(ctx, row.config))
  ctx.listeners.get('session/flush')()
  await new Promise((resolve) => setTimeout(resolve, 120))

  assert.equal(ctx.warnings.length, 1)
  assert.match(ctx.warnings[0], /wrong passphrase/)
})
