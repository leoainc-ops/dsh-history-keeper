#!/usr/bin/env node
/**
 * Guard: real session data must never enter this repository.
 *
 * Fails when a tracked file looks like a DSH session log, unless it lives under
 * test/fixtures/synthetic/ (where fixtures are hand-written and contain no real content).
 */
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const ALLOWED_PREFIX = 'test/fixtures/synthetic/'
const SUSPECT = [/\.jsonl$/i, /\.jsonl\.zstd$/i, /\.zst$/i, /session\.v\d+\.jsonl/i]

let tracked = []
try {
  tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
} catch (error) {
  console.error('guard: cannot list tracked files:', error.message)
  process.exit(2)
}

const offenders = tracked.filter(
  (file) => !file.startsWith(ALLOWED_PREFIX) && SUSPECT.some((re) => re.test(file)),
)

if (offenders.length > 0) {
  console.error('guard: session-log-like files are tracked in this repository:')
  for (const file of offenders) console.error('  - ' + file)
  console.error('These may contain personal conversation data. Remove them from the index.')
  process.exit(1)
}

console.log(`guard: ok (${tracked.length} tracked files, no session logs)`)
