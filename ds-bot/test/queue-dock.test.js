import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// jsdom comes from the harness that test/harness-resolve.mjs found, like the dsh packages.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { JSDOM } = createRequire(join(process.env.DSH_HARNESS ?? join(PLUGIN, '..', 'deepseek-harness'), 'package.json'))('jsdom')

const { outputFiles } = await build({
  stdin: {
    contents: "export { QueueDock } from './src/client/queue-dock.js'",
    resolveDir: PLUGIN,
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
// State is kept between two renders of the same dock, so a press can be followed by the
// tree it produces; anything else resets, which is what every other test here expects.
let slots = []
let cursor = 0
const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: Symbol('Fragment'),
  useEffect() {}, useLayoutEffect() {},
  useState: initial => { const at = cursor++; if (!(at in slots)) slots[at] = initial; return [slots[at], value => { slots[at] = value }] },
  useMemo: make => make(), useRef: current => ({ current }), useId: () => 'id',
}
const dom = new JSDOM('<!doctype html><body></body>')
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  document: dom.window.document,
  window: { matchMedia: () => ({ matches: false }) },
  require: name => (name === 'react' ? react : {}),
})
const { QueueDock } = module.exports

const row = (id, kind, text) => ({ id, source: { kind }, content: [{ type: 'text', text }] })

const dock = (nextTurn, { running = false, pendingSubmissions = [], fresh = true } = {}) => {
  if (fresh) slots = []
  cursor = 0
  return QueueDock({
    useSession: selector => selector({ running, pendingSubmissions, subagent: null }),
    useProjection: () => ({ 'next-turn': nextTurn }),
    updateQueue: async () => ({ ok: true }),
    loadImage: async () => 'about:blank',
    actions: { reportError: () => {} },
  })
}

// The stub tree holds element objects, function components unevaluated; walk it
// for one class or text leaf.
function collect(node, found = { rows: [], texts: [] }) {
  if (node === null || node === undefined || typeof node === 'boolean') return found
  if (typeof node === 'string' || typeof node === 'number') { found.texts.push(String(node)); return found }
  if (Array.isArray(node)) { for (const item of node) collect(item, found); return found }
  if (typeof node !== 'object') return found
  if (typeof node.type === 'function') { collect(node.type(node.props), found); return found }
  if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes('bt-queue-row')) found.rows.push(node)
  collect(node.props?.children, found)
  return found
}

test('team deliveries in the queue never draw as the user’s own rows (#663)', () => {
  const tree = dock([
    row('u1', 'user', 'ship it when you can'),
    row('b1', 'bot', '[Reply from Writer]\ndone'),
    row('b2', 'bot', '[Group post from Tester]\nlooks fine'),
  ])
  const { rows, texts } = collect(tree)
  assert.equal(rows.length, 1)
  assert.ok(texts.includes('ship it when you can'))
  assert.ok(!texts.some(text => text.includes('[Reply from') || text.includes('[Group post from')))
})

test('a queue of only Bot mail renders nothing', () => {
  const tree = dock([row('b1', 'bot', '[Reply from Writer]\ndone')])
  assert.equal(tree, null)
})

test('the count names only the user’s queued sends', () => {
  const tree = dock([
    row('u1', 'user', 'first'),
    row('u2', 'schedule', 'second, scheduled'),
    row('b1', 'bot', '[Message from Writer]\nnew task'),
  ])
  const { texts } = collect(tree)
  assert.ok(texts.includes('2 queued messages'))
})

test('a user send still in flight shows as sending', () => {
  const tree = dock([], { pendingSubmissions: [{ requestId: 'r1', placement: 'queued', text: 'on its way', attachments: [] }] })
  const { rows, texts } = collect(tree)
  assert.equal(rows.length, 1)
  assert.ok(texts.includes('Sending…'))
})

// A parked row says what it is waiting for: this turn, not the next question.
test('a queued row says it waits for the running turn, and says nothing once idle', () => {
  const parked = collect(dock([row('u1', 'user', 'ship it')], { running: true }))
  assert.ok(parked.texts.includes('Waits for this turn to end'))
  const idle = collect(dock([row('u1', 'user', 'ship it')], { running: false }))
  assert.ok(!idle.texts.includes('Waits for this turn to end'))
})

// Several rows fold under the count header, so the note rides there instead of each row.
test('the count header carries the same note when several rows are parked', () => {
  const { rows, texts } = collect(dock([row('u1', 'user', 'a'), row('u2', 'user', 'b')], { running: true }))
  assert.equal(rows.length, 0)
  assert.ok(texts.includes('2 queued messages'))
  assert.ok(texts.includes('Waits for this turn to end'))
})

// Unfolding the queue must not take height in the composer stack, or the conversation is
// pushed up under it: a folded list hangs above the header as its own layer instead.
test('an unfolded queue is marked to hang over the conversation, a single row is not', () => {
  const many = byClass(dock([row('u1', 'user', 'a'), row('u2', 'user', 'b')], { running: true }), 'bt-queue-panel')[0]
  assert.equal(many.props['data-floating'], 'true', 'several rows open as a layer')
  const one = byClass(dock([row('u1', 'user', 'a')], { running: true }), 'bt-queue-panel')[0]
  assert.equal(one.props['data-floating'], undefined, 'a single row stays part of the dock')
})

// The tree walker above, narrowed to elements carrying one aria-label.
const byLabel = (node, label, found = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return found
  if (typeof node === 'string' || typeof node === 'number') return found
  if (Array.isArray(node)) { for (const item of node) byLabel(item, label, found); return found }
  if (typeof node !== 'object') return found
  if (typeof node.type === 'function') { byLabel(node.type(node.props), label, found); return found }
  if (node.props?.['aria-label'] === label) found.push(node)
  byLabel(node.props?.children, label, found)
  return found
}

// The same walk, narrowed to one class name.
const byClass = (node, name, found = []) => {
  if (node === null || node === undefined || typeof node === 'boolean') return found
  if (typeof node === 'string' || typeof node === 'number') return found
  if (Array.isArray(node)) { for (const item of node) byClass(item, name, found); return found }
  if (typeof node !== 'object') return found
  if (typeof node.type === 'function') { byClass(node.type(node.props), name, found); return found }
  if (typeof node.props?.className === 'string' && node.props.className.split(' ').includes(name)) found.push(node)
  byClass(node.props?.children, name, found)
  return found
}

// The host takes text-only queue edits ("queue edits accept text content only"), so a line
// carrying a picture can still be corrected — its words are what get saved — but the row says
// what it costs before the user commits.
test('a queued message that carries a picture still opens its editor, and warns', () => {
  const picture = { type: 'image', attachment: { name: 'a.png' } }
  const parked = [{ id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '看图' }, picture] }]
  const [edit] = byLabel(dock(parked), 'Edit queued message')
  assert.ok(edit, 'the pencil is drawn')
  assert.equal(edit.props.disabled, false, 'and it can be pressed while the line is parked')
  assert.equal(edit.props.title, 'Saving keeps the text only — the attachment goes')
  edit.props.onClick()
  const opened = dock(parked, { fresh: false })
  const [field] = byClass(opened, 'bt-queue-edit')
  assert.ok(field, 'the editor opens over the row')
  assert.equal(field.props.value, '看图', 'it starts from the words the line carries')
  assert.equal(byClass(opened, 'bt-queue-edit-warn').length, 1, 'and it says the picture will go')
})

test('a plain text row still offers its pencil', () => {
  const [edit] = byLabel(dock([row('u1', 'user', '只有文字')]), 'Edit queued message')
  assert.equal(edit.props.disabled, false)
  assert.equal(edit.props.title, 'Edit queued message', 'nothing is lost, so nothing is warned about')
})
