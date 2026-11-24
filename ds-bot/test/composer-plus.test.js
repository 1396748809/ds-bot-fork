import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The composer's "+" bundled with a React stand-in that counts hook calls. React needs a
// component to call the same hooks on every render: one render that calls a hook the
// previous render did not is an error, and the composer's slot drops the "+" for good.
const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/composer.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom'],
})
let hooks = 0
const react = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => { hooks += 1; return [initial, () => {}] },
  useRef: current => { hooks += 1; return { current } },
  useEffect: () => { hooks += 1 },
  useLayoutEffect: () => { hooks += 1 },
  useMemo: make => { hooks += 1; return make() },
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, document: { body: {} },
  require: name => (name === 'react' ? react : name === 'react-dom' ? { createPortal: node => node } : {}),
})
const { ComposerPlus } = module.exports

// Renders the "+" for a chat whose Bot is in the roster as `roster` says, and counts its hook calls.
function render(roster) {
  hooks = 0
  const tree = ComposerPlus({
    sessionId: 'chief', useRoster: select => select(roster),
    useInput: select => select({ phase: 'plain', draft: '', attachmentIds: [], queue: [] }),
    actions: { canReferenceChat: () => false },
  })
  return { tree, hooks }
}

// A group whose own Session moved to a fresh part (`room.sessionId`), with the Main
// Bot as its admin so the goal entry is offered.
const movedRoom = { id: 'g', sessionId: 'g-part2', name: 'Ops', members: ['a'], admin: 'a' }
const movedRoster = { byId: { a: { id: 'a', name: 'Chief' } }, roomsById: { g: movedRoom, 'g-part2': movedRoom } }
const hooksFor = (roster, actions) => ComposerPlus({
  sessionId: 'g-part2', useRoster: select => select(roster),
  useInput: select => select({ phase: 'plain', draft: '', attachmentIds: [], queue: [] }),
  actions,
})

test('the + Set a goal entry stores the room id when the Session moved', () => {
  const calls = []
  const original = react.useState
  // Seed the menu open; the test's real useState never re-renders.
  react.useState = initial => [initial === null ? { files: false } : initial, () => {}]
  try {
    const tree = hooksFor(movedRoster, { canReferenceChat: () => false, composeGoal: id => calls.push(id) })
    const items = []
    const walk = (node) => {
      if (node === null || typeof node !== 'object') return
      if (Array.isArray(node)) { node.forEach(walk); return }
      if (typeof node.type === 'function') { walk(node.type(node.props)); return }
      if (node.props?.role === 'menuitem') items.push(node)
      for (const child of node.children ?? []) walk(child)
    }
    walk(tree)
    const entry = items.find(item => JSON.stringify(item).includes('Set a goal'))
    assert.ok(entry)
    entry.props.onClick()
    assert.deepEqual(calls, ['g'])
  } finally { react.useState = original }
})

// The row labels of the open "+" menu, with any rule reading as 'separator'. The portal
// stand-in returns the menu node itself, so its direct children are the rows in order.
const menuRows = (tree) => {
  const menus = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (String(node.props?.className ?? '').includes('bt-plus-menu')) { menus.push(node); return }
    if (typeof node.type === 'function') { walk(node.type(node.props)); return }
    for (const child of node.children ?? []) walk(child)
  }
  walk(tree)
  assert.equal(menus.length, 1)
  // Rows the roster hides arrive as nulls, so drop them before reading labels.
  const shown = menus[0].children.filter(Boolean)
  const label = (child) => {
    if (child.props?.className === 'bt-menu-sep') return 'separator'
    return child.children.find(node => node?.props?.className === 'bt-menu-label')?.children[0]
  }
  return { shown, rows: shown.map(label) }
}
// A chat of one's own: the Bot's id is the session id, as the roster gives it.
const botRoster = { byId: { a: { id: 'a', name: 'Chief' } }, roomsById: {} }
const botSession = (actions) => ComposerPlus({
  sessionId: 'a', useRoster: select => select(botRoster),
  useInput: select => select({ phase: 'plain', draft: '', attachmentIds: [], queue: [] }),
  actions,
})

test('a rule separates the rows that add to this chat from the one that starts over', () => {
  const original = react.useState
  react.useState = initial => [initial === null ? { files: false } : initial, () => {}]
  try {
    const { shown, rows } = menuRows(botSession({ canReferenceChat: () => false }))
    assert.deepEqual(rows, ['Scheduled task', 'separator', 'Start a fresh chat'])
    // stepMenuFocus reaches rows by `button[role^="menuitem"]`, so the rule must not be one.
    const rule = shown.find(child => child.props?.className === 'bt-menu-sep')
    assert.equal(rule.props.role, 'separator')
  } finally { react.useState = original }
})

// A Bot's chat knows whose it is, so the row moves this chat to a fresh part instead of
// asking whom to talk to. Opening the Bot afterwards lands on the part it now points at.
test('the fresh row starts a new session of this chat, not a recipient picker', async () => {
  const original = react.useState
  react.useState = initial => [initial === null ? { files: false } : initial, () => {}]
  try {
    const calls = []
    const { shown } = menuRows(botSession({
      canReferenceChat: () => false,
      newPart: id => { calls.push(['newPart', id]); return Promise.resolve(true) },
      openSession: id => { calls.push(['openSession', id]) },
      openNewChat: mode => { calls.push(['openNewChat', mode]) },
    }))
    const row = shown.find(child => child.children?.some(node => node?.children?.[0] === 'Start a fresh chat'))
    assert.ok(row, 'the fresh row is drawn')
    row.props.onClick()
    // The click settles on a promise chain, so let every microtask of it run.
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(JSON.stringify(calls), JSON.stringify([['newPart', 'a'], ['openSession', 'a']]))
  } finally { react.useState = original }
})

// A group has one conversation and no fresh part, so the row and its rule are both gone
// rather than offering a picker the label does not describe.
test('a group chat offers neither the fresh row nor a dangling rule', () => {
  const original = react.useState
  react.useState = initial => [initial === null ? { files: false } : initial, () => {}]
  try {
    const { rows } = menuRows(hooksFor(movedRoster, { canReferenceChat: () => false, composeGoal: () => {} }))
    assert.deepEqual(rows, ['Set a goal', 'Scheduled task'])
  } finally { react.useState = original }
})

test('the "+" calls the same hooks whether or not its roster knows the Bot yet', () => {
  const roster = { ready: false }
  const unknown = render(roster)
  roster.byId = { chief: { id: 'chief' } }
  const known = render(roster)
  roster.byId = {}
  const forgotten = render(roster)
  assert.equal(unknown.tree, null)
  assert.equal(known.tree.type, 'fragment')
  assert.equal(forgotten.tree, null)
  assert.equal(known.hooks, unknown.hooks)
  assert.equal(forgotten.hooks, unknown.hooks)
})
