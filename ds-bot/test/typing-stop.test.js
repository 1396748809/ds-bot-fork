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
  stdin: { contents: "export { TypingStop } from './src/client/member-status.js'", resolveDir: PLUGIN },
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
const { TypingStop } = module.exports

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
