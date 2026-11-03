import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolvePaths } from '../lib/paths.js'
import { removeDir, tempDir } from './helpers.js'

test('the canonical layout hangs everything from the DSH home', (t) => {
  const root = tempDir('keeper-paths-')
  t.after(() => removeDir(root))
  const home = path.join(root, '.dsh')
  fs.mkdirSync(path.join(home, 'history-keeper'), { recursive: true })
  fs.writeFileSync(path.join(home, 'history-keeper', 'meta.json'), '{}')

  const layout = resolvePaths({ home })
  assert.equal(layout.vault, path.join(home, 'history-keeper'))
  assert.equal(layout.key, path.join(home, 'history-keeper.key'))
  assert.equal(layout.device, path.join(home, 'history-keeper-device.json'))
  assert.equal(layout.origins, path.join(home, 'history-keeper-origins.json'))
  assert.equal(layout.sessions, path.join(home, 'sessions'))
  assert.equal(layout.usingLegacy, false)
})

test('a vault from the previous layout is found, with its own key path', (t) => {
  const root = tempDir('keeper-paths-legacy-')
  t.after(() => removeDir(root))
  const home = path.join(root, '.dsh')
  const legacy = path.join(root, 'keeper-vault')
  fs.mkdirSync(legacy, { recursive: true })
  fs.writeFileSync(path.join(legacy, 'meta.json'), '{}')
  fs.mkdirSync(home, { recursive: true })

  const layout = resolvePaths({ home })
  assert.equal(layout.vault, legacy)
  assert.equal(layout.usingLegacy, true)
  assert.equal(layout.key, path.join(root, 'keeper', 'passphrase.txt'))
  assert.equal(layout.legacy, legacy)
})

test('explicit paths win over both locations', (t) => {
  const root = tempDir('keeper-paths-explicit-')
  t.after(() => removeDir(root))
  const home = path.join(root, '.dsh')
  fs.mkdirSync(home, { recursive: true })
  const vault = path.join(root, 'somewhere', 'vault')
  const key = path.join(root, 'somewhere', 'key.txt')

  const layout = resolvePaths({ home, vault, key })
  assert.equal(layout.vault, vault)
  assert.equal(layout.key, key)
})
