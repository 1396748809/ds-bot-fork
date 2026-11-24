import { createElement as h, useState } from 'react'
import { StopIcon } from './icons.js'
import { t } from './i18n.js'

// The stop on a group's typing row, and its twin on a Bot's own chat: a member that has
// been at work too long is stopped from where the user is already looking, instead of
// from the details panel. It has its own module because the group row is drawn in
// cells.js while member-status.js (which cells.js already imports) holds the panel's
// stop — the dependency stays one way.
//
// Where the host does not offer the action the button is not drawn: an inert control is
// worse than none.

function StopButton({ label, onStop, report }) {
  const [stopping, setStopping] = useState(false)
  const press = () => {
    setStopping(true)
    void Promise.resolve(onStop()).catch(error => report?.(error)).finally(() => setStopping(false))
  }
  return h('button', { type: 'button', className: 'bt-typing-stop', disabled: stopping, title: label, 'aria-label': label, onClick: press }, h(StopIcon))
}

// One member of a group, stopped from the row that names it.
export function TypingStop({ bot, roomId, actions }) {
  if (typeof actions?.stopMemberWork !== 'function') return null
  return h(StopButton, {
    label: `${t('Stop')} · ${bot.name}`,
    onStop: () => actions.stopMemberWork(roomId, bot.id),
    report: error => actions.reportError?.(error, 'stop'),
  })
}

// The Bot of a chat of one's own, stopped from its activity row: the composer's send
// button only turns into a stop while the draft is empty, so a half-written message
// would otherwise have no stop at all.
export function ChatStop({ bot, actions }) {
  if (typeof actions?.stopChat !== 'function') return null
  return h(StopButton, {
    label: `${t('Stop')} · ${bot.name}`,
    onStop: () => actions.stopChat(bot.id),
    report: error => actions.reportError?.(error, 'stop'),
  })
}

// Always drawn rather than on hover: a control that only appears once the pointer finds it
// cannot be found at the moment it is needed. Red on hover, because it is the one control
// on that row whose press throws work away.
export const TYPING_STOP_CSS = `
.bt-typing-stop{flex:none;width:22px;height:22px;margin-left:2px;border:0;border-radius:999px;background:none;color:var(--bt-ink-3);display:grid;place-items:center;padding:0;cursor:pointer;touch-action:manipulation;transition:background-color .12s ease,color .12s ease,scale .12s ease}
.bt-typing-stop:hover:not(:disabled){background:color-mix(in srgb,var(--bt-danger) 12%,transparent);color:var(--bt-danger)}
.bt-typing-stop:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-typing-stop:active:not(:disabled){scale:.92}
.bt-typing-stop:disabled{opacity:.5;cursor:default}
`
