import { createElement as h, useEffect, useState } from 'react'
import { ChevronDownIcon } from './icons.js'
import { t } from './i18n.js'

// The team's to-do list, always in view at the top of the sidebar. It is not a second store:
// any Bot appends to one file with the team-todo skill, and the host reads that same file
// back through `teamTodo`. Nothing here writes, so the list can never disagree with itself.
//
// A re-read every half minute is a file read on a local channel, not a model call, so it
// costs nothing that matters and spares the user from refreshing to see what just landed.
const POLL_MS = 30_000

export function TeamTodoPanel({ actions }) {
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (typeof actions?.teamTodo !== 'function') return undefined
    let live = true
    const read = () => {
      // A host too old for the read, or one that fails it, leaves the panel as it was.
      void Promise.resolve(actions.teamTodo()).then(
        (value) => { if (live) setList(value) },
        () => {},
      )
    }
    read()
    const timer = setInterval(read, POLL_MS)
    return () => { live = false; clearInterval(timer) }
  }, [actions])
  // Nothing read yet, or a host that cannot answer: no panel rather than an empty one.
  if (list === null || list === undefined) return null
  const items = Array.isArray(list.items) ? list.items : []
  const count = Number.isFinite(list.open) ? list.open : items.length
  const label = t('Team to-do, {count} open', { count })
  return h('div', { className: 'bt-todo' },
    h('button', {
      type: 'button', className: 'bt-todo-head', title: label, 'aria-label': label,
      'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(value => !value),
    },
    h('span', { className: 'bt-todo-title' }, t('Team to-do')),
    count > 0 ? h('span', { className: 'bt-todo-count' }, String(count)) : null,
    h('span', { className: 'bt-todo-chev', 'data-open': open ? '' : undefined }, h(ChevronDownIcon))),
    open
      ? (items.length > 0
          ? h('ul', { className: 'bt-todo-list' },
              items.map(item => h('li', { key: item.id || item.text, className: 'bt-todo-item' },
                h('span', { className: 'bt-todo-text', title: item.text }, item.text),
                item.from ? h('span', { className: 'bt-todo-from' }, item.from) : null)))
          : h('div', { className: 'bt-todo-empty' }, t('Nothing open on the team to-do list')))
      // Folded away it still names the newest item: a count alone says nothing.
      : (items.length > 0 ? h('div', { className: 'bt-todo-peek', title: items[0].text }, items[0].text) : null),
  )
}

export const TEAM_TODO_CSS = `
.bt-todo{margin:6px 8px 2px;border-radius:10px;background:color-mix(in srgb,var(--bt-ink) 4%,transparent);overflow:hidden}
.bt-todo-head{display:flex;align-items:center;gap:6px;width:100%;padding:6px 8px;border:0;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left}
.bt-todo-head:hover{color:var(--bt-ink)}
.bt-todo-title{flex:none}
.bt-todo-count{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:color-mix(in srgb,var(--bt-star) 30%,transparent);color:color-mix(in srgb,var(--bt-star) 30%,var(--bt-ink));font-size:11px;line-height:16px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums}
.bt-todo-chev{flex:none;margin-left:auto;display:inline-flex;opacity:.55;transition:rotate .14s ease}
.bt-todo-chev[data-open]{rotate:180deg}
.bt-todo-peek{padding:0 8px 7px;font-size:12px;line-height:1.35;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-todo-list{margin:0;padding:0 4px 4px;list-style:none;max-height:220px;overflow-y:auto}
.bt-todo-item{display:flex;gap:6px;align-items:baseline;padding:4px;border-radius:6px;font-size:12px;line-height:1.35;color:var(--bt-ink-2)}
.bt-todo-item:hover{background:var(--bt-hover)}
.bt-todo-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-todo-from{flex:none;font-size:11px;color:var(--bt-ink-3)}
.bt-todo-empty{padding:0 8px 7px;font-size:12px;line-height:1.35;color:var(--bt-ink-3)}
`
