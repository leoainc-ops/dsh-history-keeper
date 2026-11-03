import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { initStore, openStore, readDeviceHead, writeManifest } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'concurrent-test-passphrase'
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'keeper.js')
const DEVICE = { deviceId: 'd'.repeat(32), deviceName: 'pc-test' }

test('a write prepared against a moved head is refused, not silently orphaned', (t) => {
  const root = tempDir('keeper-cas-')
  t.after(() => removeDir(root))
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)

  const first = writeManifest(store, { deviceId: DEVICE.deviceId, device: DEVICE, sessions: {}, createdAt: '2026-11-02T10:00:00.000Z' })
  assert.ok(first.ref.id)

  // A caller that prepared its payload against no head at all is stale now.
  assert.throws(
    () => writeManifest(store, { deviceId: DEVICE.deviceId, device: DEVICE, sessions: {}, expectHead: null }),
    /head moved/,
  )
  // The head it should have used is accepted.
  const second = writeManifest(store, {
    deviceId: DEVICE.deviceId,
    device: DEVICE,
    sessions: {},
    expectHead: first.ref.id,
    createdAt: '2026-11-02T10:01:00.000Z',
  })
  assert.equal(readDeviceHead(dir, DEVICE.deviceId).head.id, second.ref.id)
})

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

test('two processes snapshotting at once never leave a hole in the chain', async (t) => {
  const root = tempDir('keeper-race-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  const dir = path.join(root, 'vault')
  fs.mkdirSync(home, { recursive: true })
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })

  const keyFile = path.join(root, 'key.txt')
  fs.writeFileSync(keyFile, PASS + '\n')
  const env = { DSH_HOME: home }

  // One session that grows between rounds: the writers always have something to publish.
  const batches = [[{ type: 'turn/start', time: 1000 }]]
  const write = () =>
    writeSession(home, {
      id: 'session-race',
      dirName: 'race',
      log: makeLog({ id: 'session-race', cwd: 'C:\\work\\race', batches }),
    })

  write()
  await runCli(['snapshot', '--store', dir, '--key-file', keyFile, '--home', home, '--device-name', 'pc-test'], env)

  for (let round = 0; round < 6; round += 1) {
    batches.push([{ type: 'round/' + round, time: 2000 + round }])
    write()
    await Promise.all([
      runCli(['snapshot', '--store', dir, '--key-file', keyFile, '--home', home, '--device-name', 'pc-test'], env),
      runCli(['snapshot', '--store', dir, '--key-file', keyFile, '--home', home, '--device-name', 'pc-test'], env),
    ])
  }

  const store = openStore(dir, PASS)
  const verified = verifyStore(store)
  assert.equal(verified.ok, true, 'problems: ' + JSON.stringify(verified.problems))
  assert.equal(verified.totals.sessions, 1)
})
