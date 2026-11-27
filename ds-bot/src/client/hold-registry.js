// The queue a stop could keep. The hold dock already knows how to take the user's own
// queued rows out of the inbox and then cancel, so the stopped turn cannot reopen for
// them; it registers that move here so the stop in the activity row can do the same.
//
// Only a session with a live dock registration has one: a session whose dock is not
// mounted (or that has nothing queued) stops the plain way.
const holders = new Map()

export function registerQueueHold(sessionId, hold) {
  if (typeof sessionId !== 'string') return () => {}
  holders.set(sessionId, hold)
  return () => {
    if (holders.get(sessionId) === hold) holders.delete(sessionId)
  }
}

export function holdQueueOf(sessionId) {
  return sessionId === undefined ? undefined : holders.get(sessionId)
}
