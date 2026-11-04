/**
 * Conformance runner: the five checks every implementation must pass against the reference vault.
 *
 *   1. opens the fixture with the test passphrase
 *   2. verify is ok
 *   3. restores every session into an empty home, byte-identical to the expected hashes
 *   4. detects one altered object (fails closed, with a code)
 *   5. refuses a wrong passphrase
 *
 * Usage: npm run conformance
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { openStore } from '../lib/store.js'
import { sha256 } from '../lib/util.js'
import { verifyStore } from '../lib/verify.js'
import { restore } from '../lib/restore.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, 'fixture')
const expected = JSON.parse(fs.readFileSync(path.join(fixture, 'expected.json'), 'utf8'))

let failures = 0
function check(name, ok, detail = '') {
  if (ok) {
    console.log('  ok    ' + name)
  } else {
    failures += 1
    console.log('  FAIL  ' + name + (detail ? '  — ' + detail : ''))
  }
}

function copyDir(from, to) {
  fs.cpSync(from, to, { recursive: true })
}

console.log('conformance against ' + fixture)

// 1. open
let store
try {
  store = openStore(path.join(fixture, 'vault'), expected.passphrase)
  check('opens with the test passphrase', store.meta.storeId === expected.storeId)
} catch (error) {
  check('opens with the test passphrase', false, error.message)
  process.exit(1)
}

check('declares the expected format', store.meta.format === expected.format, String(store.meta.format))

// 2. verify
const verified = verifyStore(store)
check('verify is ok', verified.ok, verified.problems.map((problem) => problem.code).join(', '))
check(
  'verify sees every session',
  verified.totals.sessions === expected.sessions.length,
  verified.totals.sessions + ' vs ' + expected.sessions.length,
)

// 3. restore byte for byte
const home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-conformance-')), 'home')
fs.mkdirSync(home, { recursive: true })
const restored = restore(store, { home })
check('restore creates every session', restored.created.length === expected.sessions.length, String(restored.created.length))
for (const session of expected.sessions) {
  const dir = path.join(home, 'sessions')
  const found = fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .find((name) => name.endsWith('session.v4.jsonl.zstd') && name.includes(session.sessionId))
  if (!found) {
    check('restores ' + session.sessionId, false, 'no file')
    continue
  }
  const bytes = fs.readFileSync(path.join(dir, found))
  check('restores ' + session.sessionId + ' byte for byte', sha256(bytes) === session.sha256)
}
fs.rmSync(path.dirname(home), { recursive: true, force: true })

// 4. tampering is detected
const tampered = fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-tamper-'))
copyDir(path.join(fixture, 'vault'), path.join(tampered, 'vault'))
const objects = path.join(tampered, 'vault', 'objects')
const victim = fs.readdirSync(objects)[0]
const file = path.join(objects, victim)
const bytes = fs.readFileSync(file)
bytes[bytes.length - 2] ^= 0xff
fs.writeFileSync(file, bytes)
const broken = verifyStore(openStore(path.join(tampered, 'vault'), expected.passphrase))
check('detects one altered object', broken.ok === false && broken.problems.length > 0)
fs.rmSync(tampered, { recursive: true, force: true })

// 5. wrong passphrase fails closed
let refused = false
try {
  openStore(path.join(fixture, 'vault'), 'definitely-not-the-passphrase')
} catch {
  refused = true
}
check('refuses a wrong passphrase', refused)

if (failures > 0) {
  console.log('\n' + failures + ' check(s) failed: this implementation does not conform to store/1')
  process.exit(1)
}
console.log('\nconformance: ok')
