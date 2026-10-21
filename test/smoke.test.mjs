import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name, version } from '../lib/index.js'

test('exposes the plugin contract the host loads', () => {
  assert.equal(name, 'dsh-history-keeper')
  assert.equal(typeof apply, 'function')
  assert.ok(Array.isArray(inject))
  assert.match(version, /^\d+\.\d+\.\d+/)
})

test('mounts without any host service and registers one disposer', () => {
  const effects = []
  apply({ effect: (fn) => effects.push(fn) })
  assert.equal(effects.length, 1)
  assert.equal(typeof effects[0](), 'function')
})

test('survives a context without effect (bare boot)', () => {
  assert.doesNotThrow(() => apply({}))
  assert.doesNotThrow(() => apply(undefined))
})
