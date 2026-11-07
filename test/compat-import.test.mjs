import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { exportVault } from '../lib/export.js'
import { importVault } from '../lib/import.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const LOCAL = 'local-passphrase-1234'
const REMOTE = 'remote-passphrase-1234'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-local' }

function build(t, remoteEvents = []) {
  const root = tempDir('keeper-compat-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })

  const localDir = path.join(root, 'vault-local')
  initStore(localDir, { passphrase: LOCAL, deviceName: 'pc-local' })
  const localStore = openStore(localDir, LOCAL)
  writeSession(home, { id: 'shared', log: makeLog({ id: 'shared', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  snapshot(localStore, { home, now: '2026-11-03T10:00:00.000Z', device: { deviceId: 'aa'.repeat(16), deviceName: 'pc-local' } })

  const otherHome = path.join(root, 'other-home')
  fs.mkdirSync(otherHome, { recursive: true })
  const remoteDir = path.join(root, 'vault-remote')
  initStore(remoteDir, { passphrase: REMOTE, deviceName: 'pc-remote' })
  const remoteStore = openStore(remoteDir, REMOTE)
  writeSession(otherHome, {
    id: 'remote-one',
    log: makeLog({ id: 'remote-one', batches: [[{ type: 'turn/start' }], ...remoteEvents, [{ type: 'turn/end' }]] }),
  })
  snapshot(remoteStore, { home: otherHome, now: '2026-11-03T11:00:00.000Z', device: { deviceId: 'bb'.repeat(16), deviceName: 'pc-remote' } })

  const stick = path.join(root, 'stick')
  exportVault({ store: remoteStore, passphrase: REMOTE, to: stick })

  t.after(() => removeDir(root))
  return { root, home, localStore, remoteStore, stick }
}

test('import refuses a carried vault written in an unknown format', (t) => {
  const { localStore } = build(t)
  const fake = { meta: { format: 'dsh-history-keeper/store/2' }, dir: '/nowhere', key: Buffer.alloc(0) }
  assert.throws(
    () => importVault({ stickStore: fake, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, device: DEVICE }),
    /uses format dsh-history-keeper\/store\/2/,
  )
})

test('the prepare step reports which sessions this host cannot read', (t) => {
  const { home, localStore, stick } = build(t, [[{ type: 'brand-new-event' }]])
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  const report = importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, home, device: DEVICE })

  assert.equal(report.preflight.readable, 1, 'the shared session is readable')
  const unreadable = report.preflight.unreadable.map((item) => item.sessionId)
  assert.deepEqual(unreadable, ['remote-one'])
  assert.deepEqual(report.preflight.unreadable[0].unknownEvents, ['brand-new-event'])
})

test('an old vault with no unknown events is fully readable', (t) => {
  const { home, localStore, stick } = build(t)
  const stickStore = openStore(path.join(stick, 'vault'), REMOTE)
  const report = importVault({ stickStore, localStore, localPassphrase: LOCAL, stickPassphrase: REMOTE, home, device: DEVICE })
  assert.equal(report.preflight.unreadable.length, 0)
  assert.equal(report.preflight.readable, report.merge.sessions)
})

void fs
