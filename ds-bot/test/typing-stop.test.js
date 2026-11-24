import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { test } from 'node:test'

// The stop on a group's typing row: the user asked for it there because that is where a
// member running long is visible, and the details panel is two clicks away.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: { contents: "export { TypingStop, ChatStop, TYPING_STOP_CSS } from './src/client/typing-stop.js'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

const react = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => [initial, () => {}],
  useReducer: (reduce, initial) => [initial, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: make => make(), useCallback: fn => fn,
  useRef: current => ({ current }), useId: () => 'id', useImperativeHandle: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useDeferredValue: value => value, startTransition: run => run(),
  memo: component => component, forwardRef: component => component,
  createContext: (value) => ({ value, Provider: ({ children }) => children, Consumer: ({ children }) => children(value) }),
  useContext: context => context?.value,
}
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports,
  document: { hidden: false, querySelector: () => null, addEventListener: () => {}, removeEventListener: () => {} },
  window: { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {} },
  navigator: { language: 'zh-CN' },
  require: name => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`no platform module ${name}`)
  },
})
const { TypingStop, ChatStop, TYPING_STOP_CSS } = module.exports

const find = (node, match, found = []) => {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) { node.forEach(child => find(child, match, found)); return found }
  if (typeof node.type === 'function') { find(node.type(node.props), match, found); return found }
  if (match(node)) found.push(node)
  find(node.children, match, found)
  return found
}

const bot = { id: 'b1', name: '组长' }

test('the typing row stop calls the member stop with the room and the Bot', async () => {
  const calls = []
  const actions = { stopMemberWork: (roomId, botId) => { calls.push([roomId, botId]); return Promise.resolve() } }
  const tree = TypingStop({ bot, roomId: 'room-1', actions })
  const [button] = find(tree, node => node.props?.className === 'bt-typing-stop')
  assert.ok(button, 'the stop is drawn')
  assert.match(button.props['aria-label'], /组长/)
  button.props.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, [['room-1', 'b1']])
})

// A button that cannot do anything must not be drawn: the host action is missing only
// when a window talks to an older host, and a dead control there is worse than none.
test('no stop is drawn where the host offers none', () => {
  assert.equal(TypingStop({ bot, roomId: 'room-1', actions: {} }), null)
  assert.equal(TypingStop({ bot, roomId: 'room-1', actions: undefined }), null)
})

// The same square on a chat of one's own: the composer's send button only turns into a
// stop while the draft is empty, so a half-written message otherwise has no stop at all.
test('the chat activity row stop calls stop-chat with the Bot', async () => {
  const calls = []
  const actions = { stopChat: botId => { calls.push(botId); return Promise.resolve() } }
  const tree = ChatStop({ bot, actions })
  const [button] = find(tree, node => node.props?.className === 'bt-typing-stop')
  assert.ok(button, 'the stop is drawn')
  assert.match(button.props['aria-label'], /组长/)
  button.props.onClick()
  await Promise.resolve()
  assert.deepEqual(calls, ['b1'])
})

test('the chat row draws no stop where the host has no stop-chat', () => {
  assert.equal(ChatStop({ bot, actions: {} }), null)
})

// The square has to fill most of the plate: a small square on a wide pale disc reads as a
// dot, not as stop. The plate was tightened and the square widened for exactly that.
test('the square fills most of a tight plate', () => {
  const tree = TypingStop({ bot, roomId: 'room-1', actions: { stopMemberWork: () => Promise.resolve() } })
  const [glyph] = find(tree, node => node.type === 'svg')
  const [square] = find(tree, node => node.type === 'rect')
  assert.equal(glyph.props.width, 20, 'the glyph is drawn 20px wide')
  assert.equal(square.props.width, 13, 'the square is 13 of those 20 units')
  assert.ok(square.props.width / 20 > 0.6, 'the square covers more than three fifths of the glyph')
  assert.match(TYPING_STOP_CSS, /\.bt-typing-stop\{[^}]*width:23px/, 'the plate itself stays tight')
})
