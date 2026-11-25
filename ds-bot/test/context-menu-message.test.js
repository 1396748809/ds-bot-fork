// A line of a conversation can be handed on to another Bot: the menu offers the copy and one
// entry per Bot, and the entry sends the text with a mark naming where it came from.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

const bundle = await build({
  stdin: {
    contents: "export { ContextMenu } from './src/client/context-menu.js'",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
const module = { exports: {} }
const react = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx },
  useContext: ctx => ctx.value, useMemo: make => make(), useCallback: fn => fn, useId: () => 'id',
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
  useState: initial => [initial, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {},
  useRef: initial => ({ current: initial }),
}
const sandbox = {
  module, exports: module.exports,
  require: name => (name === 'react' ? react : {}),
  document: { activeElement: null, addEventListener() {}, removeEventListener() {} },
  window: { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} },
}
runInNewContext(bundle.outputFiles[0].text, sandbox)
const { ContextMenu } = module.exports

const writer = { id: 'w', name: 'Writer', createdAt: 1 }
const tester = { id: 't', name: 'Tester', createdAt: 2 }
const roster = { bots: [writer, tester], rooms: [], byId: { w: writer, t: tester }, roomsById: {}, mainBotIds: [], sections: [] }
const nodes = (tree, match, found = []) => {
  if (Array.isArray(tree)) { for (const item of tree) nodes(item, match, found); return found }
  if (tree === null || typeof tree !== 'object') return found
  // The message menu is a component of its own: render it to reach its buttons.
  if (typeof tree.type === 'function') { nodes(tree.type(tree.props), match, found); return found }
  if (match(tree)) found.push(tree)
  for (const child of tree.children ?? []) nodes(child, match, found)
  return found
}
const labelOf = button => button.children.find(child => child?.props?.className === 'bt-menu-label')?.children?.[0]
const menuFor = (menu, team = roster) => {
  const sent = []
  const closed = []
  const actions = { closeMenu() { closed.push(true) }, reportError() {}, send: (id, text) => { sent.push([id, text]); return Promise.resolve(true) } }
  const tree = ContextMenu({ menu: { kind: 'message', x: 10, y: 10, ...menu }, roster: team, actions })
  return { sent, closed, tree, buttons: nodes(tree, node => node.type === 'button') }
}

test('a message offers a copy and every other Bot to forward it to', () => {
  const { buttons } = menuFor({ text: '把这条发给别人', from: 'Writer', selfId: 'w' })
  assert.deepEqual(buttons.map(labelOf), ['Copy text', 'Tester'])
})

test('forwarding sends the text with the name it came from', () => {
  const { buttons, sent } = menuFor({ text: '把这条发给别人', from: 'Writer', selfId: 'w' })
  const forward = buttons.find(button => labelOf(button) === 'Tester')
  assert.ok(forward, 'the other Bot is offered')
  forward.props.onClick()
  assert.deepEqual(sent, [['t', 'Forwarded from Writer\n把这条发给别人']])
})

test('the line you are on is not offered back to its own Bot', () => {
  const { buttons } = menuFor({ text: 'hey', from: 'Writer', selfId: 'w' })
  assert.deepEqual(buttons.map(labelOf), ['Copy text', 'Tester'])
})

test('the user\'s own line goes on without a source mark', () => {
  const { buttons, sent } = menuFor({ text: '我说的话', from: '', selfId: 'w' })
  const forward = buttons.find(button => labelOf(button) === 'Tester')
  forward.props.onClick()
  assert.deepEqual(sent, [['t', '我说的话']])
})

test('a long list of Bots scrolls inside the menu instead of running off the window', () => {
  const many = Array.from({ length: 24 }, (_, index) => ({ id: `b${index}`, name: `Bot ${index}` }))
  const { tree } = menuFor({ text: 'hey', from: '', selfId: 'w' }, { ...roster, bots: many })
  const scrollers = nodes(tree, node => node?.props?.className === 'bt-menu-scroll')
  assert.equal(scrollers.length, 1, 'one scroller holds the list')
  assert.ok(scrollers[0].props.ref, 'the scroller is handed to its own wheel handler')
  // Every Bot is in that scroller; the copy line and the caption stay out of it.
  const scrolling = nodes(scrollers[0], node => node.type === 'button').map(labelOf)
  assert.deepEqual(scrolling, many.map(bot => bot.name))
  const copy = nodes(tree, node => node.type === 'button' && labelOf(node) === 'Copy text')
  assert.equal(copy.length, 1)
  assert.equal(nodes(copy[0], node => node?.props?.className === 'bt-menu-scroll').length, 0)
  // And the menu keeps part of the window free, so the list has somewhere to scroll.
  const root = nodes(tree, node => typeof node?.props?.className === 'string' && node.props.className.split(' ').includes('bt-menu'))[0]
  assert.ok(root, 'the menu root is rendered')
  assert.ok(Number.isFinite(root.props.style.maxHeight), 'the menu carries a bounded height')
  assert.ok(root.props.style.maxHeight > 0 && root.props.style.maxHeight <= 800 * 0.7, `bounded to ${root.props.style.maxHeight}px of an 800px window`)
})

// The pointer leaving puts the menu away, the way the to-do card behaves.
test('the menu goes as soon as the pointer leaves it', () => {
  const { tree, closed } = menuFor({ text: 'hey', from: '', selfId: 'w' })
  const root = nodes(tree, node => typeof node?.props?.className === 'string' && node.props.className.split(' ').includes('bt-menu'))[0]
  assert.equal(typeof root.props.onMouseLeave, 'function', 'the menu watches its own edge')
  assert.deepEqual(closed, [], 'nothing closes it before the pointer moves')
  root.props.onMouseLeave()
  assert.deepEqual(closed, [true], 'leaving closes it')
})
