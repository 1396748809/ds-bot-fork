// The side panel takes its room from the window, not from the conversation: opening it widens
// the window to the right by the panel's width, and closing it gives that width back, so the
// chat beside it keeps the width it had. Whether a page may resize its own window is the
// platform's call, so nothing here trusts the call: every move is measured, and the caller gets
// what actually happened (0 when the window did not change).
//
// Only ever grows: never below the width the user set, never past the right edge of the screen.
let grown = 0
// The change the window was asked for and the frame has not reported yet. The layout counts it,
// so a panel lands on the room it is about to get instead of being laid out in the old window for
// a frame and then jumping.
let pending = 0
// The part of `pending` the window server had not answered with when it was requested: the call
// went out and the size came back unchanged, so only the next report says which of the two it
// was. Given back when it never comes, so a resize this page may not make leaves nothing behind.
let unreported = 0
// The viewport width that reports the change, and the deadline the layout waits for it.
let expected = 0
let pendingUntil = 0
// A window server answers in a frame or two. Waiting longer than this would leave the layout
// counting a width that is not coming, which is worse than the twitch it is there to avoid.
const SETTLE_MS = 240

const now = () => Number(globalThis.performance?.now?.() ?? Date.now())

/** How much room the window still has to the right, in px (Infinity when unknown). */
export function roomOnScreen(win = globalThis.window, screen = globalThis.screen) {
  const outer = Number(win?.outerWidth)
  const left = Number(win?.screenX)
  const avail = Number(screen?.availWidth)
  if (!Number.isFinite(outer) || !Number.isFinite(left) || !Number.isFinite(avail)) return Infinity
  return Math.max(0, avail - left - outer)
}

/** How far the window was widened since the panel opened (0 when it could not be). */
export const grownBy = () => grown

/** True while the window was asked to change and the frame has not reported it yet. */
export const growInFlight = () => pending !== 0 && now() <= pendingUntil

// The viewport width the window is about to have, while the frame still reports the old one.
function markPending(change, target) {
  pending = change
  expected = target
  pendingUntil = now() + SETTLE_MS
}

/**
 * Widen the window by `by` px, as far as the screen allows. Returns the room the layout should
 * count from here, which is the room the window is taking even when it has not reported it yet.
 * @param {number} by
 * @returns {number}
 */
export function growWindow(by) {
  if (!(by > 0)) return 0
  const win = globalThis.window
  if (typeof win?.resizeTo !== 'function') return 0
  const before = Number(win.outerWidth)
  if (!Number.isFinite(before)) return 0
  const inner = Number(win.innerWidth)
  const from = Number.isFinite(inner) ? inner : before
  const step = Math.round(Math.min(by, roomOnScreen()))
  if (step < 1) return 0
  const height = Number(win.outerHeight)
  try {
    if (Number.isFinite(height)) win.resizeTo(before + step, height)
    else win.resizeTo(before + step)
  } catch {
    return 0
  }
  const after = Number(win.outerWidth)
  const reported = Number.isFinite(after) ? Math.max(0, Math.round(after - before)) : 0
  // A window server that answers late still reads the old size here. The frame's own report moves
  // the change from `unreported` to `grown` when it arrives, so the close gives back what was
  // really taken and a resize that never happens takes nothing back.
  grown += reported
  unreported = reported > 0 ? 0 : step
  const counted = reported > 0 ? reported : step
  markPending(counted, from + counted)
  return counted
}

/**
 * The change the layout should already count on, in px, until the frame reports it. Call it with
 * the viewport the frame measured; once that caught up (or the window stayed put) it gives 0.
 * @param {number} measured
 * @returns {number}
 */
export function pendingGrow(measured) {
  if (pending === 0) return 0
  const seen = Number(measured)
  const caughtUp = Number.isFinite(seen) && (pending > 0 ? seen >= expected : seen <= expected)
  if (caughtUp) {
    // The window did take the room; it only reported it late.
    grown += unreported
    unreported = 0
    pending = 0
    return 0
  }
  if (now() > pendingUntil) {
    // It never took it: forget the room, and the assumption with it.
    unreported = 0
    pending = 0
    return 0
  }
  return pending
}

/** Forget a change that will not arrive: nothing may wait on it. */
export const forgetPendingGrow = () => { pending = 0; unreported = 0 }

/** Give back exactly the width the panel took, and forget it. Returns the width given back. */
export function restoreWindow() {
  const step = grown + unreported
  grown = 0
  unreported = 0
  pending = 0
  if (!(step > 0)) return 0
  const win = globalThis.window
  if (typeof win?.resizeTo !== 'function') return 0
  const before = Number(win.outerWidth)
  if (!Number.isFinite(before)) return 0
  const inner = Number(win.innerWidth)
  const from = Number.isFinite(inner) ? inner : before
  const height = Number(win.outerHeight)
  try {
    if (Number.isFinite(height)) win.resizeTo(Math.max(1, before - step), height)
    else win.resizeTo(Math.max(1, before - step))
  } catch {
    return 0
  }
  markPending(-step, from - step)
  return step
}
