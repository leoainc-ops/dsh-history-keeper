import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { runDoctor } from '../lib/doctor.js'
import { incomingPath } from '../lib/journal.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'doctor-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-test' }

function setup(t) {
  const root = tempDir('keeper-doctor-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)
  writeSession(home, {
    id: 's1',
    cwd: 'C:\\work\\doctor',
    log: makeLog({ id: 's1', cwd: 'C:\\work\\doctor', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'turn/end', data: { turn: 1 }, time: 200 }]] }),
  })
  snapshot(store, { home, now: '2026-11-09T10:00:00.000Z', device: DEVICE })
  t.after(() => removeDir(root))
  return { root, home, dir, store }
}

test('the doctor reports a healthy vault and what it consumes', (t) => {
  const { home, store } = setup(t)
  const report = runDoctor(store, { home })
  assert.equal(report.ok, true)
  const ids = report.findings.map((item) => item.id)
  assert.ok(ids.includes('verify'))
  assert.ok(ids.includes('garbage'))
  assert.ok(ids.includes('chain'))
  assert.ok(ids.includes('size'))
  const verify = report.findings.find((item) => item.id === 'verify')
  assert.equal(verify.level, 'ok')
  assert.ok(report.totals.vaultBytes > 0)
  assert.ok(report.totals.storedBytes > 0)
})

test('the doctor flags a leftover staged copy and the space it holds', (t) => {
  const { home, store } = setup(t)
  const leftover = path.join(home, 'history-keeper.incoming.imported-2026-11-01T00-00-00-000Z')
  fs.mkdirSync(leftover, { recursive: true })
  fs.writeFileSync(path.join(leftover, 'big.bin'), Buffer.alloc(2048))

  const report = runDoctor(store, { home })
  const finding = report.findings.find((item) => item.id === 'leftover' && item.message.includes('history-keeper.incoming.imported-'))
  assert.ok(finding, 'the leftover must be reported')
  assert.equal(finding.level, 'reclaim')
  assert.ok(report.totals.reclaimableBytes >= 2048)
})

test('the doctor reports the drop box and the undo window when they exist', (t) => {
  const { home, store } = setup(t)
  const box = incomingPath(home)
  fs.mkdirSync(path.join(box, 'objects'), { recursive: true })
  fs.writeFileSync(path.join(box, 'meta.json'), '{}')

  const report = runDoctor(store, { home })
  const boxFinding = report.findings.find((item) => item.id === 'leftover' && item.message.includes('history-keeper.incoming'))
  assert.ok(boxFinding, 'the drop box must be reported')
  assert.match(boxFinding.message, /import or remove/)
})
