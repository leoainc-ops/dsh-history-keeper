import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name, version } from '../lib/index.js'

test('exposes the plugin contract the host loads', () => {
  assert.equal(name, 'dsh-history-keeper')
  assert.equal(typeof apply, 'function')
  assert.ok(Array.isArray(inject))
  assert.ok(inject.includes('commands'), 'the command registry is a hard dependency')
  assert.match(version, /^\d+\.\d+\.\d+/)
})

test('mounts against the host surface it injects', () => {
  const registered = []
  const effects = []
  const ctx = {
    commands: { register: (definition) => registered.push(definition) },
    on: () => {},
    effect: (factory) => effects.push(factory()),
  }

  assert.doesNotThrow(() => apply(ctx, { store: undefined }))
  assert.equal(registered.length, 1)
  assert.equal(registered[0].name, 'keeper')
  assert.equal(effects.length, 1)
})

test('survives a context without an event bus or disposers', () => {
  const ctx = { commands: { register: () => {} } }
  assert.doesNotThrow(() => apply(ctx, {}))
  assert.doesNotThrow(() => apply(ctx))
})
