import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { snapshot } from '../lib/snapshot.js'
import { clearChainCache, chainCacheSize, initStore, openStore, readManifestChain } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'chain-cache-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-chain-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'chain-test' })
  t.after(() => {
    clearChainCache()
    removeDir(root)
  })
  const store = openStore(dir, PASSPHRASE)
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }]] }) })
  snapshot(store, { home, now: '2026-10-24T10:00:00.000Z' })
  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }], [{ type: 'b' }]] }) })
  snapshot(store, { home, now: '2026-10-24T10:00:40.000Z' })
  return { store, home, dir }
}

test('a second read is served from the cache and returns an independent copy', (t) => {
  const { store } = setup(t)
  clearChainCache()
  const first = readManifestChain(store)
  assert.equal(first.length, 2)
  assert.equal(chainCacheSize(), 1)

  const second = readManifestChain(store)
  assert.equal(second.length, 2)
  assert.notEqual(first, second, 'callers must not share the cached array')
  first.push({ marker: true })
  assert.equal(readManifestChain(store).length, 2, 'mutating a returned array must not poison the cache')
})

test('a write invalidates the cache by moving the head', (t) => {
  const { store, home } = setup(t)
  clearChainCache()
  assert.equal(readManifestChain(store).length, 2)

  writeSession(home, { id: 's1', log: makeLog({ id: 's1', batches: [[{ type: 'a' }], [{ type: 'b' }], [{ type: 'c' }]] }) })
  snapshot(store, { home, now: '2026-10-24T10:02:00.000Z' })

  assert.equal(readManifestChain(store).length, 3, 'the new head must not be served from a stale entry')
})

test('a fresh read goes to disk even when the cache is warm', (t) => {
  const { store, dir } = setup(t)
  clearChainCache()
  const chain = readManifestChain(store)
  assert.equal(chain.length, 2)

  // Delete the object that the newest manifest is sealed in, then compare both read paths.
  const head = fs
    .readdirSync(path.join(dir, 'objects'))
    .map((name) => path.join(dir, 'objects', name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  fs.rmSync(head[0])

  assert.equal(readManifestChain(store).length, 2, 'the cached read cannot see the deletion')
  assert.throws(() => readManifestChain(store, { fresh: true }), /missing|not found|ENOENT|object/i)
})

test('clearing the cache forgets every chain', (t) => {
  const { store } = setup(t)
  readManifestChain(store)
  assert.ok(chainCacheSize() >= 1)
  clearChainCache()
  assert.equal(chainCacheSize(), 0)
})
