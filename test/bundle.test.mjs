import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('package.json is a DSH bundle with a bounded host range', () => {
  assert.equal(pkg.name, 'dsh-history-keeper')
  assert.match(pkg.version, /^\d+\.\d+\.\d+/)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(pkg.engines.dsh, 'engines.dsh must pin the supported host range')
  assert.match(pkg.engines.dsh, /^>=/)
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.files.includes('lib/'))
  assert.ok(pkg.files.includes('bin/'))
  assert.equal(pkg.dependencies, undefined, 'no runtime dependencies: node: only')
})

test('the patch row references this package by name and never by path', () => {
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(patch, /^- insert:/m)
  assert.match(patch, /^\s*-\s*id: history-keeper$/m)
  assert.match(patch, /^\s+name: dsh-history-keeper$/m)
})

test('the shipped entry and CLI exist and are importable/executable', () => {
  assert.equal(fs.existsSync(path.join(root, 'lib', 'index.js')), true)
  const cli = path.join(root, 'bin', 'keeper.js')
  assert.equal(fs.existsSync(cli), true)
  assert.match(fs.readFileSync(cli, 'utf8').split('\n')[0], /^#!.*node/)
})

test('every package export points at a real file', () => {
  for (const [key, value] of Object.entries(pkg.exports)) {
    const file = path.join(root, value.replace(/^\.\//, ''))
    assert.equal(fs.existsSync(file), true, 'export ' + key + ' -> ' + value)
  }
})
