/**
 * Build the conformance fixture: a small, fixed vault plus the hashes of what it must restore.
 *
 * The fixture is committed, so any implementation —this one, a fork, a policy package— can be
 * checked against the same bytes. Run this only when the format changes on purpose:
 *
 *   node conformance/make-fixture.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { initStore, openStore } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { sha256 } from '../lib/util.js'
import { makeLog, writeSession } from '../test/helpers.js'

export const PASSPHRASE = 'conformance-test-passphrase'
const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, 'fixture')

const sessions = [
  {
    id: 'session-conformance-alpha',
    cwd: 'C:\\work\\conformance',
    log: makeLog({
      id: 'session-conformance-alpha',
      cwd: 'C:\\work\\conformance',
      batches: [
        [{ type: 'turn/start' }],
        [{ type: 'message', text: 'alpha one' }],
        [{ type: 'turn/end' }],
        [{ type: 'turn/start' }],
        [{ type: 'message', text: 'alpha two' }],
        [{ type: 'turn/end' }],
      ],
    }),
  },
  {
    id: 'session-conformance-beta',
    cwd: 'C:\\work\\conformance',
    log: makeLog({
      id: 'session-conformance-beta',
      cwd: 'C:\\work\\conformance',
      batches: [[{ type: 'turn/start' }], [{ type: 'message', text: 'beta' }], [{ type: 'turn/end' }]],
    }),
  },
]

fs.rmSync(fixture, { recursive: true, force: true })
const home = path.join(fixture, 'source-home')
const vault = path.join(fixture, 'vault')
fs.mkdirSync(home, { recursive: true })
for (const session of sessions) writeSession(home, session)

initStore(vault, { passphrase: PASSPHRASE, deviceName: 'conformance' })
const store = openStore(vault, PASSPHRASE)
snapshot(store, { home, now: '2026-11-03T00:00:00.000Z', device: { deviceId: 'cc'.repeat(16), deviceName: 'conformance' } })

const expected = {
  format: 'dsh-history-keeper/store/1',
  passphrase: PASSPHRASE,
  storeId: store.meta.storeId,
  sessions: sessions.map((session) => ({
    sessionId: session.id,
    cwd: session.cwd,
    bytes: session.log.length,
    sha256: sha256(session.log),
  })),
}

fs.writeFileSync(path.join(fixture, 'expected.json'), JSON.stringify(expected, null, 2) + '\n', 'utf8')
fs.rmSync(home, { recursive: true, force: true })
console.log('fixture written to ' + fixture)
console.log(JSON.stringify(expected, null, 2))
