#!/usr/bin/env node
/**
 * Golden outputs: the CLI must say exactly the same thing about the same vault.
 *
 * Usage:
 *   node test/golden/capture.mjs            rewrite test/golden/*.txt
 *   node test/golden/capture.mjs --check    compare and exit 1 on any difference
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..', '..')
const goldenDir = path.join(root, 'test', 'golden')
const check = process.argv.includes('--check')

const expected = JSON.parse(fs.readFileSync(path.join(root, 'conformance', 'fixture', 'expected.json'), 'utf8'))
const keyFile = path.join(os.tmpdir(), 'keeper-golden-phrase.txt')
fs.writeFileSync(keyFile, expected.passphrase, 'utf8')

const commands = ['capabilities', 'status', 'verify', 'catalog', 'doctor', 'paths', 'conform']
// Timestamps and host-specific paths are the only things allowed to differ between runs.
const normalize = (text) => {
  const home = os.homedir();
  const tmp = os.tmpdir();
  let out = text
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\s*\([^)]*\))?/g, '<ts>')
    .replace(/\b\d{2}-\d{2}\s+\d{2}:\d{2}\b/g, '<ts>')
    .replaceAll(root, '<repo>')
    .replaceAll(root.replaceAll('\\', '/'), '<repo>')
    .replaceAll(home, '<home>')
    .replaceAll(home.replaceAll('\\', '/'), '<home>')
    .replaceAll(tmp, '<tmp>')
    .replaceAll(tmp.replaceAll('\\', '/'), '<tmp>')
  // The fixture is OS-neutral: separators are compared as '/'.
  out = out.replaceAll('\\', '/')
  return out
}

let failures = 0
for (const command of commands) {
  let output = ''
  let code = 0
  try {
    output = execFileSync(process.execPath, ['bin/keeper.js', command, '--store', 'conformance/fixture/vault', '--key-file', keyFile], { cwd: root, encoding: 'utf8' })
  } catch (error) {
    output = (error.stdout ?? '') + (error.stderr ?? '')
    code = error.status ?? 1
  }
  const normalized = normalize(output).replace(/\r\n/g, '\n')
  const file = path.join(goldenDir, command + '.txt')
  if (!check) {
    fs.writeFileSync(file, normalized, 'utf8')
    continue
  }
  const saved = fs.readFileSync(file, 'utf8')
  if (saved !== normalized) {
    failures++
    console.error('golden: ' + command + ' changed')
    const a = saved.split('\n')
    const b = normalized.split('\n')
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) { console.error('  - ' + (a[i] ?? '')); console.error('  + ' + (b[i] ?? '')); break }
    }
  }
  if (code !== 0 && command !== 'conform') { failures++; console.error('golden: ' + command + ' exited ' + code) }
}

if (!check) console.log('golden: ' + commands.length + ' files rewritten')
else if (failures === 0) console.log('golden: ok (' + commands.length + ' outputs identical)')
else { console.error('golden: ' + failures + ' difference(s)'); process.exitCode = 1 }
