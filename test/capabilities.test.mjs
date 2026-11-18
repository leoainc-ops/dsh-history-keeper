import assert from 'node:assert/strict'
import test from 'node:test'

import { HOST_SERVICES, capabilities, probeHost } from '../host/capabilities.js'

/** A plugin context that injects exactly the services it is given. */
const contextWith = (services) => ({
  get(name) {
    return services[name]
  },
})

test('probeHost reports absent services instead of throwing', () => {
  const probe = probeHost(contextWith({}))
  for (const name of HOST_SERVICES) {
    assert.equal(probe.services[name].present, false)
    assert.deepEqual(probe.services[name].methods, [])
  }
  assert.equal(typeof probe.at, 'string')
  assert.equal(typeof probe.runtime.platform, 'string')
})

test('probeHost lists public methods, two levels deep, and skips internals', () => {
  class SessionPersistence {
    create() {}
    append() {}
    flush() {}
    _internal() {}
  }
  const probe = probeHost(contextWith({ sessionPersistence: new SessionPersistence() }))
  assert.equal(probe.services.sessionPersistence.present, true)
  assert.deepEqual(probe.services.sessionPersistence.methods, ['append', 'create', 'flush'])
})

test('capabilities offers uso only when the session writer and the registry both exist', () => {
  const both = capabilities(
    probeHost(
      contextWith({
        sessionPersistence: { create() {} },
        workspaceRegistry: { attachSession() {} },
      }),
    ),
  )
  assert.deepEqual(both.modes, ['archivo', 'uso'])
  assert.match(both.reason, /sessionPersistence and workspaceRegistry/)

  const onlyWriter = capabilities(probeHost(contextWith({ sessionPersistence: { create() {} } })))
  assert.deepEqual(onlyWriter.modes, ['archivo'])
  assert.match(onlyWriter.reason, /workspaceRegistry is not/)

  const none = capabilities(probeHost(contextWith({})))
  assert.deepEqual(none.modes, ['archivo'])
  assert.match(none.reason, /no session writer/)
})
