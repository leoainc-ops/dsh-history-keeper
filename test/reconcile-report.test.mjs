import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { initStore, openStore } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const REPORT = path.join(here, '..', 'scripts', 'reconcile-report.mjs')
const PASSPHRASE = 'reconcile-test-passphrase'

function build(root, side) {
  const home = path.join(root, side)
  const dir = path.join(root, 'vault-' + side)
  fs.mkdirSync(home, { recursive: true })
  initStore(dir, { passphrase: PASSPHRASE, deviceName: 'pc-' + side })
  const store = openStore(dir, PASSPHRASE)
  const device = { deviceId: (side === 'a' ? 'a' : 'b').repeat(32), deviceName: 'pc-' + side }
  const put = (id, batches) => writeSession(home, { id, log: makeLog({ id, batches }), dirName: 'd-' + id })

  put('session-identica', [[{ type: 'm', n: 'x1' }]])
  put('session-prefijo', side === 'a' ? [[{ type: 'm', n: 'p1' }], [{ type: 'm', n: 'p2' }]] : [[{ type: 'm', n: 'p1' }]])
  put('session-divergente', side === 'a' ? [[{ type: 'm', n: 'd1' }], [{ type: 'm', n: 'a2' }]] : [[{ type: 'm', n: 'd1' }], [{ type: 'm', n: 'b2' }]])
  put('session-solo-' + side, [[{ type: 'm', n: 's' + side }]])

  snapshot(store, { home, now: '2026-10-30T12:00:00.000Z', device })
  fs.writeFileSync(path.join(root, side + '.key'), PASSPHRASE + '\n', 'utf8')
}

test('the report classifies the four reconciliation cases without writing anything', (t) => {
  const root = tempDir('keeper-reconcile-')
  t.after(() => removeDir(root))
  build(root, 'a')
  build(root, 'b')
  const beforeA = fs.readdirSync(path.join(root, 'vault-a')).sort()

  const run = spawnSync(
    process.execPath,
    [REPORT, '--a', path.join(root, 'vault-a'), '--a-key', path.join(root, 'a.key'), '--b', path.join(root, 'vault-b'), '--b-key', path.join(root, 'b.key')],
    { encoding: 'utf8' },
  )
  assert.equal(run.status, 0, run.stderr)
  const output = run.stdout

  assert.match(output, /idénticas → una sola conversación/)
  assert.match(output, /B es prefijo de A → gana A, sin conflicto/)
  assert.match(output, /DIVERGEN en el byte \d+ → colas de \d+B y \d+B/)
  assert.match(output, /solo en A \(1\)/)
  assert.match(output, /solo en B \(1\)/)
  assert.match(output, /conversaciones: 5/)
  assert.match(output, /sesiones con dos colas distintas \(requieren decisión\): 1/)

  assert.deepEqual(fs.readdirSync(path.join(root, 'vault-a')).sort(), beforeA, 'the report must not write to either store')
})
