// The DOM side of the frame layout in frame-layout.js: measuring the shell's
// sidebar track, and the one CSS rule that writes the conversation column's
// margins (our own column on the left, the Bot panel on the right).
import { installStyles } from './styles.js'
import { nextCollapsedWidth, trackRoom } from './frame-layout.js'
import { growInFlight, pendingGrow } from './window-grow.js'
import { createRoomHold } from './room-hold.js'

export const sidebarTrackWidth = () => {
  const column = typeof document === 'undefined' ? null : document.querySelector('[class*="_sidebarCol"]')
  if (!column) return null
  const position = typeof getComputedStyle === 'function' ? getComputedStyle(column).position : ''
  // A drawer overlays the grid; its visible strip does not reserve a track.
  if (position === 'absolute' || position === 'fixed') return 0
  return trackRoom(column.getBoundingClientRect())
}

// The shell frame marks itself [data-sidebar-collapsed]; null when no frame is found.
export const dshCollapsed = () => {
  if (typeof document === 'undefined') return null
  const column = document.querySelector('[class*="_sidebarCol"]')
  return column ? column.closest('[data-sidebar-collapsed]') !== null : null
}

// The track the collapsed shell sidebar keeps: nothing under a frameless window
// (Windows title bar, macOS desktop), its icon rail elsewhere.
export const collapsedTrackWidth = () =>
  document.documentElement.hasAttribute('data-windows-titlebar') || document.documentElement.dataset.platform === 'darwin' ? 0 : 56

// The conversation column's margins live in one rule of our own, matched on the
// column's exact class. A custom property on <body> would restyle the whole page,
// tens of milliseconds a write. A changed rule still restyles the column's
// subtree, so a drag writes the column's own inline style each frame and the
// rule once, on release.
const room = { rule: null, selector: '' }
const roomRule = () => {
  const live = room.rule?.parentStyleSheet?.ownerNode?.isConnected
  if (live && room.selector) return room.rule
  const column = document.querySelector('[class*="_centerCol"]')
  const selector = column ? [...column.classList].filter(name => name.includes('_centerCol')).map(name => `.${CSS.escape(name)}`).join(',') : ''
  if (live && !selector) return room.rule
  const declarations = room.rule?.style.cssText ?? ''
  room.rule?.parentStyleSheet?.ownerNode?.remove()
  const style = installStyles(`${selector || '[class*="_centerCol"]'}{${declarations}}`, 'chat-room')
  room.rule = style.sheet.cssRules[0]
  room.selector = selector
  return room.rule
}
const margin = (side, width, style) => {
  if (width === null) style.removeProperty(`margin-${side}`)
  else style.setProperty(`margin-${side}`, `${width}px`, 'important')
  // A host skin can give the grid item width:100%. That width plus our margins
  // exceeds its track. Own the width until both margin overrides are released,
  // including an explicit zero used while our column is hidden.
  if (style.marginLeft || style.marginRight) style.setProperty('width', 'auto', 'important')
  else style.removeProperty('width')
}
let roomHold = 0
// A margin a panel asks for while the window is still answering its resize is held until the read
// that first sees the new width writes it in that frame (see room-hold.js).
const rightHold = createRoomHold({
  write: (width) => { margin('right', width, roomRule().style) },
  inFlight: () => growInFlight(),
})
// Set by installFrameWatch: keeps reading frames while a margin waits for the window, so the hold
// is cleared even when no resize, observer or mutation ever reports one.
let holdTick = () => {}
let holdRaf = 0
export const chatRoom = {
  /** The margin the Bot panel takes on the right, in px, or null for the shell's own. */
  setRight(width) {
    // It lands at once, never along a spring: a margin gliding for 400 ms re-wraps every line
    // of the conversation for its whole length, which is the twitch an open kept bringing.
    chatRoom.hold(true)
    if (rightHold.set(width)) { holdTick(); return }
    chatRoom.hold(false)
  },
  /** The margin our own left column takes while the shell sidebar is collapsed. */
  setLeft(width) { margin('left', width, roomRule().style) },
  /** Room above the conversation for the Bot strip: padding, so the column keeps its size
      and nothing under it overflows the window. */
  setTop(height) {
    const style = roomRule().style
    if (height === null) style.removeProperty('padding-top')
    else style.setProperty('padding-top', `${height}px`, 'important')
  },
  /** While on, a margin change lands at once instead of gliding. */
  hold(on) {
    cancelAnimationFrame(roomHold)
    if (on) { roomRule().style.setProperty('transition', 'none', 'important'); return }
    // Two frames, so the last held write is on screen before the glide comes back.
    roomHold = requestAnimationFrame(() => { roomHold = requestAnimationFrame(() => roomRule().style.removeProperty('transition')) })
  },
  /** The columns themselves, for a drag's per-frame writes. */
  columns() {
    roomRule()
    return room.selector ? [...document.querySelectorAll(room.selector)] : []
  },
}

// Feeds the frame source the geometry the layout rules read: viewport, the
// shell sidebar's collapsed track width, and its collapsed flag. A resize or a
// sidebar slide does not always come with a window event, so the track width
// comes off a ResizeObserver and the flag off a MutationObserver.
// The last installed reader, so a panel that just widened the window can tell the frame at once
// instead of waiting for the shell's own resize report.
let readFrame = () => {}
export const readFrameNow = () => readFrame()

export function installFrameWatch(frame) {
  let collapsedWidth = collapsedTrackWidth()
  let raf = 0
  const watched = new WeakSet()
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null
  const read = () => {
    // While the shell slides its sidebar (data-animating on the frame) the
    // track reports in-between widths: keep the last settled ones. The viewport
    // and the collapsed flag still update; the observer refires when the flag
    // clears, so the settled width lands then.
    const column = document.querySelector('[class*="_sidebarCol"]')
    const animating = column?.closest('[data-animating]') != null
    const width = animating ? null : sidebarTrackWidth()
    const collapsed = dshCollapsed()
    collapsedWidth = nextCollapsedWidth({ measured: width, collapsed, animating, last: collapsedWidth })
    // A window the panel is widening by answers a frame later: laying the panel out on the old
    // width for that frame put the chat through a squeeze and back, so the width it is about to
    // get is counted now.
    const measured = window.innerWidth
    const pendingWidth = pendingGrow(measured)
    const viewport = Math.max(0, measured + pendingWidth)
    frame.set((state) => {
      const next = { ...state, viewport, collapsedWidth, collapsed: collapsed === true }
      return state.viewport === next.viewport && state.collapsedWidth === next.collapsedWidth && state.collapsed === next.collapsed ? state : next
    })
    // The window caught up: the room the panel takes lands with it, in this same frame. It lands
    // at once too — the column's margin glides over a spring (the _centerCol rule), and a glide
    // beside a window that has already jumped re-flows every line of the conversation for its
    // whole length, which is the twitch an open kept bringing.
    if (pendingWidth === 0 && rightHold.waiting) {
      chatRoom.hold(true)
      rightHold.flush()
      chatRoom.hold(false)
    }
  }
  readFrame = read
  // While a margin waits for the window, read every frame: the width it waits for may arrive with
  // no event of its own to announce it.
  holdTick = () => {
    if (holdRaf !== 0) return
    holdRaf = requestAnimationFrame(() => {
      holdRaf = 0
      if (!rightHold.waiting) return
      read()
      if (rightHold.waiting) holdTick()
    })
  }
  const measure = () => {
    for (const selector of ['[class*="_sidebarCol"]', '[class*="_centerCol"]']) {
      for (const column of document.querySelectorAll(selector)) {
        if (!watched.has(column)) { watched.add(column); observer?.observe(column) }
      }
    }
    read()
  }
  const schedule = () => {
    if (raf === 0) raf = requestAnimationFrame(() => { raf = 0; measure() })
  }
  const relevant = (records) => records.some((record) => {
    if (record.type === 'attributes') return true
    const target = record.target
    if (target instanceof Element && target.closest('[data-chat-flow],[data-composer-card]')) return false
    return true
  })
  measure()
  const mutations = new MutationObserver((records) => { if (relevant(records)) schedule() })
  mutations.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-sidebar-collapsed', 'data-animating'] })
  window.addEventListener('resize', schedule)
  return () => {
    cancelAnimationFrame(raf)
    cancelAnimationFrame(holdRaf)
    holdRaf = 0
    holdTick = () => {}
    mutations.disconnect()
    observer?.disconnect()
    window.removeEventListener('resize', schedule)
    readFrame = () => {}
  }
}
