import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { initStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const GOOD = 'the passphrase this store was created with'
const OTHER = 'a different passphrase entirely'
const ENV = 'KEEPER_PASSPHRASE_PRECEDENCE'

function setup(t, { fileValue = null } = {}) {
  const root = tempDir('keeper-pass-')
  const home = path.join(root, 'home')
  const sessionsRoot = path.join(home, 'sessions')
  const storeDir = path.join(root, 'store')
  const passFile = path.join(root, 'passphrase.txt')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, {
    id: 'session-pass',
    cwd: 'C:\\work\\pass',
    log: makeLog({ id: 'session-pass', cwd: 'C:\\work\\pass', batches: [[{ type: 'turn/start' }]] }),
  })
  initStore(storeDir, { passphrase: GOOD, deviceName: 'pass-test' })
  if (fileValue !== null) fs.writeFileSync(passFile, fileValue, 'utf8')

  const commands = []
  const ctx = {
    commands: { register: (definition) => commands.push(definition) },
    on: () => {},
    effect: (factory) => factory(),
    logger: { warn: () => {} },
  }
  const config = { store: storeDir, sessionsRoot, passphraseEnv: ENV, passphraseFile: fileValue === null ? undefined : passFile }
  apply(ctx, config)
  t.after(() => removeDir(root))
  return { command: commands[0], passFile, storeDir }
}

test.afterEach(() => {
  delete process.env[ENV]
})

test('the configured file wins over an ambient environment variable', async (t) => {
  const { command } = setup(t, { fileValue: GOOD })
  process.env[ENV] = OTHER

  const status = await command.handler({ rawInput: 'status' })
  assert.equal(status.kind, 'success', status.text)
  assert.match(status.text, /passphrase file .*?\(\d+ chars\)/)
})

test('without a file the environment variable is used and reported as such', async (t) => {
  const { command } = setup(t)
  process.env[ENV] = GOOD

  const status = await command.handler({ rawInput: 'status' })
  assert.equal(status.kind, 'success', status.text)
  assert.match(status.text, new RegExp('passphrase env ' + ENV))
})

test('a wrong passphrase names the source and the length it used', async (t) => {
  const { command } = setup(t, { fileValue: OTHER })

  const status = await command.handler({ rawInput: 'status' })
  assert.equal(status.kind, 'error')
  assert.match(status.text, /wrong passphrase \(store /)
  assert.match(status.text, /source: file /)
  assert.match(status.text, /fingerprint [0-9a-f]{8}/)
  assert.match(status.text, /\d+ chars/)
})
