import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { normalizeConfig } from '../lib/config.js'
import { formatTime } from '../lib/util.js'

test('instants are stored in UTC but shown in the local zone', () => {
  // A known local wall clock, expressed as an instant: the display must come back
  // to the same wall clock, with the machine's offset spelled out.
  const local = new Date(2026, 9, 22, 0, 54, 29)
  const rendered = formatTime(local.toISOString())
  assert.match(rendered, /^2026-10-22 00:54:29 \(UTC[+-]\d{2}:\d{2}\)$/)
})

test('the raw UTC form is still what gets stored', () => {
  const stored = new Date(Date.UTC(2026, 9, 22, 3, 54, 29, 372)).toISOString()
  assert.equal(stored, '2026-10-22T03:54:29.372Z')
  assert.notEqual(formatTime(stored), stored, 'display must differ from the stored instant')
})

test('an unparseable value is passed through instead of throwing', () => {
  assert.equal(formatTime('not-a-date'), 'not-a-date')
})

test('an empty config resolves usable defaults, so no YAML is required to install', () => {
  const { config, problems } = normalizeConfig({})
  assert.deepEqual(problems, [])
  assert.equal(config.store, path.join(os.homedir(), '.dsh', 'history-keeper'))
  assert.equal(config.sessionsRoot, path.join(os.homedir(), '.dsh', 'sessions'))
  assert.equal(config.autoSnapshotOnFlush, true)
})

test('explicit values still win over the defaults', () => {
  // Paths are resolved by the platform, so assert against path.resolve rather than a
  // literal Windows string: 'C:\\vault' is absolute on Windows and relative on POSIX.
  const { config } = normalizeConfig({ store: 'C:\\vault', sessionsRoot: 'C:\\home\\sessions', debounceMs: 500 })
  assert.equal(config.store, path.resolve('C:\\vault'))
  assert.equal(config.sessionsRoot, path.resolve('C:\\home\\sessions'))
  assert.notEqual(config.store, path.join(os.homedir(), '.dsh', 'history-keeper'), 'an explicit store must replace the default')
  assert.equal(config.debounceMs, 500)
})
