// Where the unfolded queue list hangs: against the header it belongs to, in window coordinates.
// It is never wider than the room right of that header's left edge, so a stale or oversized
// measurement cannot float the card off to the right or leave it clipped by the window.
// Pure, so the placement can be driven without a browser; the DOM side lives in queue-dock.js.
/**
 * @param {{rect: {left: number, top: number, width: number}|undefined|null, viewportWidth: number, viewportHeight: number}} input
 * @returns {null | {left: number, width: number, bottom: number}}
 */
export function queueLayer({ rect, viewportWidth, viewportHeight }) {
  if (!rect || !rect.width) return null
  const left = Math.max(0, Math.round(rect.left))
  const width = Math.max(120, Math.min(Math.round(rect.width), Math.round(viewportWidth - left)))
  const bottom = Math.round(viewportHeight - rect.top + 6)
  return { left, width, bottom }
}
