// A panel's right margin is asked for while the panel is being laid out, which is before the
// window server has answered the resize the same click made. Written on the spot, the
// conversation narrows for the frames until the window catches up and then snaps back: the twitch
// an open brings. So a margin asked for while a resize is in flight is held here, and the read
// that first sees the new width writes it in that same frame, so the window growing and the room
// the panel takes land in one paint. The same holding covers a close, where the margin is asked
// for before the window has shrunk back.
//
// Nothing here reads the DOM or the clock: `inFlight` says whether a resize is on its way and
// `write` puts the margin where it belongs.
/**
 * @param {{write: (width: number|null) => void, inFlight: () => boolean}} io
 */
export function createRoomHold({ write, inFlight }) {
  let held
  return {
    /** Take a margin. Returns true when it is waiting for the window instead of written. */
    set(width) {
      if (inFlight()) { held = width; return true }
      held = undefined
      write(width)
      return false
    },
    /** Write the margin that was waiting, if any. Returns true when one was written. */
    flush() {
      if (held === undefined) return false
      const width = held
      held = undefined
      write(width)
      return true
    },
    /** True while a margin waits for the window. */
    get waiting() { return held !== undefined },
    /** The margin that is waiting, or undefined. */
    get pending() { return held },
  }
}
