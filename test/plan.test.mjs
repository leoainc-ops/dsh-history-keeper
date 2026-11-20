import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { attachmentTarget, buildPlan } from '../core/plan.js'
import { openStore } from '../core/store.js'
import { collectSessions } from '../core/verify.js'

const FIXTURE = path.join(import.meta.dirname, '..', 'conformance', 'fixture', 'vault')
const PASSPHRASE = 'conformance-test-passphrase'

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-plan-'))

function fixture() {
  const store = openStore(FIXTURE, PASSPHRASE)
  const { sessions } = collectSessions(store)
  return { store, sessions: [...sessions.values()] }
}

test('an empty home plans every session as new', () => {
  const { store, sessions } = fixture()
  const home = tempHome()
  const plan = buildPlan({ store, home })

  assert.equal(plan.mode, 'archivo')
  assert.equal(plan.totals.sessions, sessions.length)
  assert.equal(plan.totals.nueva, sessions.length)
  assert.equal(plan.totals.identica, 0)
  assert.ok(plan.totals.bytesToWrite > 0)
  for (const entry of plan.sessions) {
    assert.equal(entry.action, 'nueva')
    assert.ok(entry.targetPath.startsWith(path.join(home, 'sessions')), entry.targetPath)
  }
  assert.equal(plan.blocks.length, 0)
})

test('a session already in place is identical, and a different one is divergent', () => {
  const { store, sessions } = fixture()
  const home = tempHome()
  const first = buildPlan({ store, home }).sessions[0]
  const session = sessions.find((item) => item.sessionId === first.sessionId)

  fs.mkdirSync(path.dirname(first.targetPath), { recursive: true })
  fs.writeFileSync(first.targetPath, session.buffer)
  assert.equal(buildPlan({ store, home }).sessions.find((s) => s.sessionId === first.sessionId).action, 'identica')

  fs.writeFileSync(first.targetPath, Buffer.concat([session.buffer, Buffer.from('extra')]))
  assert.equal(buildPlan({ store, home }).sessions.find((s) => s.sessionId === first.sessionId).action, 'divergente')
})

test('translation maps the original cwd to a local one and marks the session', () => {
  const { store, sessions } = fixture()
  const home = tempHome()
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-work-'))
  const originalCwd = sessions[0].header.cwd
  const plan = buildPlan({ store, home, translate: { [originalCwd]: local } })
  const entry = plan.sessions.find((item) => item.sessionId === sessions[0].sessionId)

  assert.equal(entry.translated, true)
  assert.equal(entry.originalCwd, originalCwd)
  assert.equal(entry.cwd, local)
  assert.ok(entry.targetPath.includes(path.basename(local).replace(/[^a-zA-Z0-9]/gu, '-')) || entry.targetPath.includes('--'))
})

test('native mode refuses to plan a session whose cwd does not exist on this host', () => {
  const { store, sessions } = fixture()
  const home = tempHome()
  const plan = buildPlan({ store, home, mode: 'uso' })
  const entry = plan.sessions.find((item) => item.sessionId === sessions[0].sessionId)
  // The fixture's cwd (C:\work\conformance) is synthetic and does not exist anywhere.
  assert.equal(entry.action, 'sin-destino')
  assert.match(entry.reason, /does not exist/)
  assert.equal(plan.totals.sinDestino, plan.totals.sessions)
})

test('a reader that cannot read the session marks it unreadable instead of new', () => {
  const { store, sessions } = fixture()
  const home = tempHome()
  const plan = buildPlan({ store, home, reader: () => ({ readable: false, unknown: ['something/new'] }) })
  const entry = plan.sessions.find((item) => item.sessionId === sessions[0].sessionId)
  assert.equal(entry.action, 'ilegible')
  assert.deepEqual(entry.unknown, ['something/new'])
  assert.equal(plan.warnings[0].code, 'UNKNOWN_EVENTS')
})

test('attachments are planned as present or to create', () => {
  const { store } = fixture()
  const home = tempHome()
  const hash = 'ab'.repeat(32)
  assert.equal(buildPlan({ store, home, attachments: [{ hash, bytes: 4 }] }).attachments[0].action, 'crear')

  const target = attachmentTarget(home, hash)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, 'blob')
  assert.equal(buildPlan({ store, home, attachments: [{ hash, bytes: 4 }] }).attachments[0].action, 'presente')
})
