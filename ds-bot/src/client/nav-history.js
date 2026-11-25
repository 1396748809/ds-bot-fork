// Back and forward for the mouse's side buttons.
//
// This window has no browser history to walk: the Bot surface never changes the URL, so
// `history.back()` has nothing to return to. The steps are the ones the interface itself
// makes — the layer covering the conversation (settings, the new-chat pane, a details
// panel) closes first, and once nothing covers it the view walks back through the
// conversations it came from. Forward undoes exactly what back did.
export function createNavHistory({ current, open, layer, closeLayer, openLayer, limit = 50 }) {
  const past = []
  const future = []
  let replaying = false
  let closed = null
  const push = (list, id) => {
    if (id === undefined || id === null) return
    list.push(id)
    while (list.length > limit) list.shift()
  }
  const jump = (id) => {
    replaying = true
    try { open(id) } finally { replaying = false }
  }
  return {
    // The view calls this just before opening another conversation, so the one it leaves
    // is where back returns to. Replayed steps are not steps of their own.
    remember(next) {
      if (replaying) return
      const previous = current()
      // Opening what is already on screen is not a move, and it must not eat the step
      // a forward would have taken.
      if (previous === undefined || previous === null || next === previous) return
      closed = null
      future.length = 0
      push(past, previous)
    },
    back() {
      const place = layer()
      if (place !== null && place !== undefined) {
        closed = place
        closeLayer(place)
        return 'layer'
      }
      const id = past.pop()
      if (id === undefined) return null
      push(future, current())
      jump(id)
      return 'session'
    },
    forward() {
      if (closed !== null) {
        const place = closed
        closed = null
        openLayer(place)
        return 'layer'
      }
      const id = future.pop()
      if (id === undefined) return null
      push(past, current())
      jump(id)
      return 'session'
    },
  }
}
