import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { buildCatalog } from '../lib/catalog.js'
import { conformVault } from '../lib/conform.js'
import { extractSession } from '../lib/extract.js'
import { restore } from '../lib/restore.js'
import { initStore, openStore } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { collectSessions, verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'gaps-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-test' }

function setup(t, options = {}) {
  const root = tempDir('keeper-gaps-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)
  writeSession(home, {
    id: 's1',
    cwd: 'C:\\work\\gaps',
    log: makeLog({ id: 's1', cwd: 'C:\\work\\gaps', batches: [[{ type: 'turn/start', data: { turn: 1 }, time: 100 }], [{ type: 'turn/end', data: { turn: 1 }, time: 200 }]] }),
  })
  snapshot(store, { home, now: '2026-11-08T10:00:00.000Z', device: DEVICE, ...(options.snapshot ?? {}) })
  t.after(() => removeDir(root))
  return { root, home, dir, store }
}

test('conform validates a good vault, including the byte-for-byte restore', (t) => {
  const { store } = setup(t)
  const report = conformVault(store, { passphrase: PASS })
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((item) => !item.ok)))
  const names = report.checks.map((item) => item.name)
  for (const name of ['verify is ok', 'restores every session', 'restores byte for byte', 'refuses a wrong passphrase', 'refuses a vault that asks for a newer format', 'this reader can open the vault']) {
    assert.ok(names.includes(name), 'falta el chequeo: ' + name)
  }
  assert.equal(report.totals.sessions, 1)
})

test('conform fails a vault that this reader cannot open', (t) => {
  const { dir } = setup(t)
  const metaPath = path.join(dir, 'meta.json')
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
  meta.minReader = { format: 'dsh-history-keeper/store/9000', plugin: '99.0.0' }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf8')

  const report = conformVault(openStore(dir, PASS), { passphrase: PASS })
  assert.equal(report.ok, false, 'a reader that cannot open the vault does not conform it')
  const readerCheck = report.checks.find((item) => item.name === 'this reader can open the vault')
  assert.equal(readerCheck.ok, false)
  assert.match(readerCheck.detail, /FORMAT_TOO_NEW/)
})

test('the catalog reports the hash of each session as it restores', (t) => {
  const { dir, store } = setup(t)
  const catalog = buildCatalog(store)
  const row = catalog.sessions[0]
  assert.match(row.sha256, /^[0-9a-f]{64}$/)

  const home = path.join(dir, 'restore-home')
  const restored = restore(store, { home })
  const bytes = fs.readFileSync(restored.created[0].target)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256)

  assert.equal(catalog.store.host.contract, 'dsh session log')
  assert.equal(catalog.store.host.formatVersion, 4)
})

test('extract --raw writes the exact session file', (t) => {
  const { root, store } = setup(t)
  const session = collectSessions(store).sessions.get('s1')
  const out = path.join(root, 's1.jsonl.zstd')
  const report = extractSession(store, { sessionId: 's1', out, format: 'raw' })
  assert.equal(report.format, 'raw')
  assert.equal(fs.readFileSync(out).equals(session.buffer), true, "the bytes are the host's own log")
})

test('a raw extraction of a session with a credential is refused unless forced', (t) => {
  const secret = ['sk', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3h2G1f0'].join('-')
  const { root, store } = setup(t)
  const home = path.join(root, 'secret-home')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, {
    id: 's2',
    cwd: 'C:\\work\\secret',
    log: makeLog({
      id: 's2',
      cwd: 'C:\\work\\secret',
      batches: [
        [{ type: 'turn/start', data: { turn: 1 }, time: 100 }],
        [{ type: 'user/message', data: { content: [{ type: 'text', text: 'mi clave ' + secret }] }, time: 150 }],
        [{ type: 'turn/end', data: { turn: 1 }, time: 200 }],
      ],
    }),
  })
  // Captured without the gate: the point is that `raw` does not bypass the extraction gate.
  snapshot(store, { home, now: '2026-11-08T11:00:00.000Z', device: DEVICE, secretScan: false })
  assert.equal(verifyStore(store).ok, true)

  const out = path.join(root, 's2.jsonl.zstd')
  assert.throws(() => extractSession(store, { sessionId: 's2', out, format: 'raw' }), /credential|openai/)
  assert.equal(fs.existsSync(out), false)
  assert.doesNotThrow(() => extractSession(store, { sessionId: 's2', out, format: 'raw', force: true }))
})
