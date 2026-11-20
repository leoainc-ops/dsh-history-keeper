import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  addTranslation,
  emptyTranslations,
  loadTranslations,
  resolveCwd,
  saveTranslations,
  translateMap,
  translationsFile,
} from '../core/translations.js'

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-tr-'))

test('a missing map is an empty map, not an error', () => {
  const home = tempHome()
  const state = loadTranslations(home)
  assert.deepEqual(state.entries, [])
  assert.equal(state.format, 'dsh-history-keeper/translations/1')
  assert.equal(translationsFile(home), path.join(home, 'history-keeper-translations.json'))
})

test('adding, saving and loading round-trips the map', () => {
  const home = tempHome()
  const state = emptyTranslations()
  assert.equal(addTranslation(state, 'C:\\Users\\a\\work', 'C:\\work').added, true)
  saveTranslations(home, state)

  const loaded = loadTranslations(home)
  assert.equal(loaded.entries.length, 1)
  assert.equal(loaded.entries[0].from, 'C:\\Users\\a\\work')
  assert.equal(loaded.entries[0].to, 'C:\\work')
  assert.deepEqual(translateMap(loaded), { 'C:\\Users\\a\\work': 'C:\\work' })
})

test('adding the same pair twice is a no-op; changing the destination is refused', () => {
  const state = emptyTranslations()
  addTranslation(state, 'C:\\a', 'C:\\b')
  assert.equal(addTranslation(state, 'C:\\a', 'C:\\b').added, false)
  assert.throws(() => addTranslation(state, 'C:\\a', 'C:\\c'), /already translated/)
  assert.equal(state.entries.length, 1)
})

test('resolveCwd translates only what is in the map and keeps the original', () => {
  const state = emptyTranslations()
  addTranslation(state, 'C:\\remote\\proj', 'C:\\local\\proj')

  const translated = resolveCwd('C:\\remote\\proj', state)
  assert.deepEqual(translated, { cwd: 'C:\\local\\proj', originalCwd: 'C:\\remote\\proj', translated: true })

  const untouched = resolveCwd('C:\\other', state)
  assert.deepEqual(untouched, { cwd: 'C:\\other', originalCwd: 'C:\\other', translated: false })

  assert.deepEqual(resolveCwd(null, state), { cwd: null, originalCwd: null, translated: false })
})

test('a damaged map is refused instead of silently ignored', () => {
  const home = tempHome()
  fs.writeFileSync(translationsFile(home), '{"format":"other","entries":[]}\n', 'utf8')
  assert.throws(() => loadTranslations(home), /invalid translations file/)
})
