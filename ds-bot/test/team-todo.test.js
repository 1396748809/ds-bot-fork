import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { addTeamTodo, clearTeamTodoDone, clearTeamTodoItem, readTeamTodo, setTeamTodoDone } from '../src/host/team-todo.js'

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
  assert.deepEqual(read, { items: [], open: 0, done: 0, history: [] })
})

test('every row still in the list comes back newest first, ticked or not', async () => {
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
  assert.deepEqual(read.items.map(item => item.id), ['T-3', 'T-2', 'T-1'], 'the newest row leads')
  assert.equal(read.items[1].done, true, 'the row says it is ticked so the client can strike it')
  assert.equal(read.items[0].text, '连着 写 的文本', 'text is flattened to one line and trimmed')
})

test('a broken or empty file does not take the sidebar down', async () => {
  const broken = await withFile('{ not json', file => readTeamTodo(file))
  assert.deepEqual(broken, { items: [], open: 0, done: 0, history: [], broken: true })
  const empty = await withFile('', file => readTeamTodo(file))
  assert.deepEqual(empty, { items: [], open: 0, done: 0, history: [], broken: true })
})

test('items without usable text are dropped rather than drawn as blank rows', async () => {
  const doc = { items: [{ id: 'T-9', text: '   ' }, { id: 'T-8', text: '有内容' }, null, 'nope'] }
  const read = await withFile(JSON.stringify(doc), file => readTeamTodo(file))
  assert.deepEqual(read.items.map(item => item.id), ['T-8'])
  assert.equal(read.open, 1)
})

// A tick from the sidebar must leave the file exactly as `todo.mjs done` would, or the two
// writers would start disagreeing about the same list.
test('ticking an item marks it and stamps it, without moving it', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-1', text: '甲', from: 'Chief', at: '2026-11-24T20:00:00+08:00', done: false, doneAt: null },
      { id: 'T-2', text: '乙', from: '组长', at: '2026-11-24T20:01:00+08:00', done: false, doneAt: null },
    ],
  }
  await withFile(JSON.stringify(doc), async file => {
    const after = await setTeamTodoDone('T-1', true, file)
    assert.equal(after.changed, true)
    assert.equal(after.open, 1)
    assert.equal(after.done, 1)
    assert.deepEqual(after.items.map(item => item.id), ['T-2', 'T-1'], 'the ticked row stays where it was')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(saved.items.map(item => item.id), ['T-1', 'T-2'], 'nothing jumps on a click')
    assert.equal(saved.items[0].done, true)
    assert.match(saved.items[0].doneAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, 'stamped in the same local form the script writes')
    assert.equal(saved.version, 1, 'the rest of the document survives')
  })
})

test('an unknown id writes nothing', async () => {
  const doc = { version: 1, items: [{ id: 'T-1', text: '甲', done: false }] }
  await withFile(JSON.stringify(doc), async file => {
    const before = await readFile(file, 'utf8')
    const after = await setTeamTodoDone('T-404', true, file)
    assert.equal(after.changed, false)
    assert.equal(await readFile(file, 'utf8'), before, 'the file is left exactly as it was')
  })
})

test('the history holds what the user cleaned up, newest first', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-1', text: '早清理的', done: true, cleared: true, clearedAt: '2026-11-23T10:00:00+08:00' },
      { id: 'T-2', text: '没做的', done: false },
      { id: 'T-3', text: '后清理的', done: true, cleared: true, clearedAt: '2026-11-24T20:31:00+08:00' },
      { id: 'T-4', text: '刚勾还没清理的', done: true, doneAt: '2026-11-24T21:00:00+08:00' },
      { id: 'T-5', text: '没有时间戳的旧条目', done: true, cleared: true },
    ],
  }
  const read = await withFile(JSON.stringify(doc), file => readTeamTodo(file))
  assert.equal(read.open, 1)
  assert.equal(read.done, 1, 'a ticked row still in the list is not history yet')
  assert.deepEqual(read.items.map(item => item.id), ['T-2', 'T-4'], 'the list keeps order, ticked or not')
  assert.deepEqual(read.history.map(item => item.id), ['T-3', 'T-1', 'T-5'], 'stamped ones by time, an unstamped one after them')
  assert.equal(read.history[0].clearedAt, '2026-11-24T20:31:00+08:00', 'the history carries when it was cleaned up')
})

test('clearing takes every ticked row out at once and keeps the rest in place', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-1', text: '勾了的甲', done: true, doneAt: '2026-11-24T20:00:00+08:00' },
      { id: 'T-2', text: '没做的乙', done: false },
      { id: 'T-3', text: '勾了的丙', done: true, doneAt: '2026-11-24T20:05:00+08:00' },
    ],
  }
  await withFile(JSON.stringify(doc), async file => {
    const after = await clearTeamTodoDone(file)
    assert.equal(after.cleared, 2)
    assert.equal(after.open, 1)
    assert.equal(after.done, 0)
    assert.deepEqual(after.items.map(item => item.id), ['T-2'], 'only the open row is left in the list')
    assert.deepEqual(after.history.map(item => item.id).sort(), ['T-1', 'T-3'])
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(saved.items.map(item => item.id), ['T-1', 'T-2', 'T-3'], 'the file keeps its order, only the flags change')
    assert.equal(saved.items[0].cleared, true)
    assert.equal(saved.items[1].cleared, undefined, 'an open row is untouched')
  })
})

// A row's own menu clears one ticked item: the others stay exactly where they were.
test('clearing one row leaves every other row alone', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-1', text: '勾了的甲', done: true, doneAt: '2026-11-24T20:00:00+08:00' },
      { id: 'T-2', text: '没做的乙', done: false },
      { id: 'T-3', text: '勾了的丙', done: true, doneAt: '2026-11-24T20:05:00+08:00' },
    ],
  }
  await withFile(JSON.stringify(doc), async file => {
    const after = await clearTeamTodoItem('T-3', file)
    assert.equal(after.cleared, 1)
    assert.equal(after.open, 1)
    assert.equal(after.done, 1, 'the other ticked row is still in the list')
    assert.deepEqual(after.items.map(item => item.id), ['T-1', 'T-2'])
    assert.deepEqual(after.history.map(item => item.id), ['T-3'])
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(saved.items.map(item => item.id), ['T-1', 'T-2', 'T-3'], 'the file keeps its order')
    assert.equal(saved.items[2].cleared, true)
    assert.equal(saved.items[0].cleared, undefined, 'the other ticked row is untouched')
  })
})

test('clearing one row that is not ticked does nothing', async () => {
  const doc = { version: 1, items: [{ id: 'T-1', text: '没做的', done: false }] }
  await withFile(JSON.stringify(doc), async file => {
    const after = await clearTeamTodoItem('T-1', file)
    assert.equal(after.cleared, 0)
    assert.deepEqual(after.items.map(item => item.id), ['T-1'], 'an open row stays open')
  })
})

// The history is the clean-up, so a row can only come back out of it if that flag goes too.
test('unticking a cleaned-up row brings it back into the list', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-1', text: '清掉过的甲', done: true, doneAt: '2026-11-25T11:00:00+08:00', cleared: true, clearedAt: '2026-11-25T11:10:00+08:00' },
      { id: 'T-2', text: '清掉过的乙', done: true, doneAt: '2026-11-25T11:05:00+08:00', cleared: true, clearedAt: '2026-11-25T11:10:00+08:00' },
    ],
  }
  await withFile(JSON.stringify(doc), async file => {
    const before = await readTeamTodo(file)
    assert.deepEqual(before.history.map(item => item.id).sort(), ['T-1', 'T-2'], 'both sit in the history')
    const after = await setTeamTodoDone('T-1', false, file)
    assert.equal(after.open, 1, 'it is open again')
    assert.deepEqual(after.items.map(item => item.id), ['T-1'], 'it is back in the list')
    assert.deepEqual(after.history.map(item => item.id), ['T-2'], 'the other one stays in the history')
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.items[0].cleared, false, 'the clean-up flag went with the tick')
    assert.equal(saved.items[1].cleared, true, 'the other row keeps its flag')
  })
})

// The list reads in the order things were added, so a row's place is its own and not a
// side effect of where the file happens to hold it.
test('the list follows the time each row was added, newest first', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-2', text: '第二条', at: '2026-11-25T11:05:00+08:00' },
      { id: 'T-1', text: '第一条', at: '2026-11-25T11:00:00+08:00' },
      { id: 'T-3', text: '第三条', at: '2026-11-25T11:10:00+08:00' },
    ],
  }
  await withFile(JSON.stringify(doc), async file => {
    const read = await readTeamTodo(file)
    assert.deepEqual(read.items.map(item => item.id), ['T-3', 'T-2', 'T-1'])
  })
})

test('a row put back from the history returns to the place it was added in', async () => {
  const doc = {
    version: 1,
    items: [
      { id: 'T-2', text: '第二条', at: '2026-11-25T11:05:00+08:00' },
      { id: 'T-3', text: '第三条', at: '2026-11-25T11:10:00+08:00' },
      { id: 'T-1', text: '第一条', at: '2026-11-25T11:00:00+08:00', done: true, doneAt: '2026-11-25T11:20:00+08:00', cleared: true, clearedAt: '2026-11-25T11:30:00+08:00' },
    ],
  }
  await withFile(JSON.stringify(doc), async file => {
    const after = await setTeamTodoDone('T-1', false, file)
    assert.deepEqual(after.items.map(item => item.id), ['T-3', 'T-2', 'T-1'], 'the oldest row lands last')
    assert.deepEqual(after.history, [])
  })
})

test('clearing with nothing ticked changes nothing', async () => {
  const doc = { version: 1, items: [{ id: 'T-1', text: '没做的', done: false }] }
  await withFile(JSON.stringify(doc), async file => {
    const before = await readFile(file, 'utf8')
    const after = await clearTeamTodoDone(file)
    assert.equal(after.cleared, 0)
    assert.equal(await readFile(file, 'utf8'), before)
  })
})

test('putting a done item back makes it open again', async () => {
  const doc = { version: 1, items: [{ id: 'T-1', text: '甲', done: true, doneAt: '2026-11-24T20:31:00+08:00' }] }
  await withFile(JSON.stringify(doc), async file => {
    const after = await setTeamTodoDone('T-1', false, file)
    assert.equal(after.open, 1)
    assert.equal(after.done, 0)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.items[0].done, false)
    assert.equal(saved.items[0].doneAt, null)
  })
})

// An item the user writes from the sidebar lands in the same file, in the same shape, as
// one a Bot adds with the skill: the list has one kind of entry, not two.
test('an item the user adds takes the same shape the skill writes', async () => {
  const doc = { version: 1, items: [{ id: 'T-1', text: '已有的', from: 'Chief', at: '2026-11-24T20:00:00+08:00', done: false }] }
  await withFile(JSON.stringify(doc), async file => {
    const after = await addTeamTodo('  买  菜 ', 'user', file)
    assert.match(after.added, /^T-\d{4}-[0-9a-f]{4}$/, 'the id scheme matches the script')
    assert.equal(after.open, 2)
    const saved = JSON.parse(await readFile(file, 'utf8'))
    assert.equal(saved.items.length, 2, 'the existing item survives')
    assert.deepEqual(saved.items[1], {
      id: after.added, text: '买 菜', from: 'user', at: saved.items[1].at, done: false, doneAt: null,
    })
    assert.match(saved.items[1].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/, 'stamped like everything else')
  })
})

test('adding a text already open does not write a second copy', async () => {
  const doc = { version: 1, items: [{ id: 'T-1', text: '买菜', done: false }] }
  await withFile(JSON.stringify(doc), async file => {
    const before = await readFile(file, 'utf8')
    const after = await addTeamTodo(' 买菜 ', 'user', file)
    assert.equal(after.added, null)
    assert.equal(after.duplicate, 'T-1', 'it names the row that is already there')
    assert.equal(await readFile(file, 'utf8'), before, 'the file is untouched')
  })
})

test('an empty text adds nothing', async () => {
  await withFile(JSON.stringify({ version: 1, items: [] }), async file => {
    const after = await addTeamTodo('   ', 'user', file)
    assert.equal(after.added, null)
  })
})
