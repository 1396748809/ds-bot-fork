import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PANEL_WINDOW_CSS, inPanelWindow, panelWindowRequest } from '../src/client/panel-window.js'

test('the app window asks for no panel window', () => {
  assert.equal(panelWindowRequest(''), null)
  assert.equal(panelWindowRequest('?session=abc'), null)
  assert.equal(panelWindowRequest('?ds-bot-window=other'), null)
})

test('a panel window carries the panel, with no session named', () => {
  assert.deepEqual(panelWindowRequest('?ds-bot-window=panel'), { session: null, tab: null })
  assert.deepEqual(panelWindowRequest('?ds-bot-window=panel&session=&tab='), { session: null, tab: null })
})

test('the session and the tab it opens come through', () => {
  assert.deepEqual(
    panelWindowRequest('?ds-bot-window=panel&session=part-3&tab=tasks'),
    { session: 'part-3', tab: 'tasks' })
})

test('the flag has to say exactly "panel", and be its own parameter', () => {
  assert.equal(panelWindowRequest('?ds-bot-window=panels'), null)
  assert.equal(panelWindowRequest('?x=ds-bot-window%3Dpanel'), null)
})

test('only a marked document counts as the panel window', () => {
  globalThis.document = { documentElement: { dataset: {} } }
  try {
    assert.equal(inPanelWindow(), false)
    globalThis.document.documentElement.dataset.btPanelWindow = ''
    assert.equal(inPanelWindow(), true)
  } finally { delete globalThis.document }
})

test('the panel takes the window, and everything else in it is hidden', () => {
  assert.match(PANEL_WINDOW_CSS, /html\[data-bt-panel-window\] body>\*:not\(\.bt-panel\)\{display:none !important\}/u)
  assert.match(PANEL_WINDOW_CSS, /html\[data-bt-panel-window\] \.bt-panel\{top:0;/u)
  // The panel normally starts below the top bar and stops its own exit animation there.
  assert.match(PANEL_WINDOW_CSS, /html\[data-bt-panel-window\]\{--dsh-frame-chrome-top:0px/u)
})
