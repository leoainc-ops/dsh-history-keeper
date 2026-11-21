import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { buildMountReceipt, writeReceipt } from '../core/receipt.js'

function sampleReport() {
  return {
    mode: 'uso',
    home: 'C:\\Users\\x\\.dsh',
    plan: {
      sessions: [
        { sessionId: 'session-a', action: 'nueva', bytes: 2048, cwd: 'C:\\work\\local', translated: true },
        { sessionId: 'session-b', action: 'nueva', bytes: 512, cwd: 'C:\\work\\b', translated: false },
      ],
      totals: { sessions: 2 },
    },
    published: [{ sessionId: 'session-a', sealMatched: true }, { sessionId: 'session-b', sealMatched: false }],
    attached: [{ sessionId: 'session-a', status: 'attached' }],
    created: [],
    identical: [],
    refused: [],
    skipped: [],
    failed: [],
  }
}

test('the receipt says what happened, how it was verified and how to undo it', () => {
  const text = buildMountReceipt({ report: sampleReport(), vault: { storeId: 'store-1', deviceName: 'pc-a' }, now: '2026-11-21T00:00:00.000Z' })
  assert.match(text, /# Recibo de montaje/)
  assert.match(text, /`uso`/)
  assert.match(text, /store-1/)
  assert.match(text, /pc-a/)
  assert.match(text, /session-a/)
  assert.match(text, /session-b/)
  assert.match(text, /traducido/)
  assert.match(text, /1 de 2/)
  assert.match(text, /keeper mount --undo/)
})

test('the receipt never contains the passphrase', () => {
  const text = buildMountReceipt({ report: sampleReport(), vault: { storeId: 'store-1' } })
  assert.equal(/passphrase|frase|Poli<>/i.test(text), false)
})

test('writing the receipt creates a dated file under the home', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-receipt-'))
  const file = writeReceipt(home, 'contenido', '2026-11-21T00-00-00-000Z')
  assert.ok(file.startsWith(path.join(home, 'history-keeper-receipts')))
  assert.ok(file.endsWith('.md'))
  assert.equal(fs.readFileSync(file, 'utf8'), 'contenido')
})
