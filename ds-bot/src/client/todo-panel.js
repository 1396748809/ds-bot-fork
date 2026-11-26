import { createElement as h, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDownIcon, ResumeIcon } from './icons.js'
import { writeClipboard } from './dsh-primitives.js'
import { t } from './i18n.js'

// The team's to-do list. It is not a second store: any Bot appends to one file with the
// team-todo skill, and the host reads that same file back through `teamTodo`. Ticking an
// item is the only write, and it goes back through the host to the same file.
//
// A re-read every half minute is a file read on a local channel, not a model call, so it
// costs nothing that matters and spares the user from refreshing to see what just landed.
// A Bot writes this list from outside the window, so the window has nothing to listen to:
// the poll is the only signal that it changed. Five seconds is short enough that a row a Bot
// just put there is already showing when the user looks over, and long enough that re-reading
// a small file costs nothing. Anything written from inside the window is handled by the
// bt-todo-changed event below, which does not wait for a tick.
const POLL_MS = 5_000

const rowsOf = (list, key) => (Array.isArray(list?.[key]) ? list[key] : [])
const countOf = (list) => {
  const items = rowsOf(list, 'items')
  return Number.isFinite(list?.open) ? list.open : items.filter(item => item.done !== true).length
}

// One read and one writer for every view of the list, so the tab's badge and the list it
// opens can never disagree about the same file.
function useTodo(actions) {
  const [list, setList] = useState(null)
  useEffect(() => {
    if (typeof actions?.teamTodo !== 'function') return undefined
    let live = true
    const read = () => {
      // A host too old for the read, or one that fails it, leaves the view as it was.
      void Promise.resolve(actions.teamTodo()).then(
        (value) => { if (live) setList(value) },
        () => {},
      )
    }
    read()
    const timer = setInterval(read, POLL_MS)
    // Something written elsewhere in this window (a to-do added from the new-chat pane)
    // asks for a re-read at once, instead of waiting for the next poll.
    const asked = () => read()
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('bt-todo-changed', asked)
    // Coming back to the window is the one moment the list is most likely to be stale — a Bot
    // wrote it while the user was elsewhere. One read here means the row is there on arrival
    // instead of up to five seconds later.
    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      read()
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('focus', wake)
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', wake)
    return () => {
      live = false
      clearInterval(timer)
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener('bt-todo-changed', asked)
        window.removeEventListener('focus', wake)
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') document.removeEventListener('visibilitychange', wake)
    }
  }, [actions])
  const settle = (promise) => {
    void Promise.resolve(promise).then(
      (next) => { if (next && typeof next === 'object') setList(next) },
      () => {},
    )
  }
  // A tick marks the row where it stands and moves nothing: the row the user just clicked
  // stays under the cursor, and the rest of the list stays where it was. Done rows leave
  // only when the user asks for the clean-up.
  const tick = (item, done) => {
    if (typeof actions?.teamTodoCheck !== 'function') return
    setList(previous => {
      if (previous === null || previous === undefined) return previous
      const live = rowsOf(previous, 'items')
      const at = live.findIndex(row => row.id === item.id)
      if (at >= 0) {
        const next = live.slice()
        next[at] = { ...next[at], done, doneAt: done ? next[at].doneAt : '' }
        return {
          ...previous,
          open: next.filter(row => row.done !== true).length,
          done: next.filter(row => row.done === true).length,
          items: next,
        }
      }
      // Coming back from the history: it rejoins the list at its own added time —newest
      // first, so it goes in front of the first row that is older than it —and reads the
      // same way the host will report a moment later.
      const history = rowsOf(previous, 'history').filter(row => row.id !== item.id)
      const back = { ...item, done: false }
      const added = String(back.at ?? '')
      const before = live.findIndex(row => String(row.at ?? '') < added)
      return {
        ...previous,
        open: (Number(previous.open) || 0) + (done ? 0 : 1),
        done: Math.max(0, (Number(previous.done) || 0) - (done ? 1 : 0)),
        items: done ? live : before < 0 ? [...live, back] : [...live.slice(0, before), back, ...live.slice(before)],
        history: done ? history : history.filter(row => row.id !== item.id),
      }
    })
    settle(actions.teamTodoCheck(item.id, done))
  }
  // Every ticked row leaves in one step, on the user's own click.
  const clear = () => {
    if (typeof actions?.teamTodoClear !== 'function') return
    setList(previous => {
      if (previous === null || previous === undefined) return previous
      const live = rowsOf(previous, 'items')
      const leaving = live.filter(row => row.done === true)
      if (leaving.length === 0) return previous
      return {
        ...previous,
        open: live.filter(row => row.done !== true).length,
        done: 0,
        items: live.filter(row => row.done !== true),
        history: [...leaving.map(row => ({ ...row, clearedAt: '' })), ...rowsOf(previous, 'history')],
      }
    })
    settle(actions.teamTodoClear())
  }
  // An item of the user's own, written through the host like everything else here.
  const add = (text) => {
    const clean = String(text ?? '').trim()
    if (clean === '' || typeof actions?.teamTodoAdd !== 'function') return
    settle(actions.teamTodoAdd(clean))
  }
  // One ticked row leaving on its own, from its menu: the same file write as the clean-up,
  // narrowed to that row.
  const clearOne = (item) => {
    if (typeof actions?.teamTodoClearOne !== 'function') return
    setList(previous => {
      if (previous === null || previous === undefined) return previous
      const live = rowsOf(previous, 'items')
      const leaving = live.find(row => row.id === item.id)
      if (leaving === undefined) return previous
      return {
        ...previous,
        open: live.filter(row => row.done !== true).length,
        done: Math.max(0, (Number(previous.done) || 0) - 1),
        items: live.filter(row => row.id !== item.id),
        history: [{ ...leaving, clearedAt: '' }, ...rowsOf(previous, 'history')],
      }
    })
    settle(actions.teamTodoClearOne(item.id))
  }
  return { list, tick, clear, clearOne, add }
}

function TodoRow({ item, done, onTick, onMenu, onPeek }) {
  // A row a Bot put here and a row the user typed look the same otherwise, and the list is
  // mostly read at a glance. `from` is empty only for the oldest rows; anything that is not
  // the user's own entry came from a Bot, so it is tinted rather than trusted at a glance.
  const fromBot = Boolean(item.from) && String(item.from) !== 'user'
  return h('li', {
    key: item.id || item.text, className: 'bt-todo-item', 'data-done': done ? '' : undefined,
    'data-from': fromBot ? 'bot' : undefined,
    onContextMenu: onMenu ? (event) => { event.preventDefault(); onMenu(event, item) } : undefined,
    // A left press opens the whole line: the row is cut to one line, the card holds all of
    // it. The box is the one place a press means something else.
    onClick: onPeek ? (event) => { if (event.target?.closest?.('input')) return; onPeek(event, item) } : undefined,
  },
  h('input', {
    type: 'checkbox', className: 'bt-todo-box', checked: done,
    'aria-label': `${done ? t('Done') : t('Not done')} · ${item.text}`,
    title: done ? t('Put it back') : t('Done'),
    onChange: () => onTick(item, !done),
  }),
  h('span', { className: 'bt-todo-text' }, item.text),
  item.from ? h('span', { className: 'bt-todo-from' }, item.from) : null)
}

// The card a pressed row opens: the text in full, ready to select or copy, gone as soon as
// the pointer leaves it.
const portal = (node, key) => (typeof createPortal === 'function' && typeof document !== 'undefined' ? createPortal(node, document.body, key) : node)
const stampLabel = (stamp) => {
  const text = String(stamp ?? '')
  return text.length >= 16 ? `${text.slice(0, 10)} ${text.slice(11, 16)}` : ''
}

// The live rows carry their own tick, done or not, and stay in place. Below them the
// clean-up, and under that what has already left the list.
export function TodoLists({ list, showDone, onShowDone, tick, clear, onMenu }) {
  const rows = rowsOf(list, 'items')
  const history = rowsOf(list, 'history')
  const doneCount = rows.filter(row => row.done === true).length
  const archived = Number.isFinite(list?.done) ? rowsOf(list, 'history').length : history.length
  const [peek, setPeek] = useState(null)
  const [copied, setCopied] = useState(false)
  // The card follows the list: a scroll or an Escape puts it away with the row it belongs to.
  useEffect(() => {
    if (peek === null || typeof window === 'undefined') return undefined
    const hide = () => { setPeek(null); setCopied(false) }
    const onKey = (event) => { if (event.key === 'Escape') hide() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('scroll', hide, true) }
  }, [peek])
  const openPeek = (event, item) => {
    // The row is the card's switch: a second press on the same row puts the card away.
    if (peek !== null && peek.item.id === item.id) { setPeek(null); setCopied(false); return }
    const view = typeof window === 'undefined' ? { innerWidth: 1280, innerHeight: 800 } : window
    const box = event.currentTarget.getBoundingClientRect()
    const width = Math.min(320, view.innerWidth - 24)
    const lines = Math.ceil(String(item.text ?? '').length / 26) + 1
    const height = Math.min(300, 62 + Math.min(lines, 12) * 18)
    const left = Math.max(12, Math.min(box.left, view.innerWidth - width - 12))
    const below = box.bottom + 6
    setCopied(false)
    setPeek({ item, left, width, top: below + height > view.innerHeight - 12 ? Math.max(12, box.top - 6 - height) : below })
  }
  const copyButton = copied
    ? h('button', { type: 'button', className: 'bt-todo-card-copy', onClick: () => { void writeClipboard(peek.item.text) } }, t('Copied'))
    : h('button', { type: 'button', className: 'bt-todo-card-copy', onClick: () => { void writeClipboard(peek.item.text); setCopied(true) } }, t('Copy'))
  const peekCard = peek === null
    ? null
    : portal(h('div', {
        className: 'bt-todo-card', role: 'dialog', 'aria-label': peek.item.text,
        style: { left: `${peek.left}px`, top: `${peek.top}px`, width: `${peek.width}px` },
        onMouseLeave: () => {
          // Text selected by hand is someone copying it; the card waits until that is done.
          const picked = typeof window === 'undefined' ? '' : window.getSelection?.()?.toString?.() ?? ''
          if (picked !== '') return
          setPeek(null)
          setCopied(false)
        },
      },
      h('div', { className: 'bt-todo-card-meta' }, [peek.item.from, stampLabel(peek.item.at)].filter(Boolean).join(' · ')),
      h('div', { className: 'bt-todo-card-text' }, peek.item.text),
      copyButton), 'peek')
  return [
    rows.length > 0
      ? h('ul', { key: 'rows', className: 'bt-todo-list' },
          rows.map(item => h(TodoRow, { key: item.id || item.text, item, done: item.done === true, onTick: tick, onMenu, onPeek: openPeek })))
      : h('div', { key: 'empty', className: 'bt-todo-empty' }, t('Nothing open on the team to-do list')),
    doneCount > 0
      ? h('button', { key: 'clear', type: 'button', className: 'bt-todo-clear', onClick: clear },
          `${t('Clear done')} · ${doneCount}`)
      : null,
    archived > 0
      ? h('button', {
          key: 'done-head', type: 'button', className: 'bt-todo-history-head',
          'aria-expanded': showDone ? 'true' : 'false',
          onClick: onShowDone,
        },
        h('span', null, `${t('Done')} · ${archived}`),
        h('span', { className: 'bt-todo-chev', 'data-open': showDone ? '' : undefined }, h(ChevronDownIcon)))
      : null,
    showDone && history.length > 0
      ? h('ul', { key: 'done', className: 'bt-todo-list bt-todo-history' },
          history.map(item => h(TodoRow, { key: item.id || item.text, item, done: true, onTick: tick, onPeek: openPeek })))
      : null,
    peekCard,
  ]
}

// What a row offers besides its box: an open one offers the conversation it came from, so a
// task can be picked up where it was left; one the user typed here has no conversation to
// open, so it offers its own text instead; a ticked one offers to leave the list.
function TodoMenu({ menu, onClose, onOpen, onClear, onCopy }) {
  if (menu === null) return null
  const own = String(menu.item?.from ?? '') === 'user'
  const kind = menu.item?.done === true ? 'clear' : own ? 'copy' : 'open'
  const usable = kind === 'clear' ? typeof onClear === 'function' : kind === 'copy' ? typeof onCopy === 'function' : menu.canOpen === true
  const label = kind === 'clear' ? t('Clear item') : kind === 'copy' ? t('Copy') : t('Continue this chat')
  const run = () => {
    onClose()
    if (kind === 'clear') onClear(menu.item)
    else if (kind === 'copy') onCopy(menu.item)
    else onOpen(menu.item)
  }
  return [
    h('div', { key: 'scrim', className: 'bt-todo-scrim', onClick: onClose, onContextMenu: (event) => { event.preventDefault(); onClose() } }),
    h('div', {
      key: 'menu', className: 'bt-todo-menu', role: 'menu',
      style: { left: `${menu.x}px`, top: `${menu.y}px` },
    },
    h('button', {
      type: 'button', role: 'menuitem', className: 'bt-todo-menu-item', disabled: !usable,
      onClick: run,
    }, label)),
  ]
}

// A right-click on the to-do tab: the one thing that tab can be asked for before it is
// open — a new item of the user's own, which the input below the tabs then takes.
function AddTodoMenu({ menu, onClose, onAdd }) {
  if (menu === null) return null
  return [
    h('div', { key: 'scrim', className: 'bt-todo-scrim', onClick: onClose, onContextMenu: (event) => { event.preventDefault(); onClose() } }),
    h('div', {
      key: 'menu', className: 'bt-todo-menu', role: 'menu',
      style: { left: `${menu.x}px`, top: `${menu.y}px` },
    },
    h('button', {
      type: 'button', role: 'menuitem', className: 'bt-todo-menu-item',
      onClick: () => { onClose(); onAdd() },
    }, t('Add to-do'))),
  ]
}

// The sidebar's tab area. It has a fixed height of its own, so whatever a tab shows never
// moves the Bot list under it: the list is not one of the tabs, it is what sits below.
// The second tab holds the handful of things reached from the sidebar every day, so none of
// them needs a chat open first.
const VIEWS = [
  { id: 'todo', label: () => t('Team to-do') },
  { id: 'quick', label: () => t('Common actions') },
]

// The tab the user left open is remembered, so a reload comes back to it instead of dropping
// back to the to-do list every time. A window without storage simply starts on the first tab.
const VIEW_KEY = 'ds-bot:side-view'
function readSavedView() {
  try {
    const stored = globalThis.localStorage?.getItem(VIEW_KEY)
    return VIEWS.some(entry => entry.id === stored) ? stored : null
  } catch {
    return null
  }
}

function rememberView(id) {
  try {
    globalThis.localStorage?.setItem(VIEW_KEY, id)
  } catch {
    // A window that refuses storage keeps the choice for this visit only.
  }
}

// The second tab: a web address that opens in one press, then the services this machine runs.
// A service row goes through the local launcher on port 18920 (D:\知识库\service-launcher):
// the launcher starts the service when its port is closed, waits until it answers, and only
// then takes the browser to the real address — so a stopped service is one press away instead
// of a page that refuses to load. The id here must match the launcher's services.json.
const LAUNCHER_BASE = 'http://127.0.0.1:18920'
// How long a pressed row keeps saying it is starting before it leaves the news to the dot: a
// service that boots slower than this still opens in its own tab, which shows the progress.
const SERVICE_START_WAIT_MS = 45000
const LAUNCHER = `${LAUNCHER_BASE}/open/`
const QUICK_SERVICES = [
  { id: 'anythingllm', label: () => t('WeChat saved knowledge base'), url: 'http://localhost:3001/' },
  { id: 'goofish', label: () => t('Goofish monitor'), url: 'http://127.0.0.1:8000/' },
  { id: 'freemodel', label: () => t('Local model chat'), url: 'http://127.0.0.1:18901/' },
  { id: 'floorplan', label: () => t('Floorplan report site'), url: 'http://127.0.0.1:8123/' },
  { id: 'openmaic', label: () => t('OpenMAIC classroom'), url: 'http://127.0.0.1:3000/' },
  { id: 'openmaic-public', label: () => t('OpenMAIC classroom (public)'), url: 'https://openmaic.cdymail.top/' },
]

// Each service row also says whether its service is up, so a closed one is visible without
// pressing it. The launcher answers with one line per service; a launcher that is not answering
// leaves every row unknown rather than claiming the services are down. The poll is cheap (a port
// probe on loopback) and runs only while the second tab is the one on screen.
const SERVICE_POLL_MS = 8000
function useServiceStatus(watching) {
  const [state, setState] = useState({})
  // Bumped when something asks for a fresh answer right now (a row was just pressed), so the
  // dot flips as soon as the service is up instead of on the next turn of the poll.
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!watching) return undefined
    let live = true
    let timer = 0
    const read = async () => {
      try {
        const answer = await fetch(`${LAUNCHER_BASE}/api/list`, { cache: 'no-store' })
        const body = await answer.json()
        if (!live) return
        const next = {}
        for (const service of body?.services ?? []) next[service.id] = service.running === true
        setState(next)
      } catch {
        if (live) setState({})
      }
      if (live) timer = setTimeout(read, SERVICE_POLL_MS)
    }
    read()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [watching, revision])
  return [state, () => setRevision(value => value + 1)]
}

// What the user typed, as an address: a bare host gets a scheme, and a loopback host gets
// http, since that is where the machine's own services live.
function webAddress(text) {
  const raw = String(text ?? '').trim()
  if (raw === '') return null
  const scheme = /^[a-z][a-z\d+.-]*:/i.test(raw) ? '' : (/^(?:localhost|127\.\d|\d+\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(raw) ? 'http://' : 'https://')
  try {
    const url = new URL(`${scheme}${raw}`)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

// A right-click on a service row: the launcher can start a closed service or close a running
// one, and the row's own state decides which of the two is offered. Both are shown, so the
// answer to "what can this row do" never has to be guessed from a single item.
function ServiceMenu({ menu, onClose, onStart, onStop }) {
  if (menu === null) return null
  const running = menu.state === 'running'
  const busy = menu.state === 'starting' || menu.state === 'stopping'
  return [
    h('div', { key: 'scrim', className: 'bt-todo-scrim', onClick: onClose, onContextMenu: (event) => { event.preventDefault(); onClose() } }),
    h('div', {
      key: 'menu', className: 'bt-todo-menu', role: 'menu', 'data-service-menu': menu.id,
      style: { left: `${menu.x}px`, top: `${menu.y}px` },
    },
    h('button', {
      type: 'button', role: 'menuitem', className: 'bt-todo-menu-item', disabled: running || busy,
      onClick: () => onStart(menu.id),
    }, t('Start service')),
    h('button', {
      type: 'button', role: 'menuitem', className: 'bt-todo-menu-item', disabled: !running || busy,
      onClick: () => onStop(menu.id),
    }, t('Stop service'))),
  ]
}

// An address opens through a real link, the way every other outside link in this client does
// (about.js, connectors.js, the update notes): the desktop app gives a http(s) link to the
// system browser, while a scripted window.open can be refused and then look like a dead
// button.
function QuickActions({ text, setText, running, onStarted, notice }) {
  const typed = String(text ?? '').trim()
  const href = webAddress(typed)
  const usable = href !== null
  const link = useRef(null)
  // The row the user just pressed: the launcher is booting that service, which takes a few
  // seconds — the row says so, instead of looking like a click that did nothing.
  const [starting, setStarting] = useState(null)
  // The same for a row the menu just asked to close: the port takes a moment to drop.
  const [stopping, setStopping] = useState(null)
  // The row the user right-clicked, and where the menu opened.
  const [menu, setMenu] = useState(null)
  const start = async (id) => {
    // A service already up needs no spin: the tab it opens goes straight to it.
    if (running?.[id] === true) return
    setStarting(id)
    let timer = 0
    try {
      await Promise.race([
        fetch(`${LAUNCHER_BASE}/api/start/${id}`, { cache: 'no-store' }),
        new Promise((resolve) => { timer = setTimeout(resolve, SERVICE_START_WAIT_MS) }),
      ])
    } catch {
      // A launcher that cannot be reached leaves the browser page to report it.
    } finally {
      clearTimeout(timer)
    }
    setStarting(null)
    onStarted?.()
  }
  // Closing a service is the menu's other half: the launcher kills the process that holds the
  // service's port, and the row spins until the port is gone.
  const stop = async (id) => {
    setStopping(id)
    let answer = null
    try {
      answer = await fetch(`${LAUNCHER_BASE}/api/stop/${id}`, { cache: 'no-store' }).then(response => response.json())
    } catch {
      answer = null
    }
    setStopping(null)
    onStarted?.()
    if (answer?.ok === true) notice?.(t('Service stopped'))
    else notice?.(t('Could not stop the service'))
  }
  const stateOf = id => (starting === id ? 'starting' : stopping === id ? 'stopping' : running?.[id] === true ? 'running' : running?.[id] === false ? 'stopped' : 'unknown')
  const sayOf = (state) => (state === 'running' ? t('Running') : state === 'starting' ? t('Starting…') : state === 'stopping' ? t('Stopping…') : state === 'stopped' ? t('Not running') : t('Status unknown'))
  return h('div', { className: 'bt-quick-pane', role: 'tabpanel', id: 'bt-side-body', 'aria-labelledby': 'bt-tab-quick' },
    h('div', { className: 'bt-quick-url' },
      h('input', {
        className: 'bt-quick-input', type: 'text', value: text, spellCheck: false,
        placeholder: t('Type a web address'), 'aria-label': t('Type a web address'),
        onChange: event => setText(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Enter' && !event.nativeEvent?.isComposing && event.keyCode !== 229) {
            event.preventDefault()
            // Enter takes the same road as the link beside it.
            if (usable) link.current?.click()
          }
        },
      }),
      h('a', {
        ref: link, className: 'bt-quick-go', href: href ?? undefined,
        target: '_blank', rel: 'noopener noreferrer', 'aria-disabled': usable ? undefined : 'true',
        title: t('Open in the browser'), 'aria-label': t('Open in the browser'),
      }, t('Open'))),
    QUICK_SERVICES.map((service) => {
      const state = stateOf(service.id)
      return h('a', {
        key: service.id, className: 'bt-quick-row', 'data-quick': service.id, 'data-service-state': state,
        'data-starting': state === 'starting' ? 'true' : undefined,
        'data-stopping': state === 'stopping' ? 'true' : undefined,
        // The launcher's address, not the service's: pressing it starts the service first.
        href: `${LAUNCHER}${service.id}`, target: '_blank', rel: 'noopener noreferrer',
        title: `${service.url} · ${sayOf(state)}`,
        // The tab still opens; this is the row's own answer that the service is coming up.
        onClick: () => { void start(service.id) },
        // A right-click asks the launcher to close the service instead of opening it.
        onContextMenu: (event) => {
          event.preventDefault()
          event.stopPropagation()
          setMenu({ x: event.clientX, y: event.clientY, id: service.id, state })
        },
      },
      state === 'starting' || state === 'stopping' ? h('span', { className: 'bt-quick-spin', 'aria-hidden': true }) : h(ResumeIcon),
      h('span', { className: 'bt-quick-label' }, service.label()),
      h('span', { className: 'bt-quick-dot', 'data-state': state, 'aria-hidden': true }),
      h('span', { className: 'bt-quick-arrow', 'aria-hidden': true }, '\u2197'))
    }),
    h(ServiceMenu, {
      menu, onClose: () => setMenu(null),
      onStart: (id) => { setMenu(null); void start(id) },
      onStop: (id) => { setMenu(null); void stop(id) },
    }))
}

export function TeamTodoSide({ actions, view, onView, openFrom }) {
  const { list, tick, clear, clearOne, add } = useTodo(actions)
  const [showDone, setShowDone] = useState(false)
  const [picked, setPicked] = useState(readSavedView())
  const [menu, setMenu] = useState(null)
  // The right-click menu on the to-do tab, and the one-line input it opens.
  const [tabMenu, setTabMenu] = useState(null)
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState('')
  const writer = useRef(null)
  useEffect(() => {
    if (writing) writer.current?.focus()
  }, [writing])
  // The address typed into the second tab; it outlives tab switches, so a half-typed link is
  // still there when the user comes back.
  const [address, setAddress] = useState('')
  const count = countOf(list)
  const openMenu = (event, item) => setMenu({ x: event.clientX, y: event.clientY, item, canOpen: typeof openFrom === 'function' && openFrom(item.from, true) === true })
  // A row the user typed has no conversation behind it, so its menu offers the text itself.
  const copy = (item) => {
    const text = String(item?.text ?? '')
    if (text === '' || typeof writeClipboard !== 'function') return
    const announce = (ok) => { if (ok !== false) actions?.notice?.(t('Copied')) }
    try {
      const answer = writeClipboard(text)
      if (answer && typeof answer.then === 'function') void Promise.resolve(answer).then(announce, () => {})
      else announce(answer)
    } catch {
      // A window that refuses the clipboard leaves the row as it was.
    }
  }
  // The tab the user picked here wins over the one handed in, so the two tabs work whether
  // or not whoever placed this block keeps a view of its own.
  const wanted = picked ?? view
  const active = VIEWS.some(entry => entry.id === wanted) ? wanted : VIEWS[0].id
  const [serviceStatus, refreshServices] = useServiceStatus(active === 'quick')
  const select = (id) => { setPicked(id); rememberView(id); onView?.(id) }
  // One item per line entered: the input clears itself and stays open, so a few can follow in
  // a row without asking for the menu again.
  const write = () => {
    const text = draft.trim()
    if (text === '') return
    add(text)
    setDraft('')
  }
  const startWriting = () => {
    select('todo')
    setWriting(true)
  }
  return h('div', { className: 'bt-side-block' },
    h('div', { className: 'bt-tabs-row' },
      h('div', { className: 'bt-stabs', role: 'tablist', 'aria-label': t('Sidebar views') },
        VIEWS.map(entry => h('button', {
          key: entry.id, type: 'button', role: 'tab', className: 'bt-stab', id: `bt-tab-${entry.id}`,
          'aria-selected': active === entry.id ? 'true' : 'false', 'aria-controls': 'bt-side-body',
          onClick: () => select(entry.id),
          // The to-do tab answers a right-click with the one thing it offers before it is open.
          onContextMenu: entry.id === 'todo'
            ? (event) => { event.preventDefault(); event.stopPropagation(); setTabMenu({ x: event.clientX, y: event.clientY }) }
            : undefined,
        },
        h('span', { className: 'bt-stab-label' }, entry.label()),
        entry.id === 'todo' && count > 0 ? h('span', { className: 'bt-stab-count' }, String(count)) : null)))),
    active === 'todo' && writing
      ? h('div', { className: 'bt-todo-new' },
          h('input', {
            ref: writer, className: 'bt-todo-new-input', type: 'text', value: draft, spellCheck: false,
            placeholder: t('What needs doing?'), 'aria-label': t('Add to-do'),
            onChange: event => setDraft(event.target.value),
            onKeyDown: (event) => {
              if (event.nativeEvent?.isComposing || event.keyCode === 229) return
              if (event.key === 'Enter') { event.preventDefault(); write() }
              else if (event.key === 'Escape') { event.preventDefault(); setDraft(''); setWriting(false) }
            },
          }),
          h('button', { type: 'button', className: 'bt-todo-new-go', disabled: draft.trim() === '', onClick: write }, t('Add to-do')),
          h('button', { type: 'button', className: 'bt-todo-new-cancel', onClick: () => { setDraft(''); setWriting(false) } }, t('Cancel')))
      : null,
    active === 'todo'
      ? h('div', { className: 'bt-todo-pane', role: 'tabpanel', id: 'bt-side-body', 'aria-labelledby': 'bt-tab-todo' },
          h(TodoLists, { list, showDone, onShowDone: () => setShowDone(value => !value), tick, clear, onMenu: openMenu }))
      : h(QuickActions, { text: address, setText: setAddress, running: serviceStatus, onStarted: refreshServices, notice: actions?.notice }),
    h(TodoMenu, {
      menu, onClose: () => setMenu(null),
      onOpen: (item) => { if (typeof openFrom === 'function') openFrom(item.from, false, item.at) },
      onClear: clearOne,
      onCopy: copy,
    }),
    h(AddTodoMenu, { menu: tabMenu, onClose: () => setTabMenu(null), onAdd: startWriting }),
  )
}

// The folded panel: a header row with the count and the newest item, opening as a layer
// over the list below so unfolding never shoves it down.
export function TeamTodoPanel({ actions }) {
  const { list, tick, clear } = useTodo(actions)
  const [open, setOpen] = useState(false)
  const [showDone, setShowDone] = useState(false)
  if (list === null || list === undefined) return null
  const rows = rowsOf(list, 'items')
  const count = countOf(list)
  const label = t('Team to-do, {count} open', { count })
  // The newest item rides inside the header button, not in a block beside it: a block below
  // the button was clipped away once the sidebar ran out of room, leaving a count over
  // nothing. Anything the button paints, the sidebar cannot silently swallow.
  const newest = open ? undefined : rows.filter(row => row.done !== true)[0]?.text
  return h('div', { className: 'bt-todo' },
    h('button', {
      type: 'button', className: 'bt-todo-head', title: label, 'aria-label': label,
      'aria-expanded': open ? 'true' : 'false', onClick: () => setOpen(value => !value),
    },
    h('span', { className: 'bt-todo-line' },
      h('span', { className: 'bt-todo-title' }, t('Team to-do')),
      count > 0 ? h('span', { className: 'bt-todo-count' }, String(count)) : null,
      h('span', { className: 'bt-todo-chev', 'data-open': open ? '' : undefined }, h(ChevronDownIcon))),
    newest ? h('span', { className: 'bt-todo-peek', title: newest }, newest) : null),
    open
      ? h('div', { className: 'bt-todo-pop' },
          h(TodoLists, { list, showDone, onShowDone: () => setShowDone(value => !value), tick, clear }))
      : null,
  )
}

export const TEAM_TODO_CSS = `
.bt-side-block{display:flex;flex-direction:column;min-height:0;flex:none;height:var(--bt-side-block-h,220px)}
.bt-tabs-row{display:flex;align-items:center;gap:6px;flex:none;margin:7px 8px 3px}
/* The sidebar's own view tabs. They carry their own names (bt-stab*) so they cannot reach
   the details drawer's tablist, which uses bt-tabs/bt-tab inside the same document. */
.bt-stabs{display:flex;gap:4px;flex:1 1 auto;min-width:0;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--bt-ink) 5%,transparent)}
.bt-todo-add{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:18px;line-height:1;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.bt-todo-add:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-todo-add[aria-expanded=true]{background:var(--bt-active);color:var(--bt-ink)}
.bt-todo-add-glyph{display:block;margin-top:-1px}
.bt-todo-new{display:flex;align-items:center;gap:6px;flex:none;margin:0 8px 6px}
.bt-todo-new-input{flex:1 1 auto;min-width:0;height:28px;padding:0 9px;border:1px solid var(--bt-line-2);border-radius:8px;background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:12.5px}
.bt-todo-new-input:focus{outline:none;border-color:var(--bt-accent)}
.bt-todo-new-go,.bt-todo-new-cancel{flex:none;height:28px;padding:0 10px;border:0;border-radius:8px;font:inherit;font-size:12px;cursor:pointer}
.bt-todo-new-go{background:var(--bt-accent);color:var(--bt-accent-ink)}
.bt-todo-new-go:disabled{opacity:.5;cursor:default}
.bt-todo-new-cancel{background:var(--bt-hover);color:var(--bt-ink-2)}
.bt-stab{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:5px;height:26px;padding:0 8px;border:0;border-radius:7px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;font-weight:600;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.bt-stab:hover{color:var(--bt-ink)}
.bt-stab[aria-selected=true]{background:var(--bt-card);color:var(--bt-ink);box-shadow:0 1px 3px rgba(20,20,20,.1)}
.bt-stab-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-stab-count{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:color-mix(in srgb,var(--bt-star) 30%,transparent);color:color-mix(in srgb,var(--bt-star) 30%,var(--bt-ink));font-size:11px;line-height:16px;font-weight:600;font-variant-numeric:tabular-nums}
.bt-todo-pane{flex:1 1 auto;min-height:0;overflow-y:auto;margin:0 8px 6px;padding:2px 0;border-radius:10px}
.bt-quick-pane{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:none;box-sizing:border-box;margin:0 8px 6px;padding:2px 0;border-radius:10px;display:flex;flex-direction:column;gap:2px}
.bt-quick-pane::-webkit-scrollbar{width:0;height:0}
.bt-quick-url{flex:none;display:flex;align-items:center;gap:6px;box-sizing:border-box;width:100%;min-width:0;padding:2px 0 4px}
.bt-quick-input{flex:1 1 auto;min-width:0;box-sizing:border-box;height:28px;padding:0 9px;border:1px solid var(--bt-line-2);border-radius:8px;background:var(--bt-main);color:var(--bt-ink);font:inherit;font-size:12.5px}
.bt-quick-input::placeholder{color:var(--bt-ink-3)}
.bt-quick-input:focus{outline:none;border-color:var(--bt-accent)}
.bt-quick-go{flex:none;display:inline-flex;align-items:center;box-sizing:border-box;height:28px;padding:0 11px;border-radius:8px;background:var(--bt-accent);color:var(--bt-accent-ink);font:inherit;font-size:12px;font-weight:500;text-decoration:none;cursor:pointer}
.bt-quick-go[aria-disabled=true]{opacity:.45;cursor:default;pointer-events:none}
.bt-quick-arrow{flex:none;font-size:11px;color:var(--bt-ink-3)}
.bt-quick-row:hover .bt-quick-arrow{color:var(--bt-ink-2)}
.bt-quick-row{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-width:0;min-height:28px;padding:0 8px;border-radius:8px;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px;font-weight:500;text-align:left;text-decoration:none;cursor:pointer;transition:background-color .12s ease}
.bt-quick-row:hover{background:var(--bt-hover)}
.bt-quick-row svg{flex:none;width:16px;height:16px;color:var(--bt-ink-2)}
.bt-quick-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* A service that is up glows green, one that is closed is a hollow ring, and one the launcher
   has not answered for yet stays a faint dot rather than claiming either. */
.bt-quick-dot{flex:none;width:7px;height:7px;border-radius:50%;corner-shape:round;background:var(--bt-ink-3);transition:background-color .14s ease,box-shadow .14s ease}
.bt-quick-dot[data-state=running]{background:var(--bt-green);box-shadow:0 0 0 2px color-mix(in srgb,var(--bt-green) 20%,transparent)}
.bt-quick-dot[data-state=stopped]{background:transparent;box-shadow:inset 0 0 0 1.5px var(--bt-ink-3)}
.bt-quick-dot[data-state=unknown]{opacity:.35}
/* A pressed row spins in place of its play mark until the launcher says the service is up. */
.bt-quick-dot[data-state=starting]{background:var(--bt-accent);animation:bt-quick-beat 1s ease-in-out infinite}
/* A row the menu just asked to close beats the same way until the port is gone. */
.bt-quick-dot[data-state=stopping]{background:var(--bt-ink-2);animation:bt-quick-beat 1s ease-in-out infinite}
.bt-quick-spin{flex:none;box-sizing:border-box;width:16px;height:16px;border:1.6px solid color-mix(in srgb,var(--bt-ink-3) 40%,transparent);border-top-color:var(--bt-accent);border-radius:50%;animation:bt-quick-spin .72s linear infinite}
@keyframes bt-quick-spin{to{transform:rotate(360deg)}}
@keyframes bt-quick-beat{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.bt-quick-spin{animation:none;border-top-color:var(--bt-ink-3)}.bt-quick-dot[data-state=starting]{animation:none}}
.bt-todo-clear{display:block;width:calc(100% - 8px);margin:2px 4px 4px;padding:5px 8px;border:0;border-radius:7px;background:var(--bt-hover);color:#000;font:inherit;font-size:11px;cursor:pointer;text-align:center}
.bt-todo-clear:hover{background:var(--bt-active);color:#000}
.bt-todo-scrim{position:fixed;inset:0;z-index:90}
.bt-todo-menu{position:fixed;z-index:91;min-width:150px;padding:4px;border-radius:9px;border:1px solid var(--bt-line);background:var(--bt-card);box-shadow:0 12px 30px -10px rgba(20,20,20,.32)}
.bt-todo-menu-item{display:block;width:100%;padding:7px 10px;border:0;border-radius:6px;background:none;color:var(--bt-ink);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}
.bt-todo-menu-item:hover:not(:disabled){background:var(--bt-hover)}
.bt-todo-menu-item:disabled{color:var(--bt-ink-3);cursor:default}
.bt-todo{position:relative;margin:2px 8px 2px;border-radius:10px;background:color-mix(in srgb,var(--bt-ink) 4%,transparent);flex:none}
.bt-todo-pop{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:40;max-height:300px;overflow-y:auto;padding:4px;border-radius:10px;border:1px solid var(--bt-line);background:var(--bt-card);box-shadow:0 14px 32px -12px rgba(20,20,20,.3),0 2px 8px -2px rgba(20,20,20,.12)}
.bt-todo-head{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:100%;padding:6px 8px;border:0;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-align:left}
.bt-todo-head:hover{color:var(--bt-ink)}
.bt-todo-line{display:flex;align-items:center;gap:6px;min-width:0}
.bt-todo-title{flex:none}
.bt-todo-count{flex:none;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:color-mix(in srgb,var(--bt-star) 30%,transparent);color:color-mix(in srgb,var(--bt-star) 30%,var(--bt-ink));font-size:11px;line-height:16px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums}
.bt-todo-chev{flex:none;margin-left:auto;display:inline-flex;opacity:.55;transition:rotate .14s ease}
.bt-todo-chev[data-open]{rotate:180deg}
.bt-todo-peek{display:block;font-weight:400;font-size:12px;line-height:1.35;color:var(--bt-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bt-todo-list{margin:0;padding:0 4px 4px;list-style:none;max-height:none;overflow:visible}
.bt-todo-item{display:flex;gap:6px;align-items:baseline;padding:4px;border-radius:6px;font-size:12px;line-height:1.35;color:var(--bt-ink)}
.bt-todo-item:hover{background:var(--bt-hover)}
.bt-todo-box{flex:none;width:13px;height:13px;margin:0;align-self:center;accent-color:var(--bt-accent);cursor:pointer}
.bt-todo-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-todo-from{flex:none;font-size:11px;color:var(--bt-ink-2)}
.bt-todo-item[data-from="bot"] .bt-todo-text{color:var(--bt-accent)}
.bt-todo-item[data-done]{opacity:.55}
.bt-todo-item[data-done] .bt-todo-text{text-decoration:line-through}
.bt-todo-history-head{display:flex;align-items:center;gap:6px;width:100%;padding:5px 8px;border:0;border-top:1px solid var(--bt-line);background:none;color:var(--bt-ink-3);font:inherit;font-size:11px;cursor:pointer;text-align:left}
.bt-todo-history-head:hover{color:var(--bt-ink-2)}
.bt-todo-history{max-height:none}
.bt-todo-empty{padding:0 8px 7px;font-size:12px;line-height:1.35;color:var(--bt-ink-3)}
/* The card a pressed row opens: the whole line, selectable, with copy one press away. */
.bt-todo-card{position:fixed;z-index:70;display:flex;flex-direction:column;gap:7px;padding:10px 12px;border-radius:10px;border:1px solid var(--bt-line);background:var(--bt-card);box-shadow:0 14px 32px -12px rgba(20,20,20,.3),0 2px 8px -2px rgba(20,20,20,.12);color:var(--bt-ink);font-family:var(--bt-font);font-size:12.5px;line-height:1.45;box-sizing:border-box}
.bt-todo-card-meta{font-size:11px;line-height:15px;color:var(--bt-ink-3)}
.bt-todo-card-text{max-height:220px;overflow-y:auto;white-space:pre-wrap;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text;cursor:text}
.bt-todo-card-copy{align-self:flex-start;padding:2px 10px;border:1px solid var(--bt-line-2);border-radius:999px;background:transparent;color:var(--bt-ink-2);font:inherit;font-size:11px;line-height:18px;cursor:pointer}
.bt-todo-card-copy:hover{background:var(--bt-hover);color:var(--bt-ink)}
`
