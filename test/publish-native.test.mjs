import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import { contentSeal, parseSessionLog, publishNative } from '../host/publish-native.js'
import { openStore } from '../core/store.js'
import { collectSessions } from '../core/verify.js'

const FIXTURE = path.join(import.meta.dirname, '..', 'conformance', 'fixture', 'vault')
const PASSPHRASE = 'conformance-test-passphrase'

function fixtureSession() {
  const store = openStore(FIXTURE, PASSPHRASE)
  const session = [...collectSessions(store).sessions.values()][0]
  return { sessionId: session.sessionId, header: session.header, buffer: session.buffer }
}

/** A host that behaves like the real writer: ids cannot be reused, appends are kept in order. */
function fakePersistence() {
  const records = new Map()
  return {
    records,
    async create(header) {
      if (records.has(header.id)) {
        const error = new Error('session "' + header.id + '" already exists')
        error.name = 'SessionAlreadyExistsError'
        throw error
      }
      const record = { header, events: [], flushed: false }
      records.set(header.id, record)
      return {
        async append(batch) {
          record.events.push(...batch)
        },
        async flush() {
          record.flushed = true
        },
        async close() {},
      }
    },
    async stat(id) {
      const record = records.get(id)
      return record ? { header: record.header, sizeBytes: record.events.length } : undefined
    },
  }
}

test('parseSessionLog separates the header and checks the seq is contiguous', () => {
  const parsed = parseSessionLog(fixtureSession().buffer)
  assert.equal(parsed.ok, true, parsed.message)
  assert.equal(parsed.header?.type, 'session')
  assert.ok(parsed.events.length > 0)
  assert.deepEqual(parsed.events.map((event) => event.seq), parsed.events.map((_, index) => index + 1))
})

test('publishNative creates the session with the original id and the translated cwd', async () => {
  const session = fixtureSession()
  const persistence = fakePersistence()
  const local = 'C:\\Users\\someone\\work\\translated'

  const report = await publishNative({
    session,
    persistence,
    cwd: local,
    readEvents: (id) => persistence.records.get(id)?.events,
  })

  assert.equal(report.status, 'created', report.message)
  const record = persistence.records.get(session.sessionId)
  assert.equal(record.header.id, session.sessionId)
  assert.equal(record.header.cwd, local)
  assert.equal(record.header.createdAt, session.header.createdAt, 'createdAt is preserved')
  assert.equal(record.flushed, true)
  assert.equal(report.events, record.events.length)
  assert.equal(report.sealMatched, true)
})

test('publishing the same session twice is a no-op, not a duplicate', async () => {
  const session = fixtureSession()
  const persistence = fakePersistence()
  const first = await publishNative({ session, persistence })
  assert.equal(first.status, 'created')
  const second = await publishNative({ session, persistence })
  assert.equal(second.status, 'exists')
  assert.equal(persistence.records.size, 1, 'no second session was created')
})

test('a seal mismatch is reported instead of hidden', async () => {
  const session = fixtureSession()
  const persistence = fakePersistence()
  const report = await publishNative({
    session,
    persistence,
    readEvents: (id) => persistence.records.get(id).events.map((event, index) => (index === 0 ? { ...event, data: { tampered: true } } : event)),
  })
  assert.equal(report.status, 'created')
  assert.equal(report.sealMatched, false)
})

test('without a session writer the publication fails closed', async () => {
  const report = await publishNative({ session: fixtureSession(), persistence: null })
  assert.equal(report.status, 'failed')
  assert.equal(report.code, 'NO_SESSION_WRITER')
})

test('the content seal changes when the conversation changes', () => {
  const parsed = parseSessionLog(fixtureSession().buffer)
  const tampered = parsed.events.map((event, index) => (index === 0 ? { ...event, data: { ...event.data, x: 1 } } : event))
  assert.notEqual(contentSeal(parsed.events), contentSeal(tampered))
  assert.equal(contentSeal(parsed.events), contentSeal(parsed.events))
})
