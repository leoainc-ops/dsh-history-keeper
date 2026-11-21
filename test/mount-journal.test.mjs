import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { journalPath, lastMount, readJournal, recordMount, undoMount } from '../core/mount-journal.js'

const tempHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'keeper-mj-'))

function writeSessionFile(home, id) {
  const file = path.join(home, 'sessions', '--demo--', 'session-' + id, 'session.v4.jsonl.zstd')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, 'log')
  return file
}

test('a missing journal is empty, and a recorded mount can be read back', () => {
  const home = tempHome()
  assert.deepEqual(readJournal(home).mounts, [])
  assert.equal(lastMount(home), null)

  const record = recordMount(home, { id: 'm1', mode: 'archivo', vault: { storeId: 'abc' }, created: [{ sessionId: 'session-a', path: 'C:\\x' }] })
  assert.equal(record.id, 'm1')
  const journal = readJournal(home)
  assert.equal(journal.mounts.length, 1)
  assert.equal(lastMount(home).id, 'm1')
  assert.equal(journalPath(home), path.join(home, 'history-keeper-mounts.json'))
})

test('undo deletes only what the journal recorded inside sessions, and detaches', async () => {
  const home = tempHome()
  const inside = writeSessionFile(home, 'a')
  const outside = path.join(home, 'notes.txt')
  fs.writeFileSync(outside, 'keep me')

  recordMount(home, {
    id: 'm2',
    created: [
      { sessionId: 'session-a', path: inside },
      { sessionId: 'session-b', path: outside },
    ],
    attached: [{ sessionId: 'session-a', workspaceId: 'ws-1' }],
  })

  const detached = []
  const result = await undoMount(home, { detach: (item) => detached.push(item.sessionId) })

  assert.equal(result.status, 'undone')
  assert.deepEqual(result.removed, [inside])
  assert.equal(fs.existsSync(inside), false)
  assert.equal(fs.existsSync(outside), true, 'a path outside sessions is never deleted')
  assert.deepEqual(result.refused.map((item) => item.path), [outside])
  assert.deepEqual(detached, ['session-a'])
  assert.notEqual(readJournal(home).mounts[0].undoneAt, null)

  const again = await undoMount(home, { id: 'm2', detach: () => {} })
  assert.equal(again.status, 'already-undone')

  const nothing = await undoMount(home, { detach: () => {} })
  assert.equal(nothing.status, 'nothing-to-undo')
})

test('a damaged journal is refused instead of guessed', () => {
  const home = tempHome()
  fs.writeFileSync(journalPath(home), '{"format":"other"}\n', 'utf8')
  assert.throws(() => readJournal(home), /invalid mount journal/)
})
