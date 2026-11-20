import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { mountSessions } from '../lib/mount.js'
import { emptyTranslations, addTranslation } from '../core/translations.js'
import { openStore } from '../core/store.js'
import { collectSessions } from '../core/verify.js'

const FIXTURE = path.join(import.meta.dirname, '..', 'conformance', 'fixture', 'vault')
const PASSPHRASE = 'conformance-test-passphrase'

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-mount-'))
const store = () => openStore(FIXTURE, PASSPHRASE)

function fakeHost() {
  const records = new Map()
  const workspaces = new Map()
  const wrap = (record) => ({
    id: record.id,
    get sessionIds() {
      return record.sessionIds
    },
    async attachSession(sessionId) {
      if (record.sessionIds.includes(sessionId)) throw new Error('session already belongs to this workspace')
      record.sessionIds.push(sessionId)
    },
  })
  return {
    persistence: {
      async create(header) {
        if (records.has(header.id)) {
          const error = new Error('session "' + header.id + '" already exists')
          error.name = 'SessionAlreadyExistsError'
          throw error
        }
        const record = { header, events: [] }
        records.set(header.id, record)
        return { async append(batch) { record.events.push(...batch) }, async flush() {}, async close() {} }
      },
      async stat(id) {
        return records.has(id) ? { header: records.get(id).header } : undefined
      },
    },
    workspaceRegistry: {
      async resolveByPath(cwd) {
        if (!fs.existsSync(cwd)) throw new Error("cwd '" + cwd + "' does not resolve")
        const record = workspaces.get(cwd)
        return record ? wrap(record) : null
      },
      async create(cwd) {
        const record = { id: 'ws-' + (workspaces.size + 1), path: cwd, sessionIds: [] }
        workspaces.set(cwd, record)
        return wrap(record)
      },
    },
    records,
    workspaces,
  }
}

test('archive mode writes every new session and is idempotent', async () => {
  const home = tempHome()
  const first = await mountSessions({ store: store(), home, mode: 'archivo' })
  assert.ok(first.created.length > 0)
  assert.equal(first.plan.totals.nueva, first.created.length)

  const second = await mountSessions({ store: store(), home, mode: 'archivo' })
  assert.equal(second.created.length, 0)
  assert.equal(second.identical.length, first.created.length)
})

test('archive mode does not overwrite a divergent log', async () => {
  const home = tempHome()
  const first = await mountSessions({ store: store(), home, mode: 'archivo' })
  const target = first.created[0].target
  fs.writeFileSync(target, 'something else')

  const refused = await mountSessions({ store: store(), home, mode: 'archivo' })
  assert.ok(refused.refused.includes(first.created[0].sessionId))
  assert.equal(fs.readFileSync(target, 'utf8'), 'something else', 'the existing file was preserved')

  const forced = await mountSessions({ store: store(), home, mode: 'archivo', force: true })
  assert.ok(forced.created.some((item) => item.aside === true))
  assert.equal(fs.readFileSync(target, 'utf8'), 'something else', 'still preserved')
})

test('native mode publishes with the translated cwd and attaches once', async () => {
  const home = tempHome()
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-work-'))
  const session = [...collectSessions(store()).sessions.values()][0]
  const translations = emptyTranslations()
  addTranslation(translations, session.header.cwd, work)
  const host = fakeHost()

  const first = await mountSessions({
    store: store(),
    home,
    mode: 'uso',
    translations,
    persistence: host.persistence,
    workspaceRegistry: host.workspaceRegistry,
    readEvents: (id) => host.records.get(id)?.events,
    only: [session.sessionId],
  })
  assert.equal(first.failed.length, 0, JSON.stringify(first.failed))
  assert.equal(first.published.length, 1)
  assert.equal(first.published[0].sealMatched, true)
  assert.equal(first.attached.length, 1)
  assert.equal(host.records.get(session.sessionId).header.cwd, work)

  const second = await mountSessions({
    store: store(),
    home,
    mode: 'uso',
    translations,
    persistence: host.persistence,
    workspaceRegistry: host.workspaceRegistry,
    only: [session.sessionId],
  })
  assert.equal(second.published.length, 0, 'the second run did not publish again')
  assert.equal(second.attached.length, 1)
  assert.equal(second.attached[0].status, 'already-attached')
  assert.equal(host.workspaces.get(work).sessionIds.length, 1)
})

test('native mode reports a session without a destination instead of forcing it', async () => {
  const home = tempHome()
  const host = fakeHost()
  const report = await mountSessions({ store: store(), home, mode: 'uso', persistence: host.persistence, workspaceRegistry: host.workspaceRegistry })
  assert.ok(report.skipped.length > 0)
  assert.ok(report.skipped.every((item) => item.why === 'sin-destino'))
  assert.equal(host.records.size, 0)
})

test('a dry run touches nothing', async () => {
  const home = tempHome()
  const report = await mountSessions({ store: store(), home, mode: 'archivo', dryRun: true })
  assert.equal(report.created.length, 0)
  assert.equal(fs.existsSync(path.join(home, 'sessions')), false)
  assert.ok(report.plan.totals.nueva > 0)
})
