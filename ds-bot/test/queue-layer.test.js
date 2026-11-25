import assert from 'node:assert/strict'
import { test } from 'node:test'
import { queueLayer } from '../src/client/queue-layer.js'

// The unfolded queue hangs over the conversation, against the header it belongs to. The placement
// is read off that header's own box, so it follows the sidebar and the window instead of the spot
// the header used to be in.
test('the unfolded queue is placed against its own header', () => {
  const layer = queueLayer({ rect: { left: 100, top: 500, width: 700 }, viewportWidth: 1190, viewportHeight: 800 })
  assert.deepEqual(layer, { left: 100, width: 700, bottom: 306 }, 'a card as wide as the header, hanging six pixels above it')
})

test('a card wider than the room it has is cut to that room instead of leaving the window', () => {
  const layer = queueLayer({ rect: { left: 800, top: 500, width: 700 }, viewportWidth: 1190, viewportHeight: 800 })
  assert.equal(layer.left, 800)
  assert.equal(layer.width, 390, 'the window has 390 px left of that left edge')
})

test('a header that is not laid out yet places nothing, leaving the stylesheet to hang the list', () => {
  assert.equal(queueLayer({ rect: undefined, viewportWidth: 1190, viewportHeight: 800 }), null)
  assert.equal(queueLayer({ rect: { left: 0, top: 0, width: 0 }, viewportWidth: 1190, viewportHeight: 800 }), null)
})
