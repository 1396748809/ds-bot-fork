import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isMainOnStrip, isOnStrip, isRoomOnStrip, onStripChange, readStripHidden, readStripMain, readStripRooms, setMainStripShown, setRoomStripShown, setStripShown } from '../src/client/strip-bar.js'

const KEY = 'ds-bot:strip-hidden'

const fakeStorage = () => {
  const data = new Map()
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)) },
    removeItem: key => { data.delete(key) },
  }
}

const setGlobal = (name, value) => {
  const before = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  return () => {
    if (before) Object.defineProperty(globalThis, name, before)
    else delete globalThis[name]
  }
}

const withStage = (run) => {
  const restore = [setGlobal('localStorage', fakeStorage()), setGlobal('window', new EventTarget())]
  try {
    return run()
  } finally {
    restore.reverse().forEach(undo => undo())
  }
}

test('every Bot is on the strip until the user takes one off', () => {
  withStage(() => {
    assert.deepEqual(readStripHidden(), [])
    assert.equal(isOnStrip('writer'), true)
    setStripShown('writer', false)
    assert.deepEqual(readStripHidden(), ['writer'])
    assert.equal(isOnStrip('writer'), false)
    setStripShown('writer', true)
    assert.deepEqual(readStripHidden(), [])
    assert.equal(isOnStrip('writer'), true)
  })
})

test('taking a Bot off tells the strip to read the list again', () => {
  withStage(() => {
    let heard = 0
    const stop = onStripChange(() => { heard += 1 })
    setStripShown('writer', false)
    assert.equal(heard, 1)
    stop()
    setStripShown('writer', true)
    assert.equal(heard, 1)
  })
})

test('the same id is never stored twice', () => {
  withStage(() => {
    setStripShown('writer', false)
    setStripShown('writer', false)
    assert.deepEqual(readStripHidden(), ['writer'])
  })
})

test('an unreadable or foreign value counts as "nothing hidden"', () => {
  withStage(() => {
    globalThis.localStorage.setItem(KEY, 'not json')
    assert.deepEqual(readStripHidden(), [])
    globalThis.localStorage.setItem(KEY, '{"a":1}')
    assert.deepEqual(readStripHidden(), [])
    globalThis.localStorage.setItem(KEY, '["a",2,"b"]')
    assert.deepEqual(readStripHidden(), ['a', 'b'])
  })
})

test('a group chat stays off the strip until it is put there', () => {
  withStage(() => {
    assert.equal(isRoomOnStrip('room'), false)
    setRoomStripShown('room', true)
    assert.equal(isRoomOnStrip('room'), true)
    assert.deepEqual(readStripRooms(), ['room'])
    setRoomStripShown('room', false)
    assert.equal(isRoomOnStrip('room'), false)
    assert.deepEqual(readStripRooms(), [])
  })
})

test('the Bots taken off and the groups put on are separate lists', () => {
  withStage(() => {
    setStripShown('writer', false)
    setRoomStripShown('room', true)
    assert.deepEqual(readStripHidden(), ['writer'])
    assert.deepEqual(readStripRooms(), ['room'])
    // A group is never "a Bot that was taken off", and the other way round.
    assert.equal(isOnStrip('room'), true)
    assert.equal(isRoomOnStrip('writer'), false)
  })
})

test('the Main Bot joins the band only when it is put there', () => {
  withStage(() => {
    assert.equal(isMainOnStrip('chief'), false)
    setMainStripShown('chief', true)
    assert.equal(isMainOnStrip('chief'), true)
    assert.deepEqual(readStripMain(), ['chief'])
    // Its own list: putting it up never touches the taken-off Bots or the groups.
    assert.deepEqual(readStripHidden(), [])
    assert.deepEqual(readStripRooms(), [])
    setMainStripShown('chief', false)
    assert.equal(isMainOnStrip('chief'), false)
    assert.deepEqual(readStripMain(), [])
  })
})
