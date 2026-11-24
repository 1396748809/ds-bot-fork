import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { test } from 'node:test'

// What a busy row says: the Bot's own words when they are in the interface's language,
// else the tool named in that language. A Chinese window must not fill with English prose
// a Bot happened to write.
const PLUGIN = dirname(dirname(fileURLToPath(import.meta.url)))
const { outputFiles } = await build({
  stdin: { contents: "export { workPhrase, workRaw } from './src/client/cells.js'\nexport { installLocale } from './src/client/i18n.js'", resolveDir: PLUGIN },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
})

const react = {
  Fragment: 'fragment',
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: initial => [initial, () => {}], useReducer: (reduce, initial) => [initial, () => {}],
  useEffect: () => {}, useLayoutEffect: () => {}, useMemo: make => make(), useCallback: fn => fn,
  useRef: current => ({ current }), useId: () => 'id', useImperativeHandle: () => {},
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  useDeferredValue: value => value, startTransition: run => run(),
  memo: component => component, forwardRef: component => component,
  createContext: value => ({ value, Provider: ({ children }) => children, Consumer: ({ children }) => children(value) }),
  useContext: context => context?.value,
}
const element = { style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {}, removeEventListener: () => {}, querySelector: () => null, getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0 }) }
const document = { hidden: false, body: element, documentElement: element, head: element, createElement: () => element, querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {}, removeEventListener: () => {}, getElementById: () => null }
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, document, navigator: { language: 'zh-CN' },
  window: { matchMedia: () => ({ matches: false }), addEventListener: () => {}, removeEventListener: () => {}, document, getComputedStyle: () => ({}) },
  getComputedStyle: () => ({}), Element: class {}, HTMLElement: class {}, Node: class {},
  requestAnimationFrame: run => setTimeout(run, 0), cancelAnimationFrame: () => {},
  require: name => {
    if (name === 'react') return react
    if (name === 'react-dom') return { createPortal: node => node }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`no platform module ${name}`)
  },
})
const { workPhrase, workRaw, installLocale } = module.exports

// The interface language the row speaks; `t` falls back to the key itself, which is the
// English label the dictionary is keyed by.
const useLanguage = active => installLocale({
  register: () => () => {}, bind: () => key => key, getLocale: () => ({ active, locales: [] }),
})

const englishStep = 'Run full flow with 5s watchdog build'
const chineseStep = '正在跑完整流程，带 5 秒看门狗'

test('a Chinese row names the tool rather than repeating an English step', () => {
  useLanguage('zh-CN')
  const done = workPhrase({ tool: 'edit', said: englishStep, target: 'PayManager.java' })
  assert.doesNotMatch(done, /Run full flow/)
  assert.match(done, /Writing changes/)
  assert.match(done, /PayManager\.java/)
  // The words are kept for the tooltip instead of being thrown away.
  assert.equal(workRaw({ tool: 'edit', said: englishStep }), englishStep)
})

test('a Chinese row keeps a step that is already in the interface language', () => {
  useLanguage('zh-CN')
  assert.equal(workPhrase({ tool: 'edit', said: chineseStep }), chineseStep)
})

test('an English row keeps the Bot’s own English', () => {
  useLanguage('en')
  assert.equal(workPhrase({ tool: 'edit', said: englishStep }), englishStep)
})

test('a step description from the call is used the same way as one it said', () => {
  useLanguage('zh-CN')
  assert.match(workPhrase({ tool: 'edit', note: englishStep }), /Writing changes/)
  assert.equal(workPhrase({ tool: 'edit', note: chineseStep }), chineseStep)
})
