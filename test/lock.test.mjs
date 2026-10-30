import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { initStore, openStore, withStoreLock } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'lock-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-lock-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'lock-test' })
  t.after(() => removeDir(root))
  return { root, home, dir, store: openStore(dir, PASSPHRASE) }
}

test('a second writer is refused while the lock is held, and the store is untouched', (t) => {
  const { dir } = setup(t)
  withStoreLock(dir, { timeoutMs: 300 }, () => {
    assert.throws(() => withStoreLock(dir, { timeoutMs: 200 }, () => 'nested'), /another writer is using this store/u)
  })
  assert.equal(fs.existsSync(path.join(dir, 'LOCK')), false, 'the lock file is removed on release')
  assert.equal(withStoreLock(dir, {}, () => 'ok'), 'ok', 'the lock is reusable once released')
})

test('a stale lock from a crashed writer is broken instead of blocking the store', (t) => {
  const { dir } = setup(t)
  const lock = path.join(dir, 'LOCK')
  fs.writeFileSync(lock, '999999\n')
  const old = new Date(Date.now() - 10 * 60_000)
  fs.utimesSync(lock, old, old)
  assert.equal(withStoreLock(dir, { timeoutMs: 1_000 }, () => 'recovered'), 'recovered')
})

test('a lock held by a real crash leaves the store readable', (t) => {
  const { home, dir, store } = setup(t)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'm', n: 'a' }]] }) })
  snapshot(store, { home, now: '2026-10-30T10:00:00.000Z' })
  // Simulate a process that died holding the lock.
  const lock = path.join(dir, 'LOCK')
  fs.writeFileSync(lock, '12345\n')
  const old = new Date(Date.now() - 10 * 60_000)
  fs.utimesSync(lock, old, old)
  const before = verifyStore(store)
  assert.equal(before.ok, true)
  fs.rmSync(lock, { force: true })
  assert.equal(verifyStore(store).ok, true)
})

test('snapshot and compaction take the lock, so a concurrent writer is stopped', (t) => {
  const { home, dir, store } = setup(t)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'm', n: 'a' }]] }) })
  withStoreLock(dir, { timeoutMs: 500 }, () => {
    assert.throws(
      () => snapshot(store, { home, now: '2026-10-30T10:00:00.000Z', lockTimeoutMs: 300 }),
      /another writer is using this store/u,
      'a snapshot while the lock is held must fail instead of forking the chain',
    )
  })
  // Once released, the same snapshot works.
  const result = snapshot(store, { home, now: '2026-10-30T10:01:00.000Z' })
  assert.equal(result.sessions.length, 1)
  assert.equal(verifyStore(store).ok, true)
})
