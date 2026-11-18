import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { apply } from '../lib/index.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const ENV = 'KEEPER_PASSPHRASE_INIT_TEST'
const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(here, '..', 'bin', 'keeper.js')

function setup(t) {
  const root = tempDir('keeper-init-')
  const home = path.join(root, 'home')
  const sessionsRoot = path.join(home, 'sessions')
  const storeDir = path.join(root, 'vault')
  const keyFile = path.join(root, 'keeper.key')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, {
    id: 'session-init',
    cwd: 'C:\\work\\init',
    log: makeLog({ id: 'session-init', cwd: 'C:\\work\\init', batches: [[{ type: 'turn/start' }]] }),
  })

  const commands = []
  const ctx = {
    commands: { register: (definition) => commands.push(definition) },
    on: () => {},
    effect: (factory) => factory(),
    logger: { warn: () => {} },
  }
  const config = { store: storeDir, sessionsRoot, keyFile, passphraseEnv: ENV }
  apply(ctx, config)
  t.after(() => removeDir(root))
  return { root, storeDir, keyFile, command: commands[0], ctx }
}

test.afterEach(() => {
  delete process.env[ENV]
})

test('init refuses without an explicit passphrase, then creates the vault once one is written', async (t) => {
  const { storeDir, keyFile, command } = setup(t)
  delete process.env[ENV]

  const refused = await command.handler({ rawInput: 'init' })
  assert.equal(refused.kind, 'error', refused.text)
  assert.match(refused.text, /cannot create a vault without an explicit passphrase/)
  assert.equal(fs.existsSync(path.join(storeDir, 'meta.json')), false, 'no vault is created')
  assert.equal(fs.existsSync(keyFile), false, 'no key file is generated')

  fs.writeFileSync(keyFile, 'a phrase chosen by the operator\n', 'utf8')
  const init = await command.handler({ rawInput: 'init' })
  assert.equal(init.kind, 'success', init.text)
  assert.match(init.text, /keeper initialized/)
  assert.match(init.text, /passphrase source: key file /)

  assert.equal(fs.existsSync(path.join(storeDir, 'meta.json')), true, 'the vault must exist')

  const status = await command.handler({ rawInput: 'status' })
  assert.equal(status.kind, 'success', status.text)
  assert.match(status.text, /vault holds 0 session/)

  const snap = await command.handler({ rawInput: 'snapshot' })
  assert.equal(snap.kind, 'success', snap.text)
  assert.match(snap.text, /captured 1 session/)

  const again = await command.handler({ rawInput: 'init' })
  assert.match(again.text, /already initialized/)
})

test('init never prints the passphrase it was given', async (t) => {
  const { keyFile, command } = setup(t)
  delete process.env[ENV]
  const phrase = 'a phrase that must never be echoed'
  fs.writeFileSync(keyFile, phrase + '\n', 'utf8')

  const init = await command.handler({ rawInput: 'init' })
  assert.equal(init.text.includes(phrase), false, 'the secret must not appear in the command output')
})

test('an explicit passphrase file wins and no key is generated', async (t) => {
  const { root, keyFile } = setup(t)
  const passFile = path.join(root, 'forced.txt')
  fs.writeFileSync(passFile, 'an explicit passphrase of my own\n', 'utf8')
  delete process.env[ENV]

  // Re-mount with the explicit file configured.
  const commands = []
  apply(
    { commands: { register: (d) => commands.push(d) }, on: () => {}, effect: (f) => f(), logger: { warn: () => {} } },
    { store: path.join(root, 'vault2'), sessionsRoot: path.join(root, 'home', 'sessions'), keyFile, passphraseFile: passFile, passphraseEnv: ENV },
  )
  const init = await commands[0].handler({ rawInput: 'init' })

  assert.equal(init.kind, 'success', init.text)
  assert.match(init.text, /passphrase source: file /)
  assert.equal(fs.existsSync(keyFile), false, 'no key file may be generated when one is configured')
})

test('the CLI refuses to initialize without an explicit passphrase, then reads the one provided', (t) => {
  const { root, storeDir, keyFile } = setup(t)
  const env = { ...process.env }
  delete env[ENV]
  delete env.KEEPER_PASSPHRASE

  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })

  // 1. No passphrase anywhere: the vault is not created and no key file appears (R1).
  const refused = run('init', '--store', storeDir, '--key-file', keyFile, '--json')
  assert.equal(refused.status, 2)
  assert.match(refused.stderr, /explicit passphrase/)
  assert.equal(fs.existsSync(storeDir), false, 'no vault is created')
  assert.equal(fs.existsSync(keyFile), false, 'no key file is generated')

  // 2. The operator writes the phrase; init uses it and creates the vault.
  fs.mkdirSync(path.dirname(keyFile), { recursive: true })
  fs.writeFileSync(keyFile, 'a phrase chosen by the operator\n', 'utf8')
  const init = run('init', '--store', storeDir, '--key-file', keyFile, '--json')
  assert.equal(init.status, 0, init.stderr)
  assert.equal(JSON.parse(init.stdout).generatedKeyFile, null)

  // 3. The same file opens it.
  const verified = run('verify', '--store', storeDir, '--key-file', keyFile, '--json')
  assert.equal(verified.status, 0, verified.stderr)
  assert.equal(JSON.parse(verified.stdout).ok, true)

  const withoutKey = run('verify', '--store', storeDir, '--key-file', path.join(root, 'absent.key'))
  assert.equal(withoutKey.status, 2)
  assert.match(withoutKey.stderr, /no keeper store|passphrase not set/)
})
