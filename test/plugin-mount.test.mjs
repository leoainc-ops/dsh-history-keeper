import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const ENV = 'KEEPER_PASSPHRASE_PLUGIN_MOUNT'

/** A host that behaves like DSH: ids cannot be reused, attaching is idempotent by contract. */
function fakeHost() {
  const records = new Map()
  const workspaces = new Map()
  const wrap = (record) => ({
    id: record.id,
    get sessionIds() {
      return record.sessionIds
    },
    async attachSession(sessionId) {
      if (record.sessionIds.includes(sessionId)) throw new Error('session "' + sessionId + '" already belongs to this workspace')
      record.sessionIds.push(sessionId)
    },
    async detachSession(sessionId) {
      record.sessionIds = record.sessionIds.filter((id) => id !== sessionId)
    },
  })
  return {
    services: {
      sessionPersistence: {
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
    },
    records,
    workspaces,
  }
}

function setup(t) {
  const root = tempDir('keeper-pmount-')
  const home = path.join(root, 'home')
  const work = path.join(root, 'work')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(work, { recursive: true })
  const storeDir = path.join(root, 'vault')
  const keyFile = path.join(root, 'keeper.key')
  fs.writeFileSync(keyFile, 'a passphrase for the plugin mount test\n', 'utf8')
  writeSession(home, {
    id: 'session-m1',
    cwd: work,
    log: makeLog({
      id: 'session-m1',
      cwd: work,
      batches: [
        [{ type: 'turn/start', data: { turn: 1 }, time: 1000 }],
        [{ type: 'turn/end', data: { turn: 1 }, time: 2000 }],
      ],
    }),
  })

  const host = fakeHost()
  const commands = []
  const ctx = {
    commands: { register: (definition) => commands.push(definition) },
    on: () => {},
    effect: (factory) => factory(),
    logger: { warn: () => {} },
    get: (name) => host.services[name],
  }
  apply(ctx, { store: storeDir, sessionsRoot: path.join(home, 'sessions'), keyFile, passphraseEnv: ENV, deviceName: 'plugin-mount-test' })
  t.after(() => {
    removeDir(root)
    delete process.env[ENV]
  })
  return { root, home, work, command: commands[0], host }
}

test('mount plans first and publishes only with apply', async (t) => {
  const { command, host, work } = setup(t)
  assert.equal((await command.handler({ rawInput: 'init' })).kind, 'success')
  assert.equal((await command.handler({ rawInput: 'snapshot' })).kind, 'success')

  const plan = await command.handler({ rawInput: 'mount' })
  assert.equal(plan.kind, 'success', plan.text)
  assert.match(plan.text, /mount \(uso\)/)
  assert.match(plan.text, /session-m1/)
  assert.equal(host.records.size, 0, 'the plan published nothing')

  const applied = await command.handler({ rawInput: 'mount apply' })
  assert.equal(applied.kind, 'success', applied.text)
  assert.match(applied.text, /published 1/)
  assert.equal(host.records.size, 1)
  assert.equal(host.records.get('session-m1').header.cwd, work)
  assert.deepEqual(host.workspaces.get(work).sessionIds, ['session-m1'])
})

test('a second apply does not duplicate, and undo ungroups', async (t) => {
  const { command, host, work } = setup(t)
  await command.handler({ rawInput: 'init' })
  await command.handler({ rawInput: 'snapshot' })
  await command.handler({ rawInput: 'mount apply' })

  const again = await command.handler({ rawInput: 'mount apply' })
  assert.match(again.text, /published 0/)
  assert.equal(host.records.size, 1, 'the session was not created twice')
  assert.deepEqual(host.workspaces.get(work).sessionIds, ['session-m1'], 'it was not attached twice')

  const undo = await command.handler({ rawInput: 'mount undo' })
  assert.match(undo.text, /ungrouped 1/)
  assert.deepEqual(host.workspaces.get(work).sessionIds, [], 'the session was detached')
  assert.equal(host.records.size, 1, 'the session itself stays: undo ungroups, it does not delete')
})
