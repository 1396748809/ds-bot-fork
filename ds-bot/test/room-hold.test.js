import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRoomHold } from '../src/client/room-hold.js'

const harness = (inFlight) => {
  const written = []
  let flying = inFlight
  const hold = createRoomHold({ write: width => written.push(width), inFlight: () => flying })
  return { hold, written, now: (on) => { flying = on } }
}

test('a margin asked for while the window is resizing waits for it', () => {
  const { hold, written } = harness(true)
  assert.equal(hold.set(320), true, 'held, not written')
  assert.deepEqual(written, [], 'the conversation is not narrowed ahead of the window')
  assert.equal(hold.waiting, true)
  assert.equal(hold.pending, 320)
  assert.equal(hold.flush(), true, 'the frame that sees the new width writes it')
  assert.deepEqual(written, [320])
  assert.equal(hold.waiting, false)
  assert.equal(hold.flush(), false, 'nothing waits twice')
  assert.deepEqual(written, [320])
})

test('a margin is written at once when no resize is on its way', () => {
  const { hold, written } = harness(false)
  assert.equal(hold.set(320), false)
  assert.deepEqual(written, [320])
  assert.equal(hold.waiting, false)
})

test('a close holds the removal the same way, so the chat is not widened ahead of the window', () => {
  const { hold, written, now } = harness(false)
  hold.set(320)
  now(true)
  assert.equal(hold.set(null), true, 'the removal waits for the window to shrink back')
  assert.deepEqual(written, [320], 'the room the panel took stands until then')
  now(false)
  assert.equal(hold.flush(), true)
  assert.deepEqual(written, [320, null])
})

test('a newer margin replaces the one that is still waiting', () => {
  const { hold, written, now } = harness(true)
  hold.set(320)
  hold.set(360)
  assert.equal(hold.pending, 360, 'the margin that lands is the one asked for last')
  now(false)
  hold.flush()
  assert.deepEqual(written, [360])
})
