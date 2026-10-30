import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { collectGarbage, compact } from '../lib/compact.js'
import { resolveDevice } from '../lib/device.js'
import { publishedState, snapshot } from '../lib/snapshot.js'
import {
  clearChainCache,
  initStore,
  listDeviceHeads,
  openStore,
  readAllManifests,
  readManifestChain,
} from '../lib/store.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASSPHRASE = 'devices-test-passphrase'

function setup(t) {
  const root = tempDir('keeper-devices-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'creator' })
  t.after(() => {
    clearChainCache()
    removeDir(root)
  })
  const store = openStore(dir, PASSPHRASE)
  const a = { deviceId: 'a'.repeat(32), deviceName: 'device-a' }
  const b = { deviceId: 'b'.repeat(32), deviceName: 'device-b' }
  return { root, home, dir, store, a, b }
}

function publish(store, home, device, id, batches) {
  writeSession(home, { id, log: makeLog({ id, batches }), dirName: device.deviceId.slice(0, 4) + '-' + id })
  return snapshot(store, { home, now: new Date(Date.UTC(2026, 9, 28, 10, 0, 0)).toISOString(), device })
}

test('each device writes its own head and neither clobbers the other', (t) => {
  const { store, home, dir, a, b } = setup(t)

  publish(store, home, a, 'session-a', [[{ type: 'm', n: 'a1' }]])
  publish(store, home, b, 'session-b', [[{ type: 'm', n: 'b1' }]])
  publish(store, home, a, 'session-a', [[{ type: 'm', n: 'a1' }], [{ type: 'm', n: 'a2' }]])

  const heads = listDeviceHeads(dir)
  assert.equal(heads.length, 2, 'one head per device')
  assert.deepEqual(heads.map((head) => head.deviceId).sort(), [a.deviceId, b.deviceId])

  const chainA = readManifestChain(store, { fresh: true, device: a })
  const chainB = readManifestChain(store, { fresh: true, device: b })
  assert.equal(chainA.length, 2, 'device A wrote twice')
  assert.equal(chainB.length, 1, 'device B wrote once, and A did not touch it')

  // The union carries both sessions, whatever the chains look like.
  const union = publishedState(readAllManifests(store, { fresh: true }))
  assert.deepEqual([...union.keys()].sort(), ['session-a', 'session-b'])
  assert.equal(union.get('session-a').bytes > 0, true)
})

test('verification sees every device, and a checkpoint on one leaves the other intact', (t) => {
  const { store, home, dir, a, b } = setup(t)
  publish(store, home, a, 'session-a', [[{ type: 'm', n: 'a1' }]])
  publish(store, home, b, 'session-b', [[{ type: 'm', n: 'b1' }]])

  const before = verifyStore(store)
  assert.equal(before.ok, true, JSON.stringify(before.problems))
  assert.equal(before.totals.sessions, 2)

  const result = compact(store, { device: a, now: '2026-10-28T11:00:00.000Z' })
  assert.equal(result.compacted, true)
  assert.equal(readManifestChain(store, { fresh: true, device: a }).length, 1)
  assert.equal(readManifestChain(store, { fresh: true, device: b }).length, 1, 'B keeps its own chain')
  assert.equal(listDeviceHeads(dir).length, 2)

  const after = verifyStore(store)
  assert.equal(after.ok, true, JSON.stringify(after.problems))
  assert.equal(after.totals.sessions, 2, 'compacting one device must not drop the other sessions')
})

test('garbage collection keeps what the other device still references', (t) => {
  const { store, home, dir, a, b } = setup(t)
  publish(store, home, a, 'session-a', [[{ type: 'm', n: 'a1' }]])
  publish(store, home, b, 'session-b', [[{ type: 'm', n: 'b1' }]])
  compact(store, { device: a, now: '2026-10-28T11:00:00.000Z' })

  const dry = collectGarbage(store, { dryRun: true })
  assert.ok(dry.removable >= 0)

  const real = collectGarbage(store, { dryRun: false, yes: true })
  assert.ok(real.deleted >= 0)
  const verified = verifyStore(store)
  assert.equal(verified.ok, true, 'gc must never remove something a head still points at: ' + JSON.stringify(verified.problems))
  assert.equal(verified.totals.sessions, 2)
  assert.equal(fs.existsSync(path.join(dir, 'devices')), true)
})

test('a store written before devices existed keeps one continuous chain', (t) => {
  const { store, home, a } = setup(t)
  // Legacy write: no device, exactly what rc.17 did.
  writeSession(home, { id: 'legacy', log: makeLog({ id: 'legacy', batches: [[{ type: 'm', n: 'l1' }]] }) })
  snapshot(store, { home, now: '2026-10-28T09:00:00.000Z' })
  assert.equal(readManifestChain(store, { fresh: true }).length, 1)

  // The first device adopts the legacy head instead of starting a second chain.
  publish(store, home, a, 'session-a', [[{ type: 'm', n: 'a1' }]])
  assert.equal(readManifestChain(store, { fresh: true, device: a }).length, 2, 'adopted, not forked')
  const union = publishedState(readAllManifests(store, { fresh: true }))
  assert.deepEqual([...union.keys()].sort(), ['legacy', 'session-a'])
})

test('the device identity is stable across calls and lives in the home', (t) => {
  const { root } = setup(t)
  const configDir = path.join(root, 'config')
  const first = resolveDevice({ configDir, deviceName: 'pc-a' })
  const second = resolveDevice({ configDir, deviceName: 'pc-a' })
  assert.equal(first.deviceId, second.deviceId)
  assert.equal(first.deviceName, 'pc-a')
  assert.equal(fs.existsSync(path.join(configDir, 'history-keeper-device.json')), true)
})
