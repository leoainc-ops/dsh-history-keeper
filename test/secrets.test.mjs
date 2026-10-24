import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { scanPayload, scanText } from '../lib/secrets.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'secret-gate-test-passphrase'
// Built at runtime on purpose: this file is part of the repository, and a session that writes
// a literal token-shaped string trips the very gate these tests exercise. The pieces are
// joined here so the source never contains a matchable secret.
const FAKE_TOKEN = ['sk', 'abcdefghijklmnopqrstuvwxyz012345'].join('-')
const REAL_LOOKING_KEY = ['a8f5f167', 'f44f4964e6c998dee827110c'].join('')
const REAL_LOOKING_PASSWORD = ['Sup3r', 'S3cret', 'Passw0rd', '2026'].join('-')

function setup(t) {
  const root = tempDir('keeper-secrets-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'secret-test' })
  t.after(() => removeDir(root))
  return { home, store: openStore(dir, PASSPHRASE), objectsDir: path.join(dir, 'objects') }
}

function logWith(secret) {
  return makeLog({ id: 's1', batches: [[{ type: 'message', role: 'user', text: 'here it is ' + secret }]] })
}

test('the scanner reports rule and line, never the value', () => {
  const matches = scanText('line one\nmy key is ' + FAKE_TOKEN + '\nline three')
  assert.equal(matches.length, 1)
  assert.equal(matches[0].rule, 'openai-key')
  assert.equal(matches[0].line, 2)
  assert.equal(JSON.stringify(matches).includes('sk-abc'), false, 'the match must not carry the secret')
})

test('an allowed rule is not reported', () => {
  assert.equal(scanText(FAKE_TOKEN, { allow: ['openai-key'] }).length, 0)
})

test('the payload scan decompresses the frames first', () => {
  const result = scanPayload(logWith(FAKE_TOKEN))
  assert.equal(result.ok, false)
  assert.equal(result.failed, null)
  assert.equal(result.matches[0].rule, 'openai-key')
  assert.equal(scanPayload(logWith('nothing sensitive here')).ok, true)
})

test('a session that looks like it holds a secret is quarantined, and force overrides', (t) => {
  const { home, store, objectsDir } = setup(t)
  writeSession(home, { id: 's1', log: logWith(FAKE_TOKEN) })

  const blocked = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(blocked.sessions.length, 0)
  assert.equal(blocked.quarantined, 1)
  assert.equal(blocked.problems[0].code, 'QUARANTINED')
  assert.equal(blocked.problems[0].rule, 'openai-key')
  assert.equal(fs.readdirSync(objectsDir).length, 0, 'a quarantined session must publish nothing')
  assert.equal(JSON.stringify(blocked).includes('sk-abc'), false, 'the report must not echo the secret')

  const forced = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z', force: true })
  assert.equal(forced.sessions.length, 1, 'force publishes anyway')
})

test('a clean session passes the gate', (t) => {
  const { home, store, objectsDir } = setup(t)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'message', text: 'a normal message' }]] }) })
  const result = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  assert.equal(result.sessions.length, 1)
  assert.equal(result.quarantined, 0)
  assert.ok(fs.readdirSync(objectsDir).length > 0)
})

test('the gate can be turned off for a single run', (t) => {
  const { home, store } = setup(t)
  writeSession(home, { id: 's1', log: logWith(FAKE_TOKEN) })
  const result = snapshot(store, { home, now: '2026-10-24T10:00:00.000Z', secretScan: false })
  assert.equal(result.sessions.length, 1)
})

test('placeholder values do not quarantine a session', () => {
  // A real false positive: an agent writing a test constant quarantined a whole conversation.
  assert.deepEqual(scanText("const PASSPHRASE = 'chain-cache-test-passphrase'"), [])
  assert.deepEqual(scanText("const TOKEN = 'FAKE_TOKEN_abcdefghijklmnop'"), [])
  assert.deepEqual(scanText('token sk-TEST-abcdefghijklmnopqrst'), [])
})

test('real-looking assignments are still blocked', () => {
  assert.equal(scanText('const apiKey = ' + REAL_LOOKING_KEY)[0].rule, 'secret-assignment')
  assert.equal(scanText('password: ' + REAL_LOOKING_PASSWORD)[0].rule, 'secret-assignment')
})