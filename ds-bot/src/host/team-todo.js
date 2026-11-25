import { randomBytes } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// One file outside every Session holds the team's to-do list. Any Bot appends to it with
// the team-todo skill; the sidebar reads it back through here. A list with exactly one
// copy is the only kind that stays true, so nothing else keeps one.
export const teamTodoPath = () => join(homedir(), '.ds-bot', 'team-todo.json')

// Enough to fill a panel; a list longer than this has stopped being something to read.
const OPEN_LIMIT = 40
// The done side is a history rather than a list: the recent ones only, newest first.
const HISTORY_LIMIT = 40

const line = text => String(text ?? '').replace(/\s+/g, ' ').trim()

const pad = n => String(n).padStart(2, '0')

// The same id shape the skill hands out, so an item added from the sidebar and one added by
// a Bot are the same kind of thing.
function newId(d = new Date()) {
  return `T-${pad(d.getMonth() + 1)}${pad(d.getDate())}-${randomBytes(2).toString('hex')}`
}

// The same stamp the skill writes, so a tick from the sidebar and a tick from a Bot's
// command are indistinguishable in the file afterwards.
function stamp(now = new Date()) {
  const off = -now.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const abs = Math.abs(off)
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

export async function readTeamTodo(file = teamTodoPath()) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    // No file yet is the ordinary state before the first item, not a failure.
    if (error?.code === 'ENOENT') return { items: [], open: 0, done: 0, history: [] }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A half-written or hand-edited file must not take the sidebar down with it.
    return { items: [], open: 0, done: 0, history: [], broken: true }
  }
  const all = Array.isArray(parsed?.items) ? parsed.items.filter(item => item && typeof item === 'object') : []
  const cleaned = all
    .map(item => ({
      id: String(item.id ?? ''),
      text: line(item.text),
      from: line(item.from),
      at: String(item.at ?? ''),
      done: item.done === true,
      doneAt: String(item.doneAt ?? ''),
      cleared: item.cleared === true,
      clearedAt: String(item.clearedAt ?? ''),
    }))
    .filter(item => item.text !== '')
  // A tick keeps the row where it is: the list is read newest first, done or not, and only
  // the user's own clean-up moves anything out of it. Sorting by the added time rather than
  // by file position is what puts a row back in its own place when it comes out of the
  // history again.
  const added = (item) => String(item.at ?? '')
  const live = cleaned.filter(item => !item.cleared).sort((a, b) => (added(a) < added(b) ? 1 : added(a) > added(b) ? -1 : 0))
  const archived = cleaned.filter(item => item.cleared)
  const history = archived
    .map((item, at) => ({ item, at }))
    .sort((a, b) => {
      const left = a.item.clearedAt || a.item.doneAt
      const right = b.item.clearedAt || b.item.doneAt
      return left < right ? 1 : left > right ? -1 : b.at - a.at
    })
    .map(({ item }) => item)
  return {
    open: live.filter(item => !item.done).length,
    done: live.filter(item => item.done).length,
    items: live.slice(0, OPEN_LIMIT).map(({ id, text, from, at, done, doneAt }) => ({ id, text, from, at, done, doneAt })),
    history: history.slice(0, HISTORY_LIMIT).map(({ id, text, from, at, doneAt, clearedAt }) => ({ id, text, from, at, doneAt, clearedAt })),
  }
}

// A tick from the sidebar is the one write a person makes here. It marks the item and keeps
// its place, so ticking one row never moves another out from under the cursor.
export async function setTeamTodoDone(id, done = true, file = teamTodoPath()) {
  const key = String(id ?? '')
  if (key === '') return { ...(await readTeamTodo(file)), changed: false }
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...(await readTeamTodo(file)), changed: false }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...(await readTeamTodo(file)), changed: false }
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  const index = items.findIndex(item => item && typeof item === 'object' && String(item.id ?? '') === key)
  if (index < 0) return { ...(await readTeamTodo(file)), changed: false }
  // In place, never moved: ticking a row must not make it jump. A row whose box is unticked
  // leaves the clean-up history in the same write — the `cleared` flag is the only thing
  // keeping it there, so leaving it set would put the row straight back where it was.
  items[index] = done === true
    ? { ...items[index], done: true, doneAt: stamp() }
    : { ...items[index], done: false, doneAt: null, cleared: false, clearedAt: null }
  const doc = { ...parsed, version: parsed?.version ?? 1, items }
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return { ...(await readTeamTodo(file)), changed: true }
}

// The clean-up the user asks for: every ticked item leaves the list in one go. Doing it on
// each tick would move a row on every click, which is exactly what the list must not do.
// The row's own menu clears a single one through the same writer.
async function clearTicked(file, matches) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...(await readTeamTodo(file)), cleared: 0 }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ...(await readTeamTodo(file)), cleared: 0 }
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  const at = stamp()
  let cleared = 0
  const next = items.map(item => {
    if (!item || typeof item !== 'object' || item.done !== true || item.cleared === true) return item
    if (!matches(item)) return item
    cleared += 1
    return { ...item, cleared: true, clearedAt: at }
  })
  if (cleared === 0) return { ...(await readTeamTodo(file)), cleared: 0 }
  const doc = { ...parsed, version: parsed?.version ?? 1, items: next }
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return { ...(await readTeamTodo(file)), cleared }
}

// The clean-up the user asks for: every ticked item leaves the list in one go.
export const clearTeamTodoDone = (file = teamTodoPath()) => clearTicked(file, () => true)

// One row leaving on its own, from that row's menu.
export const clearTeamTodoItem = (id, file = teamTodoPath()) => clearTicked(file, item => String(item.id ?? '') === String(id))

// The user's own item, written from the sidebar. Same file, same shape, same id scheme as
// the skill, so a Bot reading the list cannot tell which of them put it there.
export async function addTeamTodo(text, from = '', file = teamTodoPath()) {
  const clean = line(text)
  if (clean === '') return { ...(await readTeamTodo(file)), added: null }
  let parsed = { version: 1, items: [] }
  try {
    const raw = await readFile(file, 'utf8')
    if (raw.trim() !== '') parsed = JSON.parse(raw)
  } catch (error) {
    if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : []
  // The same text already open: say so instead of adding a second copy.
  const same = items.find(item => item && item.done !== true && item.cleared !== true && line(item.text) === clean)
  if (same) return { ...(await readTeamTodo(file)), added: null, duplicate: String(same.id ?? '') }
  const item = { id: newId(), text: clean, from: line(from) || 'user', at: stamp(), done: false, doneAt: null }
  const doc = { ...parsed, version: parsed?.version ?? 1, items: [...items, item] }
  const temp = `${file}.tmp-${process.pid}`
  await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  await rename(temp, file)
  return { ...(await readTeamTodo(file)), added: item.id }
}
