import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

// One file outside every Session holds the team's to-do list. Any Bot appends to it with
// the team-todo skill; the sidebar reads it back through here. A list with exactly one
// copy is the only kind that stays true, so nothing else keeps one.
export const teamTodoPath = () => join(homedir(), '.ds-bot', 'team-todo.json')

// Enough to fill a panel; a list longer than this has stopped being something to read.
const OPEN_LIMIT = 40

const line = text => String(text ?? '').replace(/\s+/g, ' ').trim()

export async function readTeamTodo(file = teamTodoPath()) {
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    // No file yet is the ordinary state before the first item, not a failure.
    if (error?.code === 'ENOENT') return { items: [], open: 0, done: 0 }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // A half-written or hand-edited file must not take the sidebar down with it.
    return { items: [], open: 0, done: 0, broken: true }
  }
  const all = Array.isArray(parsed?.items) ? parsed.items.filter(item => item && typeof item === 'object') : []
  const cleaned = all
    .map(item => ({ id: String(item.id ?? ''), text: line(item.text), from: line(item.from), at: String(item.at ?? ''), done: item.done === true }))
    .filter(item => item.text !== '')
  const open = cleaned.filter(item => !item.done)
  return {
    open: open.length,
    done: cleaned.length - open.length,
    items: open.slice(0, OPEN_LIMIT).map(({ id, text, from, at }) => ({ id, text, from, at })),
  }
}
