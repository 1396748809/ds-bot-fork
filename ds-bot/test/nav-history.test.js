import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNavHistory } from '../src/client/nav-history.js'

// A stand-in for the surface: the open conversations, at most one covering layer, and the
// two hooks the history uses to close and reopen it. Opening a conversation records the
// step, exactly as the real view does before it switches.
const surface = ({ sessions = ['a'], at = 0, layer: start = null } = {}) => {
  const state = { at, layer: start, closed: [] }
  let nav
  nav = createNavHistory({
    current: () => sessions[state.at],
    open: (id) => {
      nav.remember(id)
      state.at = sessions.indexOf(id)
      // Opening a conversation uncovers whatever was over it.
      state.layer = null
    },
    layer: () => state.layer,
    closeLayer: (place) => { state.closed.push(place.kind); state.layer = null },
    openLayer: (place) => { state.layer = place },
  })
  const go = (id) => { nav.remember(id); state.at = sessions.indexOf(id) }
  return { nav, state, sessions, go }
}

test('back closes the layer first, and forward brings it back', () => {
  const { nav, state } = surface({ layer: { kind: 'settings', page: 'general' } })
  assert.equal(nav.back(), 'layer')
  assert.deepEqual(state.closed, ['settings'])
  assert.equal(state.layer, null)
  assert.equal(nav.forward(), 'layer')
  assert.deepEqual(state.layer, { kind: 'settings', page: 'general' })
})

test('with nothing covering it, back returns to the conversation it came from', () => {
  const { nav, state, sessions, go } = surface({ sessions: ['a', 'b', 'c'] })
  go('b')
  go('c')
  assert.equal(nav.back(), 'session')
  assert.equal(sessions[state.at], 'b')
  assert.equal(nav.back(), 'session')
  assert.equal(sessions[state.at], 'a')
  assert.equal(nav.back(), null, 'nothing left to walk back to')
})

test('forward walks the same steps again', () => {
  const { nav, state, sessions, go } = surface({ sessions: ['a', 'b', 'c'] })
  go('b')
  go('c')
  nav.back()
  nav.back()
  assert.equal(sessions[state.at], 'a')
  assert.equal(nav.forward(), 'session')
  assert.equal(sessions[state.at], 'b')
  assert.equal(nav.forward(), 'session')
  assert.equal(sessions[state.at], 'c')
  assert.equal(nav.forward(), null)
})

test('a conversation reopened by back is not recorded as a step of its own', () => {
  const { nav, state, sessions, go } = surface({ sessions: ['a', 'b'] })
  go('b')
  nav.back()
  assert.equal(sessions[state.at], 'a')
  // The surface re-enters its own openSession on the way back; that must not leave a step
  // behind, or back would bounce between the same two conversations forever.
  assert.equal(nav.back(), null)
})

test('opening something new drops the step forward', () => {
  const { nav, state, sessions, go } = surface({ sessions: ['a', 'b'], layer: { kind: 'palette' } })
  nav.back()
  go('b')
  assert.equal(nav.forward(), null, 'a new move cancels the step forward')
  assert.equal(sessions[state.at], 'b')
})

test('opening what is already on screen is not a move', () => {
  const { nav, state } = surface({ sessions: ['a'] })
  nav.remember('a')
  assert.equal(nav.back(), null)
  assert.equal(state.at, 0)
})

test('the queue keeps its newest steps only', () => {
  const ids = Array.from({ length: 80 }, (_, index) => `s${index}`)
  const { nav, state, sessions, go } = surface({ sessions: [...ids, 'now'], at: 80 })
  for (const id of ids) go(id)
  let steps = 0
  while (nav.back() === 'session') steps += 1
  assert.equal(steps, 50, 'the queue is capped at 50')
  assert.equal(sessions[state.at], 's29', 'the oldest steps fall off first')
})
