import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The header bundle with React that keeps one state slot and runs effects at once, so
// the badge's host read resolves inside the call and the next render has its figure.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/client/header.js', import.meta.url))],
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})
let slot
const module = { exports: {} }
runInNewContext(bundle.outputFiles[0].text, {
  module, exports: module.exports, URL, URLSearchParams, setTimeout, clearTimeout,
  require: (name) => {
    const platform = {
      react: { createContext: (initial) => { const ctx = { value: initial }; ctx.Provider = ({ value, children }) => { ctx.value = value; return children }; return ctx }, useContext: ctx => ctx.value, useId: () => 'dv-id', useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(), createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }), useState: () => [slot, value => { slot = value }], useEffect: effect => effect(), useRef: current => ({ current }), useLayoutEffect: () => {}, useMemo: make => make(), useCallback: fn => fn, Fragment: 'fragment' },
      'react-dom': { createPortal: node => node },
      '@deepseek-ai/dsh-client-ui-primitives': { MarkdownText: () => null },
    }
    if (!(name in platform)) throw new Error(`no platform module ${name}`)
    return platform[name]
  },
})
const { ContextBadge } = module.exports

const bot = { id: 'a', name: 'Chief', sessionId: 'a' }
const reading = values => ({ runStats: () => Promise.resolve(values) })
// The read settles a microtask after the first render, so the second one has the figure.
const settled = () => new Promise(resolve => setTimeout(resolve, 0))
const after = async (actions) => { ContextBadge({ bot, running: false, actions }); await settled(); return ContextBadge({ bot, running: false, actions }) }

test('the context badge waits for a figure, a window and a fifth-full chat', async () => {
  slot = undefined
  assert.equal(ContextBadge({ bot, running: false, actions: {} }), null, 'no runStats action, no badge')
  slot = undefined
  const noWindow = reading({ contextPressure: { pressureTokens: 90_000 } })
  assert.equal(await after(noWindow), null, 'a figure without a window says nothing')
  slot = undefined
  const roomy = reading({ contextPressure: { pressureTokens: 19_000, contextWindow: 100_000 } })
  assert.equal(await after(roomy), null, 'a chat under a fifth full keeps the pill quiet')
  slot = undefined
  const edge = reading({ contextPressure: { pressureTokens: 20_000, contextWindow: 100_000 } })
  assert.equal((await after(edge)).children[0], '20%', 'exactly a fifth is worth saying')
})

test('a chat past a fifth full shows its share of the context', async () => {
  slot = undefined
  const light = reading({ contextPressure: { pressureTokens: 24_000, contextWindow: 100_000 } })
  const badge = await after(light)
  assert.equal(badge.props.className, 'bt-pill-ctx')
  assert.equal(badge.children[0], '24%')
  assert.equal(badge.props['data-heavy'], undefined, 'the ordinary share is not flagged')
  assert.match(badge.props.title, /24/)
})

test('a chat past a third full is flagged, and the projected size counts first', async () => {
  slot = undefined
  const tight = reading({ contextPressure: { projectedTokens: 78_000, pressureTokens: 10_000, contextWindow: 100_000 } })
  const badge = await after(tight)
  assert.equal(badge.children[0], '78%', 'the projection wins over the last pressure figure')
  assert.equal(badge.props['data-heavy'], '', 'a chat this full is flagged')
  assert.match(badge.props['aria-label'], /78/)
  slot = undefined
  const third = reading({ contextPressure: { pressureTokens: 35_000, contextWindow: 100_000 } })
  assert.equal((await after(third)).props['data-heavy'], '', 'a third full is already flagged')
})
