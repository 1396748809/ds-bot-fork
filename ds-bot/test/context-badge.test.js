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
const at = async (tokens, extra = {}) => {
  slot = undefined
  return after(reading({ contextPressure: { pressureTokens: tokens, contextWindow: 700_000, ...extra } }))
}

test('the badge stays quiet until the count is worth reading', async () => {
  slot = undefined
  assert.equal(ContextBadge({ bot, running: false, actions: {} }), null, 'no runStats action, no badge')
  assert.equal(await at(179_999), null, 'just under eighteen 万 keeps the pill quiet')
  assert.equal((await at(180_000)).children[0], '18万', 'exactly eighteen 万 is worth saying')
})

test('the badge counts tokens, not a share of the window', async () => {
  const badge = await at(200_000)
  assert.equal(badge.props.className, 'bt-pill-ctx')
  assert.equal(badge.children[0], '20万')
  assert.equal(badge.props['data-heavy'], undefined, 'under 22万 the ordinary figure is not flagged')
  assert.match(badge.props.title, /20万/)
  // A window twice as wide must not change the figure: the count is absolute.
  slot = undefined
  const wide = await after(reading({ contextPressure: { pressureTokens: 200_000, contextWindow: 1_400_000 } }))
  assert.equal(wide.children[0], '20万', 'the window size does not move the count')
})

test('a chat past 22万 is flagged, and the projected size counts first', async () => {
  const flagged = await at(220_000)
  assert.equal(flagged.children[0], '22万')
  assert.equal(flagged.props['data-heavy'], '', 'from 22万 the figure turns orange')
  slot = undefined
  const projected = await after(reading({ contextPressure: { projectedTokens: 240_000, pressureTokens: 10_000, contextWindow: 700_000 } }))
  assert.equal(projected.children[0], '24万', 'the projection wins over the last pressure figure')
  assert.equal(projected.props['data-heavy'], '')
})

test('past the 272k billing line the label says so', async () => {
  const ordinary = await at(240_000)
  const crossed = await at(272_000)
  assert.equal(crossed.children[0], '27万')
  assert.equal(crossed.props['data-heavy'], '')
  assert.notEqual(crossed.props.title, ordinary.props.title, 'crossing the line changes what the badge says')
  assert.match(crossed.props['aria-label'], /27万/)
})
