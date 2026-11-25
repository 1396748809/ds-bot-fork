import { STORAGE } from './storage.js'

// The strip is curated. Every Bot starts on it; one the user takes off stays off across
// restarts, and comes back when it is added again from the list's menu. A group chat is the
// other way round: it stays off until the user pins it there, since a team usually has more
// conversations than the band has room for. Only ids are stored, so anything that leaves
// the team simply drops out on read.
const BOTS_OFF = STORAGE.stripHidden
const ROOMS_ON = STORAGE.stripRooms
const MAIN_ON = STORAGE.stripMain
const EVENT = 'ds-bot:strip-changed'

const readIds = (key) => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(key) ?? '[]')
    return Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}

const writeIds = (key, ids) => {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(ids))
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT))
  } catch { /* storage unavailable */ }
}

const toggle = (key, id, shown) => {
  const next = readIds(key).filter(other => other !== id)
  if (shown) next.push(id)
  writeIds(key, next)
}

// Bots: on unless taken off.
export const readStripHidden = () => readIds(BOTS_OFF)
export const isOnStrip = id => !readStripHidden().includes(id)
export const setStripShown = (id, shown) => toggle(BOTS_OFF, id, !shown)

// Group chats: off unless put on.
export const readStripRooms = () => readIds(ROOMS_ON)
export const isRoomOnStrip = id => readStripRooms().includes(id)
export const setRoomStripShown = (id, shown) => toggle(ROOMS_ON, id, shown)

// The Main Bot: off unless put on too. It has an ordinary row at the top of the list, so a
// second face in the band is a choice, not a default.
export const readStripMain = () => readIds(MAIN_ON)
export const isMainOnStrip = id => readStripMain().includes(id)
export const setMainStripShown = (id, shown) => toggle(MAIN_ON, id, shown)

export const onStripChange = (run) => {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENT, run)
  return () => window.removeEventListener(EVENT, run)
}
