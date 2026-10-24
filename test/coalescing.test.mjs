import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'coalescing-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-coalesce-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'coalesce-test' })
  t.after(() => removeDir(root))
  return { home, store: openStore(dir, PASSPHRASE), objectsDir: path.join(dir, 'objects') }
}

const T0 = '2026-10-24T10:00:00.000Z'
const T_PLUS_5S = '2026-10-24T10:00:05.000Z'
const T_PLUS_31S = '2026-10-24T10:00:31.000Z'

function grow(home) {
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }], [{ type: 'b' }]] }) })
}

test('a flush inside the coalescing window publishes nothing, and the same bytes publish after it', (t) => {
  const { home, store, objectsDir } = setup(t)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }]] }) })

  const first = snapshot(store, { home, now: T0, minIntervalMs: 30_000 })
  assert.equal(first.sessions.length, 1)
  const objectsAfterFirst = fs.readdirSync(objectsDir).length
  assert.ok(objectsAfterFirst > 0, 'the first snapshot must write objects')

  grow(home)
  const second = snapshot(store, { home, now: T_PLUS_5S, minIntervalMs: 30_000 })
  const throttled = second.skipped.find((item) => item.sessionId === 's1')
  assert.equal(second.sessions.length, 0)
  assert.equal(throttled.code, 'THROTTLED')
  assert.equal(throttled.retryInMs, 25_000)
  assert.equal(fs.readdirSync(objectsDir).length, objectsAfterFirst, 'a throttled session must write nothing')

  const third = snapshot(store, { home, now: T_PLUS_31S, minIntervalMs: 30_000 })
  assert.equal(third.sessions.length, 1, 'once the window opens the pending bytes are published')
})

test('force publishes inside the window', (t) => {
  const { home, store, objectsDir } = setup(t)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }]] }) })
  snapshot(store, { home, now: T0, minIntervalMs: 30_000 })
  const before = fs.readdirSync(objectsDir).length

  grow(home)
  const forced = snapshot(store, { home, now: T_PLUS_5S, minIntervalMs: 30_000, force: true })
  assert.equal(forced.sessions.length, 1)
  assert.ok(fs.readdirSync(objectsDir).length > before)
})

test('a disabled window behaves like before', (t) => {
  const { home, store } = setup(t)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }]] }) })
  snapshot(store, { home, now: T0, minIntervalMs: 0 })
  grow(home)
  const second = snapshot(store, { home, now: T_PLUS_5S, minIntervalMs: 0 })
  assert.equal(second.sessions.length, 1)
})
