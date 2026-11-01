import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { CARRY_RECEIPT, landVault, packVault } from '../lib/carry.js'
import { mergeStores } from '../lib/merge.js'
import { initStore, openStore } from '../lib/store.js'
import { snapshot } from '../lib/snapshot.js'
import { verifyStore } from '../lib/verify.js'
import { makeLog, removeDir, tempDir, writeSession } from './helpers.js'

const FAMILY = 'carry-family-passphrase'
const OTHER = 'carry-other-passphrase'

function makeStore(root, name, phrase, deviceName) {
  const dir = path.join(root, name)
  initStore(dir, { passphrase: phrase, deviceName })
  return openStore(dir, phrase)
}

test('carry packs a verified copy and a receipt, without the passphrase', (t) => {
  const root = tempDir('keeper-carry-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'turn/start' }]] }) })

  const store = makeStore(root, 'vault', FAMILY)
  const keyFile = path.join(root, 'vault.key')
  fs.writeFileSync(keyFile, FAMILY + '\n')
  const stick = path.join(root, 'stick')

  const report = packVault({ store, home, to: stick, keyFile, now: '2026-10-31T10:00:00.000Z' })
  assert.equal(report.verified.ok, true)
  assert.equal(report.captured.sessions, 1)
  assert.equal(report.keyCarried, false)
  assert.equal(typeof report.keyFingerprint, 'string')

  const receipt = JSON.parse(fs.readFileSync(path.join(stick, CARRY_RECEIPT), 'utf8'))
  assert.equal(receipt.verified.sessions, 1)
  assert.ok(fs.existsSync(path.join(stick, 'vault', 'meta.json')))
  assert.equal(fs.existsSync(path.join(stick, 'key')), false, 'the secret does not travel by default')

  // Packing again replaces the previous copy instead of mixing two vaults.
  const again = packVault({ store, home, to: stick, keyFile, now: '2026-10-31T10:05:00.000Z' })
  assert.equal(again.previousReplaced, true)
})

test('land merges the carried vault into the local one and keeps the previous one aside', (t) => {
  const root = tempDir('keeper-land-')
  t.after(() => removeDir(root))
  const homeA = path.join(root, 'home-a')
  const homeB = path.join(root, 'home-b')
  fs.mkdirSync(homeA, { recursive: true })
  fs.mkdirSync(homeB, { recursive: true })

  // Machine A: two sessions.
  writeSession(homeA, { id: 'only-a', dirName: 'a1', log: makeLog({ id: 'only-a', batches: [[{ type: 'turn/start' }]] }) })
  writeSession(homeA, { id: 'shared', dirName: 'a2', log: makeLog({ id: 'shared', batches: [[{ type: 'turn/start' }]] }) })
  const storeA = makeStore(root, 'vault-a', FAMILY, 'pc-a')
  const keyA = path.join(root, 'a.key')
  fs.writeFileSync(keyA, FAMILY + '\n')
  const stick = path.join(root, 'stick')
  packVault({ store: storeA, home: homeA, to: stick, keyFile: keyA, now: '2026-10-31T10:00:00.000Z' })

  // Machine B: one shared session with more bytes, and one of its own.
  writeSession(homeB, { id: 'shared', dirName: 'b1', log: makeLog({ id: 'shared', batches: [[{ type: 'turn/start' }], [{ type: 'turn/end' }]] }) })
  writeSession(homeB, { id: 'only-b', dirName: 'b2', log: makeLog({ id: 'only-b', batches: [[{ type: 'turn/start' }]] }) })
  const storeB = makeStore(root, 'vault-b', OTHER, 'pc-b')
  const keyB = path.join(root, 'b.key')
  fs.writeFileSync(keyB, OTHER + '\n')
  snapshot(storeB, { home: homeB, now: '2026-10-31T10:05:00.000Z' })

  const stickStore = openStore(path.join(stick, 'vault'), FAMILY)
  assert.equal(verifyStore(stickStore).ok, true)

  const keyOut = path.join(root, 'keeper', 'passphrase.txt')
  const report = landVault({
    from: stick,
    localStore: storeB,
    stickStore,
    stickPassphrase: FAMILY,
    keyOut,
    now: '2026-10-31T10:10:00.000Z',
  })

  assert.equal(report.merged.ok, true, JSON.stringify(report.merged.problems))
  assert.equal(report.sessions, 3, 'only-a, shared, only-b')
  assert.equal(report.archived, 0, 'the shared session is a prefix case, not a divergence')
  assert.equal(fs.readFileSync(keyOut, 'utf8').trim(), FAMILY, 'the loop keeps one phrase')

  // The merged vault is now the local one, sealed with the family phrase, and it verifies.
  const landed = openStore(path.join(root, 'vault-b'), FAMILY)
  const verified = verifyStore(landed)
  assert.equal(verified.ok, true)
  assert.equal(verified.totals.sessions, 3)

  // The previous local vault is kept, never deleted.
  assert.ok(report.replaced && fs.existsSync(report.replaced))
  assert.equal(verifyStore(openStore(report.replaced, OTHER)).totals.sessions, 2)
})

test('land refuses a carried vault that does not verify, and leaves the local vault alone', (t) => {
  const root = tempDir('keeper-land-bad-')
  t.after(() => removeDir(root))
  const home = path.join(root, 'home')
  fs.mkdirSync(home, { recursive: true })
  writeSession(home, { id: 's1', dirName: 'a', log: makeLog({ id: 's1', batches: [[{ type: 'turn/start' }]] }) })
  const store = makeStore(root, 'vault', FAMILY)
  const stick = path.join(root, 'stick')
  fs.writeFileSync(path.join(root, 'key'), FAMILY + '\n')
  packVault({ store, home, to: stick, keyFile: path.join(root, 'key') })

  // Damage one object on the stick.
  const objects = path.join(stick, 'vault', 'objects')
  const victim = fs.readdirSync(objects, { recursive: true }).find((name) => String(name).endsWith('.bin'))
  const victimPath = path.join(objects, String(victim))
  const bytes = fs.readFileSync(victimPath)
  bytes[10] ^= 0xff
  fs.writeFileSync(victimPath, bytes)

  const stickStore = openStore(path.join(stick, 'vault'), FAMILY)
  const local = makeStore(root, 'local', OTHER, 'pc-b')
  const before = verifyStore(local).totals.sessions
  assert.throws(
    () => landVault({ from: stick, localStore: local, stickStore, stickPassphrase: FAMILY, keyOut: path.join(root, 'k.txt') }),
    /does not verify/,
  )
  assert.equal(verifyStore(local).totals.sessions, before, 'the local vault is untouched')
})
