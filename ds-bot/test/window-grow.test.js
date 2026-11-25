import assert from 'node:assert/strict'
import { test, beforeEach } from 'node:test'
import { growWindow, grownBy, pendingGrow, restoreWindow, roomOnScreen } from '../src/client/window-grow.js'

// A stand-in for the renderer: `honour` decides whether the platform really resizes the window,
// which is exactly the difference between a grown window and a resize the page was not allowed;
// `late` is the same resize answered only after the call returned, as a window server does.
const fakeWindow = ({ outer = 900, height = 700, x = 100, honour = true, late = false } = {}) => {
  const state = { outer, height, x, calls: 0, asked: outer }
  return {
    state,
    get outerWidth() { return state.outer },
    get innerWidth() { return state.outer },
    get outerHeight() { return state.height },
    get screenX() { return state.x },
    resizeTo(width) {
      state.calls += 1
      state.asked = width
      if (honour && !late) state.outer = width
    },
    // The window server answering after the call returned.
    settle() { state.outer = state.asked },
  }
}
const fakeScreen = avail => ({ availWidth: avail })
const withGlobals = (win, screen, run) => {
  const previous = { window: globalThis.window, screen: globalThis.screen }
  globalThis.window = win
  globalThis.screen = screen
  try { return run() } finally { globalThis.window = previous.window; globalThis.screen = previous.screen }
}
// A clock the test moves, so the wait for a resize that never comes does not cost a real one.
const fakeClock = () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'performance')
  let at = 0
  return {
    install() { Object.defineProperty(globalThis, 'performance', { value: { now: () => at }, configurable: true, writable: true }) },
    advance(ms) { at += ms },
    restore() {
      if (real) Object.defineProperty(globalThis, 'performance', real)
      else delete globalThis.performance
    },
  }
}

beforeEach(() => { restoreWindow() })

test('the room to the right of the window comes from the screen edge', () => {
  assert.equal(roomOnScreen(fakeWindow({ outer: 800, x: 100 }), fakeScreen(1920)), 1020)
  assert.equal(roomOnScreen(fakeWindow({ outer: 800, x: 1200 }), fakeScreen(1920)), 0, 'a window at the edge has no room')
  assert.equal(roomOnScreen(fakeWindow(), { availWidth: undefined }), Infinity, 'an unknown screen sets no limit')
})

test('opening the panel widens the window by the panel width and closing gives it back', () => {
  const win = fakeWindow({ outer: 900 })
  withGlobals(win, fakeScreen(1920), () => {
    assert.equal(growWindow(320), 320, 'the window reports the width it gained')
    assert.equal(win.state.outer, 1220)
    assert.equal(grownBy(), 320, 'the growth is remembered for the close')
    assert.equal(restoreWindow(), 320, 'closing gives exactly that back')
    assert.equal(win.state.outer, 900)
    assert.equal(grownBy(), 0)
  })
})

test('a window this page may not resize takes no room once the wait ends', () => {
  const win = fakeWindow({ outer: 900, honour: false })
  const clock = fakeClock()
  withGlobals(win, fakeScreen(1920), () => {
    clock.install()
    try {
      assert.equal(growWindow(320), 320, 'the room is counted while the window may still take it')
      assert.equal(win.state.calls, 1)
      assert.equal(grownBy(), 0, 'nothing was measured, so nothing is held as taken')
      clock.advance(400)
      assert.equal(pendingGrow(900), 0, 'the wait ends when the window never reports the width')
      assert.equal(grownBy(), 0, 'and the room is given up')
      assert.equal(restoreWindow(), 0, 'there is nothing to give back')
    } finally { clock.restore() }
  })
})

test('the window grows only as far as the screen allows', () => {
  const win = fakeWindow({ outer: 900, x: 100 })
  withGlobals(win, fakeScreen(1020), () => {
    assert.equal(growWindow(320), 20, 'twenty pixels of screen left, so twenty pixels gained')
    assert.equal(win.state.outer, 920)
  })
})

test('a scroll wheel worth of growth is ignored, and nothing is restored twice', () => {
  const win = fakeWindow({ outer: 900 })
  withGlobals(win, fakeScreen(1920), () => {
    assert.equal(growWindow(0), 0)
    assert.equal(growWindow(-40), 0)
    assert.equal(win.state.calls, 0, 'nothing to do, so the window is not touched')
    growWindow(240)
    restoreWindow()
    assert.equal(restoreWindow(), 0, 'the second close does not shrink the window again')
    assert.equal(win.state.outer, 900)
  })
})

// The shell reports the new width a frame after the resize, and laying the panel out on the old
// width for that frame is the twitch an open used to bring: the layout counts the change first.
test('the layout counts a wider window a moment before the shell reports it', () => {
  const win = fakeWindow({ outer: 900 })
  withGlobals(win, fakeScreen(1920), () => {
    growWindow(320)
    assert.equal(pendingGrow(900), 320, 'the frame still reads the old width, the layout does not')
    assert.equal(pendingGrow(1220), 0, 'and it stops once the window reports the new one')
    assert.equal(pendingGrow(900), 0, 'a cleared change is not counted twice')
  })
})

test('a closing panel counts a narrower window before it lands too', () => {
  const win = fakeWindow({ outer: 900 })
  withGlobals(win, fakeScreen(1920), () => {
    growWindow(320)
    assert.equal(pendingGrow(1220), 0, 'the open landed')
    restoreWindow()
    assert.equal(pendingGrow(1220), -320, 'the window is still wide to the frame, narrow to the layout')
    assert.equal(pendingGrow(900), 0, 'and the closing lands too')
  })
})

// A window server answers after the call returns, so the size read straight back is the old one.
// The room still counts at once, and the report that follows is what makes it a width to give back.
test('a window server that answers late still counts the room once, and the close gives it back', () => {
  const win = fakeWindow({ outer: 900, late: true })
  withGlobals(win, fakeScreen(1920), () => {
    assert.equal(growWindow(320), 320, 'the room is counted although the window has not reported it')
    assert.equal(win.state.outer, 900, 'the window has not changed yet')
    assert.equal(grownBy(), 0, 'so nothing is measured as taken yet')
    assert.equal(pendingGrow(900), 320, 'the layout counts the room while it waits')
    win.settle()
    assert.equal(pendingGrow(1220), 0, 'the report ends the wait')
    assert.equal(grownBy(), 320, 'the room is measured now, so closing gives exactly that back')
    assert.equal(restoreWindow(), 320)
  })
})
