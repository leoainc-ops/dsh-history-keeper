import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { frameOf, listFiles, makeLog, removeDir, tempDir, writeSession } from './helpers.js'
import { restore } from '../lib/restore.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'

const PASS = 'correct horse battery staple'
const here = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(here, '..', 'bin', 'keeper.js')

function setup(t, sessions) {
  const root = tempDir('keeper-e2e-')
  const home = path.join(root, 'home')
  const storeDir = path.join(root, 'store')
  fs.mkdirSync(home, { recursive: true })
  t.after(() => removeDir(root))
  const logs = {}
  for (const spec of sessions) {
    writeSession(home, spec)
    logs[spec.id] = spec.log
  }
  const store = initStore(storeDir, { passphrase: PASS, deviceName: 'test-device' })
  return { root, home, storeDir, store, logs }
}

const sessionA = {
  id: 'session-alpha',
  cwd: 'C:\\work\\alpha',
  log: makeLog({ id: 'session-alpha', cwd: 'C:\\work\\alpha', batches: [[{ type: 'turn/start' }], [{ type: 'message' }], [{ type: 'turn/end' }]] }),
}
const sessionB = {
  id: 'session-beta',
  cwd: 'C:\\work\\beta',
  log: makeLog({ id: 'session-beta', cwd: 'C:\\work\\beta', batches: [[{ type: 'turn/start' }]] }),
}

test('snapshot captures every session and restore reproduces the logs byte for byte', (t) => {
  const { home, store } = setup(t, [sessionA, sessionB])

  const snap = snapshot(store, { home })
  assert.equal(snap.sessions.length, 2)
  assert.equal(snap.problems.length, 0)
  assert.ok(snap.chunks >= 2)

  const verified = verifyStore(store)
  assert.equal(verified.ok, true, JSON.stringify(verified.problems))
  assert.equal(verified.totals.sessions, 2)

  const target = path.join(path.dirname(home), 'restored')
  const report = restore(store, { home: target })
  assert.equal(report.created.length, 2)
  assert.equal(report.problems.length, 0)

  for (const spec of [sessionA, sessionB]) {
    const file = listFiles(target).find((entry) => entry.includes(spec.id) && entry.endsWith('.zstd'))
    assert.ok(file, 'restored log for ' + spec.id)
    assert.ok(fs.readFileSync(path.join(target, file)).equals(spec.log), 'restored bytes must match ' + spec.id)
  }

  const again = restore(store, { home: target })
  assert.equal(again.created.length, 0)
  assert.equal(again.identical.length, 2)
})

test('the store leaks no session id, cwd or content', (t) => {
  const { storeDir, store } = setup(t, [sessionA])
  snapshot(store, { home: path.join(path.dirname(storeDir), 'home') })

  const needles = ['session-alpha', 'C:\\work\\alpha', 'turn/start']
  for (const relative of listFiles(storeDir)) {
    const bytes = fs.readFileSync(path.join(storeDir, relative))
    for (const needle of needles) {
      assert.equal(bytes.includes(Buffer.from(needle, 'utf8')), false, relative + ' must not contain ' + needle)
    }
  }
})

test('a torn tail is skipped and never restored', (t) => {
  const torn = Buffer.concat([sessionA.log, Buffer.from([0x28, 0xb5, 0x2f])])
  const { home, store } = setup(t, [{ ...sessionA, log: torn }])

  const snap = snapshot(store, { home })
  assert.equal(snap.sessions.length, 1)
  assert.equal(snap.sessions[0].tornTail, true)
  assert.equal(verifyStore(store).ok, true)

  const target = path.join(path.dirname(home), 'restored')
  restore(store, { home: target })
  const file = listFiles(target).find((entry) => entry.endsWith('.zstd'))
  assert.ok(fs.readFileSync(path.join(target, file)).equals(sessionA.log), 'restored log must stop at the last complete frame')
})

test('a second snapshot publishes only the new tail', (t) => {
  const { home, store } = setup(t, [sessionA])
  const first = snapshot(store, { home })
  assert.equal(first.sessions.length, 1)
  const firstBytes = first.bytes

  const extended = Buffer.concat([sessionA.log, frameOf({ type: 'turn/end', seq: 99 })])
  writeSession(home, { ...sessionA, log: extended })
  const second = snapshot(store, { home })

  assert.equal(second.sessions.length, 1)
  assert.equal(second.bytes, extended.length - firstBytes, 'only the new bytes are published')
  assert.equal(second.sessions[0].frames, 5)
  assert.equal(verifyStore(store).ok, true)

  const target = path.join(path.dirname(home), 'restored')
  restore(store, { home: target })
  const file = listFiles(target).find((entry) => entry.endsWith('.zstd'))
  assert.ok(fs.readFileSync(path.join(target, file)).equals(extended))
})

test('an up-to-date session is skipped, not duplicated', (t) => {
  const { home, store } = setup(t, [sessionA])
  snapshot(store, { home })
  const again = snapshot(store, { home })
  assert.equal(again.sessions.length, 0)
  assert.equal(again.skipped.length, 1)
  assert.equal(again.skipped[0].code, 'UP_TO_DATE')
  assert.equal(again.manifestSeq, null, 'no empty manifest is written')
})

test('corrupting one object fails verification', (t) => {
  const { home, storeDir, store } = setup(t, [sessionA, sessionB])
  snapshot(store, { home })
  assert.equal(verifyStore(openStore(storeDir, PASS)).ok, true)

  const objectFile = path.join(storeDir, listFiles(storeDir).find((entry) => entry.startsWith('objects/')))
  const bytes = fs.readFileSync(objectFile)
  bytes[bytes.length - 30] ^= 0xff
  fs.writeFileSync(objectFile, bytes)

  const result = verifyStore(openStore(storeDir, PASS))
  assert.equal(result.ok, false)
  assert.ok(result.problems.length > 0)
})

test('a local rewrite is refused instead of published', (t) => {
  const { home, store } = setup(t, [sessionA])
  snapshot(store, { home })
  const manifestsBefore = store.meta.snapshots

  const rewritten = makeLog({
    id: 'session-alpha',
    cwd: 'C:\\work\\alpha',
    batches: [[{ type: 'turn/start' }], [{ type: 'message', note: 'rewritten history that no longer matches' }], [{ type: 'turn/end' }]],
  })
  writeSession(home, { ...sessionA, log: rewritten })

  const result = snapshot(store, { home })
  assert.equal(result.sessions.length, 0)
  assert.equal(result.problems.length, 1)
  assert.equal(result.problems[0].code, 'DIVERGED')
  assert.equal(store.meta.snapshots, manifestsBefore, 'nothing is published on divergence')
})

test('restore never overwrites a different existing log', (t) => {
  const { home, store } = setup(t, [sessionA])
  snapshot(store, { home })

  const target = path.join(path.dirname(home), 'restored')
  restore(store, { home: target })
  const file = path.join(target, listFiles(target).find((entry) => entry.endsWith('.zstd')))
  fs.writeFileSync(file, Buffer.from('local content that must survive'))

  const report = restore(store, { home: target })
  assert.equal(report.refused.length, 1)
  assert.equal(fs.readFileSync(file, 'utf8'), 'local content that must survive')

  const forced = restore(store, { home: target, force: true })
  assert.equal(forced.setAside.length, 1)
  assert.equal(fs.readFileSync(file, 'utf8'), 'local content that must survive', 'the original is still untouched')
})

test('the CLI runs init, snapshot, verify and restore without DSH', (t) => {
  const root = tempDir('keeper-cli-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  const storeDir = path.join(root, 'store')
  const target = path.join(root, 'restored')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, sessionA)

  const env = { ...process.env, KEEPER_PASSPHRASE: PASS }
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env })
  const parse = (result) => JSON.parse(result.stdout)

  const init = run('init', '--store', storeDir, '--device-name', 'cli-test', '--json')
  assert.equal(init.status, 0, init.stderr)
  assert.equal(parse(init).ok, true)

  const snap = run('snapshot', '--store', storeDir, '--home', home, '--json')
  assert.equal(snap.status, 0, snap.stderr)
  assert.equal(parse(snap).sessions.length, 1)

  const verified = run('verify', '--store', storeDir, '--json')
  assert.equal(verified.status, 0, verified.stderr)
  assert.equal(parse(verified).ok, true)

  const status = run('status', '--store', storeDir, '--json')
  assert.equal(parse(status).published.sessions, 1)

  const restored = run('restore', '--store', storeDir, '--home', target, '--json')
  assert.equal(restored.status, 0, restored.stderr)
  assert.equal(parse(restored).created.length, 1)

  const missingPassphrase = spawnSync(process.execPath, [CLI, 'verify', '--store', storeDir], {
    encoding: 'utf8',
    env: { ...process.env, KEEPER_PASSPHRASE: '' },
  })
  assert.equal(missingPassphrase.status, 2)
  assert.match(missingPassphrase.stderr, /passphrase not set/)
})
