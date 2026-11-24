import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { test } from 'node:test'

// The panel at the top of the sidebar. Its figures arrive from the host one microtask after
// the first render, so every assertion here renders, lets the read settle, and renders again.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/todo-panel.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

let slots = []
let cursor = 0
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout,
  // No polling in a test: the interval must not keep the process alive.
  setInterval: () => 0, clearInterval: () => {},
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
      '@deepseek-ai/dsh-client-ui-primitives': {},
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { TeamTodoPanel } = module.exports

const find = (node, match, found = []) => {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach(child => find(child, match, found)); return found }
  if (typeof node.type === 'function') { find(node.type(node.props), match, found); return found }
  if (match(node)) found.push(node)
  find(node.children, match, found)
  return found
}
const byClass = (tree, name) => find(tree, node => node.props?.className === name)

const settled = () => new Promise(resolve => setTimeout(resolve, 0))
let fresh
const render = async (value) => {
  fresh = { slots: [], cursor: 0 }
  slots = fresh.slots
  const actions = value === undefined ? {} : { teamTodo: () => Promise.resolve(value) }
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
