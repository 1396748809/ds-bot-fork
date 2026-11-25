// A conversation's panel in a window of its own. The main process opens that window and
// gives it a query (see main.mjs: `ds-bot-window=panel&session=…&tab=…`); this page half
// reads the query, marks the document so the panel-only layout applies, and asks for the
// details the query names. The same page runs in both windows, so the panel there is the
// very panel here, with its live data and none of the new plumbing.

export const PANEL_WINDOW_PARAM = 'ds-bot-window'

// Read once, when this module is evaluated: the shell may tidy its own address (a router
// that drops the query) long before a boot effect could ask.
const EARLY_SEARCH = globalThis.location?.search ?? ''

// The request this window carries, or null when this is the app's own window.
export function panelWindowRequest(search = EARLY_SEARCH) {
  let params
  try { params = new URLSearchParams(search) } catch { return null }
  if (params.get(PANEL_WINDOW_PARAM) !== 'panel') return null
  const session = params.get('session')
  const tab = params.get('tab')
  return {
    session: session === null || session === '' ? null : session,
    tab: tab === null || tab === '' ? null : tab,
  }
}

// Whether this window is the panel window.
export function inPanelWindow() {
  return globalThis.document?.documentElement?.dataset?.btPanelWindow !== undefined
}

// Whether the main process offers the window at all (preload.cjs exposes it).
export function canOpenPanelWindow() {
  return typeof globalThis.dsBotPanel?.open === 'function'
}

export function openPanelWindow(query) {
  const api = globalThis.dsBotPanel
  if (typeof api?.open !== 'function') return false
  void api.open(query ?? {})
  return true
}

// The panel window holds the panel and nothing else: every other child of the body (the
// app's own frame, the top bar, toasts) is hidden, and the panel takes the whole window
// instead of standing at the right edge below the top bar.
export const PANEL_WINDOW_CSS = `
html[data-bt-panel-window]{--dsh-frame-chrome-top:0px;--dsh-windows-titlebar-height:0px}
html[data-bt-panel-window] body{overflow:hidden;background:var(--bt-main)}
html[data-bt-panel-window] body>*:not(.bt-panel){display:none !important}
html[data-bt-panel-window] .bt-panel{top:0;left:0;right:0;bottom:0;width:100%;border-left:0;box-shadow:none;animation:none}
html[data-bt-panel-window] .bt-panel-grip{display:none}
html[data-bt-panel-window] .bt-panel-view{animation:none}
`
