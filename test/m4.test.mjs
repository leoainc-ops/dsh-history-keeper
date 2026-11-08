import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { extractSession } from '../lib/extract.js'
import { decodePayload } from '../lib/payload.js'
import { renderSession } from '../lib/render.js'
import { snapshot } from '../lib/snapshot.js'
import { initStore, openStore } from '../lib/store.js'
import { collectSessions } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const PASS = 'm4-test-passphrase'
const DEVICE = { deviceId: 'aa'.repeat(16), deviceName: 'pc-test' }

function setup(t, batches = null, snapshotOptions = {}) {
  const root = tempDir('keeper-m4-')
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  const dir = path.join(root, 'vault')
  initStore(dir, { passphrase: PASS, deviceName: 'pc-test' })
  const store = openStore(dir, PASS)
  const log =
    batches ??
    [
      [{ type: 'turn/start', data: { turn: 1 }, time: 1000 }],
      [{ type: 'step/start', data: { turn: 1, step: 1 }, time: 1100 }],
      [{ type: 'user/message', data: { content: [{ type: 'text', text: 'hola, mirá el manifiesto' }] }, time: 1200 }],
      [{ type: 'session/title', data: { title: 'Prueba de extracción' }, time: 1250 }],
      [{ type: 'step/end', data: { turn: 1, step: 1 }, time: 1300 }],
      [{ type: 'step/start', data: { turn: 1, step: 2 }, time: 1400 }],
      [
        {
          type: 'assistant/message',
          data: {
            turn: 1,
            step: 2,
            message: {
              role: 'assistant',
              content: [
                { type: 'reasoning', text: 'the manifest is a text file' },
                { type: 'text', text: 'Lo leí: es un manifiesto de decompilación.' },
                { type: 'tool-call', id: 'c1', name: 'glob', arguments: '{"pattern":"*"}' },
              ],
            },
          },
          time: 1500,
        },
      ],
      [{ type: 'tool/call', data: { turn: 1, step: 2, callId: 'c1', name: 'glob', arguments: '{"pattern":"*"}' }, time: 1510 }],
      [{ type: 'tool/result', data: { turn: 1, step: 2, message: { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: 'manifiesto.md' }], isError: false } }, time: 1520 }],
      [{ type: 'step/end', data: { turn: 1, step: 2 }, time: 1600 }],
      [{ type: 'turn/end', data: { turn: 1 }, time: 1700 }],
      [{ type: 'some/future-event', data: { turn: 1 }, time: 1800 }],
    ]
  writeSession(home, { id: 's1', cwd: 'G:\\work\\m4', log: makeLog({ id: 's1', cwd: 'G:\\work\\m4', batches: log }) })
  snapshot(store, { home, now: '2026-11-08T10:00:00.000Z', device: DEVICE, ...snapshotOptions })
  t.after(() => removeDir(root))
  return { root, home, dir, store }
}

test('the renderer turns a log into a readable transcript', (t) => {
  const { store } = setup(t)
  const session = collectSessions(store).sessions.get('s1')
  const rendered = renderSession(session.buffer)
  assert.equal(rendered.ok, true)
  assert.match(rendered.text, /^# PLAINTEXT COPY/)
  assert.match(rendered.text, /session: s1/)
  assert.match(rendered.text, /workspace: G:\\work\\m4/)
  assert.match(rendered.text, /- title: Prueba de extracción/)
  assert.match(rendered.text, /## Turn 1/)
  assert.match(rendered.text, /### user/)
  assert.match(rendered.text, /hola, mirá el manifiesto/)
  assert.match(rendered.text, /### assistant/)
  assert.match(rendered.text, /Lo leí: es un manifiesto/)
  assert.match(rendered.text, /reasoning/)
  assert.match(rendered.text, /tool call: glob/)
  assert.match(rendered.text, /tool result: manifiesto\.md/)
  assert.match(rendered.text, /some\/future-event/, 'unknown events are noted, never fatal')
  assert.equal(rendered.stats.users, 1)
  assert.equal(rendered.stats.assistants, 1)
  assert.equal(rendered.stats.toolCalls, 1, 'the same call is not printed twice')
  assert.equal(rendered.stats.toolResults, 1)
  assert.deepEqual(rendered.stats.unknown, ['some/future-event'])
})

test('extract writes the transcript outside the vault, with the plaintext warning', (t) => {
  const { root, store } = setup(t)
  const out = path.join(root, 'out', 's1.md')
  const report = extractSession(store, { sessionId: 's1', out, format: 'readable' })
  assert.equal(fs.existsSync(out), true)
  const text = fs.readFileSync(out, 'utf8')
  assert.equal(text.charCodeAt(0), 0xfeff, 'a readable copy carries a BOM for Windows tools')
  assert.match(text, /^\uFEFF?# PLAINTEXT COPY — not protected by the vault/)
  assert.equal(report.bytes, Buffer.byteLength(text.replace(/^\uFEFF/, ''), 'utf8'))
  assert.ok(report.lines > 10)
})

test('extract --jsonl writes the decompressed log and nothing else', (t) => {
  const { root, store } = setup(t)
  const out = path.join(root, 's1.jsonl')
  extractSession(store, { sessionId: 's1', out, format: 'jsonl' })
  const session = collectSessions(store).sessions.get('s1')
  const expected = decodePayload(session.buffer).text
  assert.equal(fs.readFileSync(out, 'utf8'), expected)
})

test('extract refuses the vault, an existing file, and a missing --out', (t) => {
  const { root, store } = setup(t)
  assert.throws(() => extractSession(store, { sessionId: 's1', format: 'readable' }), /--out/)
  assert.throws(() => extractSession(store, { sessionId: 's1', out: path.join(store.dir, 'x.md') }), /refusing to write plaintext inside/)
  const out = path.join(root, 'once.md')
  extractSession(store, { sessionId: 's1', out, format: 'readable' })
  assert.throws(() => extractSession(store, { sessionId: 's1', out, format: 'readable' }), /already exists/)
  // The operator can replace it on purpose.
  assert.doesNotThrow(() => extractSession(store, { sessionId: 's1', out, format: 'readable', force: true }))
})

test('the secret gate stops an extraction unless --force is given', (t) => {
  const secret = ['sk', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'].join('-')
  // Captured without the gate on purpose: the point here is the *extraction* gate. A real capture
  // would quarantine this session (and the test above proves that path separately).
  const { root, store } = setup(
    t,
    [
      [{ type: 'turn/start', data: { turn: 1 }, time: 1000 }],
      [{ type: 'user/message', data: { content: [{ type: 'text', text: 'mi clave es ' + secret }] }, time: 1100 }],
      [{ type: 'turn/end', data: { turn: 1 }, time: 1200 }],
    ],
    { secretScan: false },
  )
  const out = path.join(root, 'with-secret.md')
  assert.throws(() => extractSession(store, { sessionId: 's1', out, format: 'readable' }), /credential|openai/)
  assert.equal(fs.existsSync(out), false, 'nothing was written')

  const forced = extractSession(store, { sessionId: 's1', out, format: 'readable', force: true })
  assert.equal(fs.existsSync(out), true)
  assert.ok(forced.secretRules.length > 0)
  assert.match(fs.readFileSync(out, 'utf8'), /PLAINTEXT COPY/)
})
