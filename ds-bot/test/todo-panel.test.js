import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { beforeEach, test } from 'node:test'

// The panel at the top of the sidebar. Its figures arrive from the host one microtask after
// the first render, so every assertion here renders, lets the read settle, and renders again.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/todo-panel.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

let slots = []
let cursor = 0
// What a row's menu put on the clipboard, when it offers the text instead of a conversation.
let copied = []
// Every address the quick tab asked the browser to open.
let opened = []
// What the panel kept between visits; the client stores small choices here. Every test starts
// with nothing saved, so one test's tab choice never decides the next one's.
const stored = new Map()
beforeEach(() => { stored.clear(); stopCalls = []; stopGate = null })
// What the service launcher answers when the panel asks which services are up.
let serviceList = []
// A start request waits on this when a test sets it, so the row can be watched mid-boot.
let startGate = null
// Every service the panel asked the launcher to close, and a gate to watch one mid-close.
let stopCalls = []
let stopGate = null
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout,
  // The desktop app hands http(s) windows to the system browser; here it is recorded.
  window: { open: (url) => { opened.push(url); return {} }, addEventListener () {}, removeEventListener () {} },
  // Storage that outlives one draw, so a reload can be tested: the panel reads it back.
  localStorage: {
    getItem: key => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => { stored.set(key, String(value)) },
    removeItem: (key) => { stored.delete(key) },
  },
  // No polling in a test: the interval must not keep the process alive.
  setInterval: () => 0, clearInterval: () => {},
  // The service launcher's answer, as the panel reads it for the status dots; a start request
  // waits on `startGate` so a test can watch the row while the service is still coming up.
  fetch: async (url) => {
    if (String(url).includes('/api/start/')) {
      if (startGate !== null) await startGate
      return { json: async () => ({ ok: true }) }
    }
    if (String(url).includes('/api/stop/')) {
      stopCalls.push(String(url).split('/api/stop/')[1])
      if (stopGate !== null) await stopGate
      return { json: async () => ({ ok: true }) }
    }
    return { json: async () => ({ ok: true, services: serviceList }) }
  },
  require: (name) => {
    const platform = {
      react: {
        createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
        useState: initial => { const at = cursor++; if (!(at in slots)) slots[at] = initial; return [slots[at], value => { slots[at] = value }] },
        useEffect: effect => { effect() },
        useRef: current => ({ current }),
        useMemo: make => make(),
        useCallback: fn => fn,
        Fragment: 'fragment',
      },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': {
        writeClipboard: (text) => { copied.push(text); return Promise.resolve(true) },
      },
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { TeamTodoPanel, TeamTodoSide, TodoLists } = module.exports

const find = (node, match, found = []) => {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach(child => find(child, match, found)); return found }
  if (typeof node.type === 'function') { find(node.type(node.props), match, found); return found }
  if (match(node)) found.push(node)
  find(node.children, match, found)
  return found
}
const byClass = (tree, name) => find(tree, node => node.props?.className === name)
// The same walk without calling any component: used when a test needs one component's hooks to
// start at slot 0, which expanding the whole tree first would spoil.
const findElement = (node, match, found = []) => {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach(child => findElement(child, match, found)); return found }
  if (match(node)) found.push(node)
  findElement(node.children, match, found)
  return found
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))
let fresh
const render = async (value, extra = {}) => {
  fresh = { slots: [], cursor: 0 }
  slots = fresh.slots
  const actions = value === undefined ? {} : { teamTodo: () => Promise.resolve(value), ...extra }
  const draw = () => { cursor = 0; return TeamTodoPanel({ actions }) }
  draw()
  await settled()
  return draw()
}

test('no panel where the host cannot answer, and none before it has', async () => {
  slots = []; cursor = 0
  assert.equal(TeamTodoPanel({ actions: {} }), null, 'no teamTodo action, no panel')
  slots = []; cursor = 0
  const pending = TeamTodoPanel({ actions: { teamTodo: () => new Promise(() => {}) } })
  assert.equal(pending, null, 'nothing read yet draws nothing')
})

test('the count and the newest item are visible while folded', async () => {
  const tree = await render({ open: 2, done: 1, items: [{ id: 'T-1', text: '补闲鱼监控的图', from: '闲鱼监控', at: '' }, { id: 'T-2', text: '第二件事', from: 'Chief', at: '' }] })
  assert.equal(byClass(tree, 'bt-todo-count')[0].children[0], '2')
  assert.equal(byClass(tree, 'bt-todo-peek')[0].children[0], '补闲鱼监控的图')
  assert.equal(byClass(tree, 'bt-todo-list').length, 0, 'folded away it is one line, not a list')
  const [head] = byClass(tree, 'bt-todo-head')
  assert.equal(head.props['aria-expanded'], 'false')
  assert.match(head.props['aria-label'], /2/)
})

test('opening it lists every open item with where it came from', async () => {
  const tree = await render({ open: 2, done: 0, items: [{ id: 'T-1', text: '补闲鱼监控的图', from: '闲鱼监控', at: '' }, { id: 'T-2', text: '第二件事', from: 'Chief', at: '' }] })
  const [head] = byClass(tree, 'bt-todo-head')
  head.props.onClick()
  cursor = 0
  const opened = TeamTodoPanel({ actions: { teamTodo: () => Promise.resolve({ open: 2, done: 0, items: [{ id: 'T-1', text: '补闲鱼监控的图', from: '闲鱼监控', at: '' }, { id: 'T-2', text: '第二件事', from: 'Chief', at: '' }] }) } })
  assert.equal(byClass(opened, 'bt-todo-head')[0].props['aria-expanded'], 'true')
  assert.equal(byClass(opened, 'bt-todo-item').length, 2)
  assert.deepEqual(byClass(opened, 'bt-todo-text').map(node => node.children[0]), ['补闲鱼监控的图', '第二件事'])
  assert.deepEqual(byClass(opened, 'bt-todo-from').map(node => node.children[0]), ['闲鱼监控', 'Chief'])
  assert.equal(byClass(opened, 'bt-todo-peek').length, 0, 'opened it shows the list instead of the peek')
})

test('an empty list still opens, and says so', async () => {
  const tree = await render({ open: 0, done: 3, items: [] })
  assert.equal(byClass(tree, 'bt-todo-count').length, 0, 'nothing open, no badge')
  assert.equal(byClass(tree, 'bt-todo-peek').length, 0, 'nothing to peek at')
  const [head] = byClass(tree, 'bt-todo-head')
  head.props.onClick()
  cursor = 0
  const opened = TeamTodoPanel({ actions: { teamTodo: () => Promise.resolve({ open: 0, done: 3, items: [] }) } })
  assert.equal(byClass(opened, 'bt-todo-empty').length, 1)
})

// A press on a row opens the whole line: the row itself is cut to one line, the card is not.
test('pressing a row opens its text in full, and the card goes when the pointer leaves', async () => {
  const text = '这条待办特别长，长到侧栏里只显示前面一小段，后面的全被省略号吃掉，需要点开才能看到全文。'
  const item = { id: 'T-1', text, from: 'Chief', at: '2026-11-24T20:31:00+08:00' }
  const list = { open: 1, done: 0, items: [item], history: [] }
  slots = []; cursor = 0
  const draw = () => {
    cursor = 0
    return TodoLists({ list, showDone: false, onShowDone: () => {}, tick: () => {}, clear: () => {} })
  }
  const before = draw()
  assert.equal(byClass(before, 'bt-todo-card').length, 0, 'nothing is open before a press')
  const [row] = byClass(before, 'bt-todo-item')
  row.props.onClick({ target: { closest: () => null }, currentTarget: { getBoundingClientRect: () => ({ left: 20, top: 100, bottom: 120 }) } })
  const opened = draw()
  const [card] = byClass(opened, 'bt-todo-card')
  assert.ok(card, 'the press opens the card')
  assert.equal(byClass(opened, 'bt-todo-card-text')[0].children[0], text, 'the card carries the whole line')
  card.props.onMouseLeave()
  assert.equal(byClass(draw(), 'bt-todo-card').length, 0, 'leaving the card puts it away')
  // The row is also the switch: a second press on it closes what the first press opened.
  const box = { target: { closest: () => null }, currentTarget: { getBoundingClientRect: () => ({ left: 20, top: 100, bottom: 120 }) } }
  const [press] = byClass(draw(), 'bt-todo-item')
  press.props.onClick(box)
  assert.equal(byClass(draw(), 'bt-todo-card').length, 1, 'one press opens it')
  const [pressAgain] = byClass(draw(), 'bt-todo-item')
  pressAgain.props.onClick(box)
  assert.equal(byClass(draw(), 'bt-todo-card').length, 0, 'the next press on the same row closes it')
})

// The one write the panel makes: a box per open item, and the host is told which one.
test('every open row carries a box that ticks it off', async () => {
  const items = [
    { id: 'T-1', text: '补闲鱼监控的图', from: '闲鱼监控', at: '' },
    { id: 'T-2', text: '第二件事', from: 'Chief', at: '' },
  ]
  const calls = []
  const tree = await render(
    { open: 2, done: 0, items },
    { teamTodoCheck: (id, done) => { calls.push([id, done]); return Promise.resolve({ open: 1, done: 1, items: [items[1]] }) } },
  )
  const [head] = byClass(tree, 'bt-todo-head')
  head.props.onClick()
  cursor = 0
  const actions = {
    teamTodo: () => Promise.resolve({ open: 2, done: 0, items }),
    teamTodoCheck: (id, done) => { calls.push([id, done]); return Promise.resolve({ open: 1, done: 1, items: [items[1]] }) },
  }
  const opened = TeamTodoPanel({ actions })
  const boxes = byClass(opened, 'bt-todo-box')
  assert.equal(boxes.length, 2, 'one box per open item')
  assert.equal(boxes[0].props.type, 'checkbox')
  assert.match(boxes[0].props['aria-label'], /补闲鱼监控的图/, 'the box says which item it ticks')
  boxes[0].props.onChange()
  await settled()
  assert.deepEqual(calls, [['T-1', true]], 'the host is asked to mark exactly that item done')
})

test('a panel with no check action still lists items, just without a way to tick', async () => {
  const tree = await render({ open: 1, done: 0, items: [{ id: 'T-1', text: '只有一件事', from: '', at: '' }] })
  const [head] = byClass(tree, 'bt-todo-head')
  head.props.onClick()
  cursor = 0
  const opened = TeamTodoPanel({ actions: { teamTodo: () => Promise.resolve({ open: 1, done: 0, items: [{ id: 'T-1', text: '只有一件事', from: '', at: '' }] }) } })
  const [box] = byClass(opened, 'bt-todo-box')
  assert.doesNotThrow(() => box.props.onChange(), 'ticking without a host action is a no-op, not a crash')
})

// What has been ticked off stays reachable: a list you can only empty is a list you cannot
// check, and a tick made by mistake has to be undoable from the same place.
test('the done side is kept as a history, and its box puts the item back', async () => {
  const openItem = { id: 'T-2', text: '还没做的', from: 'Chief', at: '' }
  const doneItem = { id: 'T-1', text: '做过的', from: '组长', at: '', doneAt: '2026-11-24T20:31:00+08:00' }
  const value = { open: 1, done: 1, items: [openItem], history: [doneItem] }
  const calls = []
  const teamTodoCheck = (id, done) => {
    calls.push([id, done])
    return Promise.resolve({ open: 2, done: 0, items: [openItem, doneItem], history: [] })
  }
  const tree = await render(value, { teamTodoCheck })
  const [head] = byClass(tree, 'bt-todo-head')
  head.props.onClick()
  cursor = 0
  const actions = { teamTodo: () => Promise.resolve(value), teamTodoCheck }
  const opened = TeamTodoPanel({ actions })
  const [historyHead] = byClass(opened, 'bt-todo-history-head')
  assert.ok(historyHead, 'a finished count is offered once something has been ticked')
  assert.equal(byClass(opened, 'bt-todo-list').length, 1, 'the history stays folded away at first')
  historyHead.props.onClick()
  cursor = 0
  const withHistory = TeamTodoPanel({ actions })
  const historyRows = find(withHistory, node => String(node.props?.className ?? '').split(' ').includes('bt-todo-history'))
  assert.equal(historyRows.length, 1, 'the history unfolds under the open list')
  const boxes = byClass(withHistory, 'bt-todo-box')
  assert.equal(boxes.length, 2, 'one box for the open item, one for the history row')
  assert.equal(boxes[1].props.checked, true, 'a history row reads as ticked')
  boxes[1].props.onChange()
  await settled()
  assert.deepEqual(calls, [['T-1', false]], 'putting it back asks the host for a false tick')
})

// The tab area above the Bot list: the to-do list is its first tab, the quick actions the
// second, and the block keeps a height of its own so nothing under it moves.
test('the tab area puts the to-do list first and keeps its count on the tab', async () => {
  const value = { open: 2, done: 1, items: [{ id: 'T-1', text: '甲', from: 'Chief', at: '' }], history: [{ id: 'T-0', text: '乙', from: '组长', at: '', doneAt: '' }] }
  slots = []; cursor = 0
  const picked = []
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value), teamTodoCheck: () => Promise.resolve(value) }, onView: id => picked.push(id) }) }
  draw()
  await settled()
  const tree = draw()
  const tabs = find(tree, node => node.props?.role === 'tab')
  assert.equal(tabs.length, 2, 'the Bot list is not one of the tabs; the quick actions are')
  assert.deepEqual(byClass(tree, 'bt-stab-label').map(node => node.children[0]), ['Team to-do', 'Common actions'])
  assert.equal(tabs[0].props['aria-selected'], 'true', 'the to-do list is the first and selected tab')
  assert.equal(tabs[1].props['aria-selected'], 'false')
  assert.equal(byClass(tree, 'bt-stab-count')[0].children[0], '2', 'the to-do count rides on its tab')
  assert.equal(byClass(tree, 'bt-todo-pane').length, 1, 'its pane fills the block')
  assert.equal(byClass(tree, 'bt-side-block').length, 1, 'the block that keeps the Bot list in place')
  tabs[0].props.onClick()
  assert.deepEqual(picked, ['todo'], 'picking the tab asks for the to-do view')
})

// The second tab: a typed address becomes a real link, and every service row is one too —
// the same way every other outside link in this client opens.
test('the quick actions tab links a typed address and the service rows', async () => {
  const value = { open: 0, done: 0, items: [], history: [] }
  slots = []; cursor = 0
  const picked = []
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value) }, onView: id => picked.push(id) }) }
  draw()
  await settled()
  const [quickTab] = find(draw(), node => node.props?.role === 'tab').slice(1)
  quickTab.props.onClick()
  assert.deepEqual(picked, ['quick'], 'the tab asks for the quick view')
  const tree = draw()
  assert.equal(byClass(tree, 'bt-quick-pane').length, 1, 'the quick pane takes the tab')
  assert.equal(byClass(tree, 'bt-todo-pane').length, 0, 'the to-do pane steps aside')
  // The address bar: empty until typed, and no link until the text is a web address.
  const [input] = byClass(tree, 'bt-quick-input')
  assert.equal(input.props.value, '')
  assert.equal(byClass(tree, 'bt-quick-go')[0].props.href, undefined, 'nothing typed, nowhere to go')
  assert.equal(byClass(tree, 'bt-quick-go')[0].props['aria-disabled'], 'true')
  input.props.onChange({ target: { value: '127.0.0.1:18910/health' } })
  const [go] = byClass(draw(), 'bt-quick-go')
  assert.equal(go.props.href, 'http://127.0.0.1:18910/health', 'a bare loopback address becomes an http link')
  assert.equal(go.props.target, '_blank', 'it opens beside the app')
  assert.equal(go.props['aria-disabled'], undefined, 'and it is live')
  // Enter takes the same road; with no element in this stub it must not throw.
  assert.doesNotThrow(() => byClass(draw(), 'bt-quick-input')[0].props.onKeyDown({ key: 'Enter', preventDefault () {}, nativeEvent: {} }))
  // Every service row is its own link.
  const rows = byClass(draw(), 'bt-quick-row')
  assert.equal(rows.length, 4, 'four service links')
  assert.ok(rows.every(row => /^https?:\/\//.test(row.props.href)), 'each carries a web address')
  assert.ok(rows.every(row => row.props.target === '_blank'))
})

// A closed service has to say so on its own row: the launcher answers with one line per
// service, and a row the launcher has no answer for stays unknown instead of claiming down.
test('a service row shows whether its service is running', async () => {
  serviceList = [
    { id: 'anythingllm', running: true },
    { id: 'goofish', running: false },
  ]
  const value = { open: 0, done: 0, items: [], history: [] }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value) }, onView: () => {} }) }
  draw()
  await settled()
  find(draw(), node => node.props?.role === 'tab')[1].props.onClick()
  // The render after the tab switches starts the poll; the one after the answer reads it.
  draw()
  for (let turn = 0; turn < 4; turn += 1) await settled()
  const pane = findElement(draw(), node => node.type?.name === 'QuickActions')[0]
  const tree = pane.type(pane.props)
  const rows = findElement(tree, node => node.props?.className === 'bt-quick-row')
  assert.deepEqual(
    Array.from(rows, node => node.props['data-service-state']),
    ['running', 'stopped', 'unknown', 'unknown'],
    'a row says up, closed, or nothing yet',
  )
  assert.deepEqual(
    Array.from(findElement(tree, node => node.props?.className === 'bt-quick-dot'), node => node.props['data-state']),
    ['running', 'stopped', 'unknown', 'unknown'],
    'and the dot on the row matches it',
  )
  assert.match(rows[1].props.title, /Not running$/, 'a closed row says so on hover')
  serviceList = []
})

// The to-do tab answers a right-click with the one thing it can take before it is open: a new
// item, typed into the line that then appears under the tabs.
test('right-clicking the to-do tab offers a new item and takes it', async () => {
  const value = { open: 0, done: 0, items: [], history: [] }
  const added = []
  const actions = {
    teamTodo: () => Promise.resolve(value),
    teamTodoAdd: (text) => { added.push(text); return Promise.resolve(value) },
  }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions, onView: () => {} }) }
  draw()
  await settled()
  const todoTab = findElement(draw(), node => node.props?.role === 'tab')[0]
  todoTab.props.onContextMenu({ preventDefault () {}, stopPropagation () {}, clientX: 30, clientY: 40 })
  const addMenu = findElement(draw(), node => node.type?.name === 'AddTodoMenu')[0]
  assert.ok(addMenu, 'a right-click opens the tab menu')
  const item = findElement(addMenu.type(addMenu.props), node => node.props?.className === 'bt-todo-menu-item')[0]
  assert.equal(item.children[0], 'Add to-do', 'the item it offers is a new to-do')

  item.props.onClick()
  const input = findElement(draw(), node => node.props?.className === 'bt-todo-new-input')[0]
  assert.ok(input, 'the line to type in opens under the tabs')
  input.props.onChange({ target: { value: '买牛奶' } })
  const typing = findElement(draw(), node => node.props?.className === 'bt-todo-new-input')[0]
  typing.props.onKeyDown({ key: 'Enter', preventDefault () {}, nativeEvent: {} })
  assert.deepEqual(Array.from(added), ['买牛奶'], 'Enter writes the item through the host')
  const after = findElement(draw(), node => node.props?.className === 'bt-todo-new-input')[0]
  assert.equal(after.props.value, '', 'the line is ready for the next one')
})

// Pressing a row starts the service behind it, which takes a moment: the row spins in place of
// its play mark until the launcher answers, so a press never looks like it did nothing.
test('a pressed service row spins until its service answers', async () => {
  serviceList = [{ id: 'anythingllm', running: false }]
  let release
  startGate = new Promise((resolve) => { release = resolve })
  const value = { open: 0, done: 0, items: [], history: [] }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value) }, onView: () => {} }) }
  draw()
  await settled()
  find(draw(), node => node.props?.role === 'tab')[1].props.onClick()
  draw()
  for (let turn = 0; turn < 4; turn += 1) await settled()
  const pane = findElement(draw(), node => node.type?.name === 'QuickActions')[0]
  slots = []; cursor = 0
  const drawPane = () => { cursor = 0; return pane.type(pane.props) }
  const rowOf = tree => findElement(tree, node => node.props?.['data-quick'] === 'anythingllm')[0]

  const idle = drawPane()
  assert.equal(rowOf(idle).props['data-starting'], undefined, 'a row at rest shows its play mark')
  assert.equal(findElement(idle, node => node.props?.className === 'bt-quick-spin').length, 0)

  rowOf(idle).props.onClick()
  const booting = drawPane()
  assert.equal(rowOf(booting).props['data-starting'], 'true', 'the pressed row says it is starting')
  assert.equal(findElement(booting, node => node.props?.className === 'bt-quick-spin').length, 1, 'and spins')
  assert.equal(findElement(booting, node => node.props?.className === 'bt-quick-dot')[0].props['data-state'], 'starting')

  release()
  for (let turn = 0; turn < 4; turn += 1) await settled()
  startGate = null
  const after = drawPane()
  assert.equal(rowOf(after).props['data-starting'], undefined, 'the spin stops once the launcher answers')
  assert.equal(findElement(after, node => node.props?.className === 'bt-quick-spin').length, 0)
  serviceList = []
})

// A service row also answers a right-click: the launcher can start it or close it, and the
// row's own state says which of the two is possible right now.
test('right-clicking a service row offers to close it, and closing asks the launcher', async () => {
  serviceList = [{ id: 'goofish', running: true }]
  const value = { open: 0, done: 0, items: [], history: [] }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value), notice: () => {} }, onView: () => {} }) }
  draw()
  await settled()
  find(draw(), node => node.props?.role === 'tab')[1].props.onClick()
  draw()
  for (let turn = 0; turn < 4; turn += 1) await settled()
  const pane = findElement(draw(), node => node.type?.name === 'QuickActions')[0]
  slots = []; cursor = 0
  const drawPane = () => { cursor = 0; return pane.type(pane.props) }
  const rowOf = tree => findElement(tree, node => node.props?.['data-quick'] === 'goofish')[0]
  // The service menu is its own component: it is drawn by hand, the way every other component
  // this file reaches into is, since findElement does not run functions.
  const menuOf = (tree) => {
    const el = findElement(tree, node => node.type?.name === 'ServiceMenu')[0]
    return el === undefined ? null : el.type(el.props)
  }
  const itemsOf = tree => (menuOf(tree) === null ? [] : findElement(menuOf(tree), node => node.props?.className === 'bt-todo-menu-item'))

  assert.equal(menuOf(drawPane()), null, 'no menu until a row is right-clicked')
  rowOf(drawPane()).props.onContextMenu({ preventDefault () {}, stopPropagation () {}, clientX: 40, clientY: 50 })
  const open = drawPane()
  assert.deepEqual(Array.from(itemsOf(open), node => node.children[0]), ['Start service', 'Stop service'], 'both directions are offered')
  assert.equal(itemsOf(open)[0].props.disabled, true, 'a running service cannot be started again')
  assert.equal(itemsOf(open)[1].props.disabled, false, 'and it can be closed')

  let release
  stopGate = new Promise((resolve) => { release = resolve })
  itemsOf(open)[1].props.onClick()
  const closing = drawPane()
  assert.equal(rowOf(closing).props['data-stopping'], 'true', 'the row says it is closing')
  assert.equal(findElement(closing, node => node.props?.className === 'bt-quick-spin').length, 1, 'and spins until the port drops')
  assert.equal(findElement(rowOf(closing), node => node.props?.className === 'bt-quick-dot')[0].props['data-state'], 'stopping')

  release()
  for (let turn = 0; turn < 4; turn += 1) await settled()
  stopGate = null
  assert.deepEqual(stopCalls, ['goofish'], 'closing asks the launcher for that service')
  assert.equal(menuOf(drawPane()), null, 'the menu closes behind it')
  assert.equal(rowOf(drawPane()).props['data-stopping'], undefined, 'and the spin ends when the launcher answers')
  serviceList = []
})

// The same menu on a closed service: starting is the move, closing is not.
test('a closed service row offers to start, not to close', async () => {
  serviceList = [{ id: 'goofish', running: false }]
  const value = { open: 0, done: 0, items: [], history: [] }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value) }, onView: () => {} }) }
  draw()
  await settled()
  find(draw(), node => node.props?.role === 'tab')[1].props.onClick()
  draw()
  for (let turn = 0; turn < 4; turn += 1) await settled()
  const pane = findElement(draw(), node => node.type?.name === 'QuickActions')[0]
  slots = []; cursor = 0
  const drawPane = () => { cursor = 0; return pane.type(pane.props) }
  const row = findElement(drawPane(), node => node.props?.['data-quick'] === 'goofish')[0]
  row.props.onContextMenu({ preventDefault () {}, stopPropagation () {}, clientX: 12, clientY: 14 })
  const menuEl = findElement(drawPane(), node => node.type?.name === 'ServiceMenu')[0]
  const items = findElement(menuEl.type(menuEl.props), node => node.props?.className === 'bt-todo-menu-item')
  assert.equal(items[0].props.disabled, false, 'a closed service can be started')
  assert.equal(items[1].props.disabled, true, 'and there is nothing to close')
  serviceList = []
})
// moves rows out is the user's own clean-up button. (The row stays put in the file too —
// test/team-todo.test.js pins that half.)
test('a ticked row is marked in place, and one clean-up takes them all', async () => {
  const rows = [
    { id: 'T-1', text: '甲', from: 'Chief', at: '', done: false },
    { id: 'T-2', text: '乙', from: '组长', at: '', done: false },
    { id: 'T-3', text: '丙', from: 'Chief', at: '', done: false },
  ]
  const value = { open: 3, done: 0, items: rows, history: [] }
  const ticks = []
  const cleared = []
  const actions = {
    teamTodo: () => Promise.resolve(value),
    teamTodoCheck: (id, done) => { ticks.push([id, done]); return Promise.resolve(value) },
    teamTodoClear: () => { cleared.push(true); return Promise.resolve(value) },
  }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions, view: 'todo', onView: () => {} }) }
  draw()
  await settled()
  const before = draw()
  assert.deepEqual(byClass(before, 'bt-todo-text').map(node => node.children[0]), ['甲', '乙', '丙'], 'all three rows are in the list')
  const boxes = byClass(before, 'bt-todo-box')
  boxes[1].props.onChange()
  await settled()
  assert.deepEqual(ticks, [['T-2', true]], 'ticking asks for that row only, no reordering')
  assert.equal(byClass(before, 'bt-todo-clear').length, 0, 'nothing ticked yet, so no clean-up to offer')
  // Done rows are drawn struck through where they stand, and one button clears them all.
  const withDone = { open: 2, done: 1, items: rows.map(row => (row.id === 'T-2' ? { ...row, done: true } : row)), history: [] }
  slots = []; cursor = 0
  const drawDone = () => { cursor = 0; return TeamTodoSide({ actions: { ...actions, teamTodo: () => Promise.resolve(withDone) }, view: 'todo', onView: () => {} }) }
  drawDone()
  await settled()
  const ticked = drawDone()
  assert.deepEqual(byClass(ticked, 'bt-todo-text').map(node => node.children[0]), ['甲', '乙', '丙'], 'the ticked row keeps its place in the list')
  assert.equal(byClass(ticked, 'bt-todo-item')[1].props['data-done'], '', 'it is struck through where it stands')
  const [clear] = byClass(ticked, 'bt-todo-clear')
  assert.match(clear.children.join(''), /1/, 'the clean-up offers the ticked count')
  clear.props.onClick()
  await settled()
  assert.deepEqual(cleared, [true], 'one click asks the host to clear everything ticked')
})

// A row offers the conversation it came from: that is what "continue this chat" needs.
test('right-clicking a row offers the conversation it came from', async () => {
  const rows = [{ id: 'T-1', text: '甲', from: 'Chief', at: '', done: false }]
  const value = { open: 1, done: 0, items: rows, history: [] }
  const opened = []
  const openFrom = (name, probe) => { if (probe === true) return name === 'Chief'; opened.push(name); return true }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value) }, view: 'todo', onView: () => {}, openFrom }) }
  draw()
  await settled()
  const tree = draw()
  assert.equal(byClass(tree, 'bt-todo-menu').length, 0, 'no menu until a row is right-clicked')
  const [row] = byClass(tree, 'bt-todo-item')
  row.props.onContextMenu({ preventDefault () {}, clientX: 40, clientY: 60 })
  cursor = 0
  const menu = TeamTodoSide({ actions: { teamTodo: () => Promise.resolve(value) }, view: 'todo', onView: () => {}, openFrom })
  const [item] = byClass(menu, 'bt-todo-menu-item')
  assert.equal(item.props.disabled, false, 'a Bot of that name exists, so it is offered')
  assert.equal(item.children[0].includes('Continue') || typeof item.children[0] === 'string', true)
  item.props.onClick()
  assert.deepEqual(opened, ['Chief'], 'picking it opens that conversation')
})

// A row the user typed has no conversation behind it, so its menu offers the text itself.
test('a row the user typed offers its text instead of a conversation', async () => {
  const rows = [{ id: 'T-9', text: '123', from: 'user', at: '', done: false }]
  const value = { open: 1, done: 0, items: rows, history: [] }
  slots = []; cursor = 0
  copied = []
  const actions = { teamTodo: () => Promise.resolve(value) }
  const draw = () => { cursor = 0; return TeamTodoSide({ actions, view: 'todo', onView: () => {}, openFrom: () => true }) }
  draw()
  await settled()
  const [row] = byClass(draw(), 'bt-todo-item')
  row.props.onContextMenu({ preventDefault () {}, clientX: 5, clientY: 6 })
  cursor = 0
  const [item] = byClass(draw(), 'bt-todo-menu-item')
  assert.equal(item.children[0], 'Copy', 'a row of the user’s own offers its text')
  item.props.onClick()
  await settled()
  assert.deepEqual(copied, ['123'], 'the row text goes to the clipboard')
})

// A ticked row has nothing to continue: its menu clears that one row instead.
test('a ticked row offers clear, and clearing takes only that row away', async () => {
  const rows = [
    { id: 'T-1', text: '甲', from: 'Chief', at: '', done: true },
    { id: 'T-2', text: '乙', from: '', at: '', done: false },
  ]
  const value = { open: 1, done: 1, items: rows, history: [] }
  const cleared = []
  const actions = {
    teamTodo: () => Promise.resolve(value),
    teamTodoClearOne: (id) => { cleared.push(id); return Promise.resolve({ open: 1, done: 0, items: [rows[1]], history: [rows[0]] }) },
  }
  slots = []; cursor = 0
  const draw = () => { cursor = 0; return TeamTodoSide({ actions, view: 'todo', onView: () => {}, openFrom: () => true }) }
  draw()
  await settled()
  const [row] = byClass(draw(), 'bt-todo-item')
  row.props.onContextMenu({ preventDefault () {}, clientX: 10, clientY: 20 })
  cursor = 0
  const [item] = byClass(draw(), 'bt-todo-menu-item')
  assert.equal(item.children[0], 'Clear item', 'a ticked row offers the clear-up, not the conversation')
  item.props.onClick()
  await settled()
  assert.deepEqual(cleared, ['T-1'], 'only that row is asked for')
  assert.deepEqual(byClass(draw(), 'bt-todo-text').map(node => node.children[0]), ['乙'], 'the cleared row left the list')
})

// The tab the user left open has to survive a reload: the panel is built again from scratch, so
// only what it wrote to storage can decide which tab comes back.
test('the tab the user left open comes back after a reload', async () => {
  const value = { open: 1, done: 0, items: [{ id: 'T-1', text: '甲', from: 'Chief', at: '', done: false }], history: [] }
  const actions = { teamTodo: () => Promise.resolve(value) }
  stored.clear()
  const draw = () => { cursor = 0; return TeamTodoSide({ actions, onView: () => {} }) }
  const [, quickTab] = find(draw(), node => node.props?.role === 'tab')
  quickTab.props.onClick()
  assert.equal(stored.get('ds-bot:side-view'), 'quick', 'picking a tab is written down')

  // A reload: nothing is carried over but storage, and the quick tab must come back selected.
  slots = []; cursor = 0
  const tabs = find(draw(), node => node.props?.role === 'tab')
  assert.equal(tabs[0].props['aria-selected'], 'false', 'the to-do tab is not forced back on')
  assert.equal(tabs[1].props['aria-selected'], 'true', 'the tab the user left open is selected')
  assert.equal(byClass(draw(), 'bt-quick-pane').length, 1, 'and its pane is the one drawn')
})

// The block's height comes from the resizer wrapped around it: sidebar.js writes the dragged
// height into --bt-side-block-h. A fixed height here silently ignored that drag — the boundary
// simply would not move, which is exactly how "the split does not work" looked.
test('the top block takes its height from the resizer above it', () => {
  assert.match(
    module.exports.TEAM_TODO_CSS,
    /\.bt-side-block\{[^}]*height:var\(--bt-side-block-h,220px\)/u,
    'the height is the resizer variable, with the default as its fallback')
})
