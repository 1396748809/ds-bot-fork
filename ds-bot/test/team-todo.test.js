import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readTeamTodo } from '../src/host/team-todo.js'

// The sidebar's only source for the team to-do list. It reads the same file the team-todo
// skill writes, so what these tests pin is how the host copes with that file's states.

const withFile = async (contents, run) => {
  const dir = await mkdtemp(join(tmpdir(), 'team-todo-'))
  const file = join(dir, 'team-todo.json')
  try {
    if (contents !== undefined) await writeFile(file, contents, 'utf8')
    return await run(file)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('no file yet is an empty list, not a failure', async () => {
  const read = await withFile(undefined, file => readTeamTodo(file))
  assert.deepEqual(read, { items: [], open: 0, done: 0 })
})

test('open items come back in order, done ones only as a count', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-1', text: '补闲鱼监控的图', from: '闲鱼监控', at: '2026-11-24T19:00:00+08:00', done: false },
      { id: 'T-2', text: '已经办完的事', from: 'Chief', at: '2026-11-24T19:01:00+08:00', done: true },
      { id: 'T-3', text: '  连着\n写  的文本  ', from: '组长', at: '2026-11-24T19:02:00+08:00', done: false },
    ],
  }
  const read = await withFile(JSON.stringify(doc), file => readTeamTodo(file))
  assert.equal(read.open, 2)
  assert.equal(read.done, 1)
  assert.deepEqual(read.items.map(item => item.id), ['T-1', 'T-3'])
  assert.equal(read.items[1].text, '连着 写 的文本', 'text is flattened to one line and trimmed')
})

test('a broken or empty file does not take the sidebar down', async () => {
  const broken = await withFile('{ not json', file => readTeamTodo(file))
  assert.deepEqual(broken, { items: [], open: 0, done: 0, broken: true })
  const empty = await withFile('', file => readTeamTodo(file))
  assert.deepEqual(empty, { items: [], open: 0, done: 0, broken: true })
})

test('items without usable text are dropped rather than drawn as blank rows', async () => {
  const doc = { items: [{ id: 'T-9', text: '   ' }, { id: 'T-8', text: '有内容' }, null, 'nope'] }
  const read = await withFile(JSON.stringify(doc), file => readTeamTodo(file))
  assert.deepEqual(read.items.map(item => item.id), ['T-8'])
  assert.equal(read.open, 1)
})
