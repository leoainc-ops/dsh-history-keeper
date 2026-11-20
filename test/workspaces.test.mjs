import assert from 'node:assert/strict'
import test from 'node:test'

import { attachToWorkspace } from '../host/workspaces.js'

/** A registry that behaves like the host's: paths resolve, ids cannot be attached twice. */
function fakeRegistry({ existing = null, resolveThrows = null } = {}) {
  const created = []
  const workspaces = new Map()
  if (existing) workspaces.set(existing.path, existing)

  const wrap = (record) => ({
    id: record.id,
    get sessionIds() {
      return record.sessionIds
    },
    async attachSession(sessionId) {
      if (record.sessionIds.includes(sessionId)) throw new Error('session "' + sessionId + '" already belongs to this workspace')
      record.sessionIds.push(sessionId)
    },
  })

  return {
    created,
    async resolveByPath(cwd) {
      if (resolveThrows) throw new Error(resolveThrows)
      const record = workspaces.get(cwd)
      return record ? wrap(record) : null
    },
    async create(cwd) {
      const record = { id: 'ws-' + (workspaces.size + 1), path: cwd, sessionIds: [] }
      workspaces.set(cwd, record)
      created.push(cwd)
      return wrap(record)
    },
    get(cwd) {
      return workspaces.get(cwd)
    },
  }
}

test('attaches the session to an existing workspace, once', async () => {
  const registry = fakeRegistry({ existing: { id: 'ws-1', path: 'C:\\work\\a', sessionIds: [] } })
  const first = await attachToWorkspace({ workspaceRegistry: registry, sessionId: 'session-a', cwd: 'C:\\work\\a' })
  assert.equal(first.status, 'attached')
  assert.equal(first.workspaceId, 'ws-1')
  assert.deepEqual(registry.get('C:\\work\\a').sessionIds, ['session-a'])

  const second = await attachToWorkspace({ workspaceRegistry: registry, sessionId: 'session-a', cwd: 'C:\\work\\a' })
  assert.equal(second.status, 'already-attached')
  assert.deepEqual(registry.get('C:\\work\\a').sessionIds, ['session-a'], 'the second attach did not duplicate')
})

test('creates the workspace when the path exists but is not registered', async () => {
  const registry = fakeRegistry()
  const result = await attachToWorkspace({ workspaceRegistry: registry, sessionId: 'session-b', cwd: 'C:\\work\\b' })
  assert.equal(result.status, 'created-and-attached')
  assert.equal(result.created, true)
  assert.deepEqual(registry.created, ['C:\\work\\b'])
})

test('a path the registry cannot resolve is reported, not thrown', async () => {
  const registry = fakeRegistry({ resolveThrows: "cwd 'C:\\work\\missing' does not resolve" })
  const result = await attachToWorkspace({ workspaceRegistry: registry, sessionId: 'session-c', cwd: 'C:\\work\\missing' })
  assert.equal(result.status, 'no-cwd')
  assert.equal(result.code, 'CWD_UNRESOLVED')
  assert.match(result.message, /does not resolve/)
})

test('no registry and no cwd are distinct, honest answers', async () => {
  const withoutRegistry = await attachToWorkspace({ workspaceRegistry: null, sessionId: 's', cwd: 'C:\\x' })
  assert.equal(withoutRegistry.status, 'unavailable')
  assert.equal(withoutRegistry.code, 'NO_WORKSPACE_REGISTRY')

  const withoutCwd = await attachToWorkspace({ workspaceRegistry: fakeRegistry(), sessionId: 's', cwd: null })
  assert.equal(withoutCwd.status, 'no-cwd')
  assert.equal(withoutCwd.code, 'NO_CWD')
})
