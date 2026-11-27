import { createElement as h, useState } from 'react'
import { StopIcon } from './icons.js'
import { t } from './i18n.js'
import { holdQueueOf } from './hold-registry.js'

// The stop on a group's typing row, and its twin on a Bot's own chat: a member that has
// been at work too long is stopped from where the user is already looking, instead of
// from the details panel. It has its own module because the group row is drawn in
// cells.js while member-status.js (which cells.js already imports) holds the panel's
// stop — the dependency stays one way.
//
// Where the host does not offer the action the button is not drawn: an inert control is
// worse than none.

function StopButton({ label, text, onStop, report }) {
  const [stopping, setStopping] = useState(false)
  const press = () => {
    setStopping(true)
    void Promise.resolve(onStop()).catch(error => report?.(error)).finally(() => setStopping(false))
  }
  return h('button', {
    type: 'button', className: 'bt-typing-stop', 'data-wide': text === undefined ? undefined : '',
    disabled: stopping, title: label, 'aria-label': label, onClick: press,
  },
  h(StopIcon, text === undefined ? { size: 20, inset: 5.5, rx: 2 } : { size: 13, inset: 2, rx: 1.6 }),
  text === undefined ? null : h('span', { className: 'bt-typing-stop-text' }, text))
}

// One member of a group, stopped from the row that names it.
export function TypingStop({ bot, roomId, actions }) {
  if (typeof actions?.stopMemberWork !== 'function') return null
  return h(StopButton, {
    label: `${t('Stop this turn')} · ${bot.name}`,
    onStop: () => actions.stopMemberWork(roomId, bot.id),
    report: error => actions.reportError?.(error, 'stop'),
  })
}

// The Bot of a chat of one's own, stopped from its activity row: the composer's send
// button only turns into a stop while the draft is empty, so a half-written message
// would otherwise have no stop at all.
//
// This one is labelled rather than a bare square: the chat's row runs the width of the
// conversation, which left a lone 23px plate at the far right with a wide empty run before
// it, and the one control that throws work away was the smallest thing on the row.
export function ChatStop({ bot, sessionId, actions }) {
  if (typeof actions?.stopChat !== 'function') return null
  return h(StopButton, {
    label: `${t('Stop this turn')} · ${bot.name}`,
    text: t('Stop this turn'),
    onStop: async () => {
      // Rows the user typed but has not sent are the one thing a stop must not throw
      // away. The hold dock takes them out of the inbox before the cancel, so the
      // stopped turn cannot reopen for them; they wait as "N held messages" until one is
      // sent with its arrow or dropped. Without queued rows it cancels the plain way.
      const hold = holdQueueOf(sessionId)
      if (hold !== undefined && await hold() === true) return
      return actions.stopChat(bot.id)
    },
    report: error => actions.reportError?.(error, 'stop'),
  })
}

// Always drawn rather than on hover: a control that only appears once the pointer finds it
// cannot be found at the moment it is needed. It carries a faint plate of its own so it
// reads as a button at rest, and turns red on hover, because it is the one control on that
// row whose press throws work away. The plate stays 23px and the square inside it is kept to
// nine of those pixels, so the sign reads as a stop with air around it rather than a block
// filling a disc.
export const TYPING_STOP_CSS = `
.bt-typing-stop{flex:none;width:23px;height:23px;margin-left:2px;border:0;border-radius:999px;background:color-mix(in srgb,var(--bt-ink) 7%,transparent);color:var(--bt-ink-2);display:grid;place-items:center;padding:0;cursor:pointer;touch-action:manipulation;transition:background-color .12s ease,color .12s ease,scale .12s ease}
.bt-typing-stop:hover:not(:disabled){background:color-mix(in srgb,var(--bt-danger) 16%,transparent);color:var(--bt-danger)}
.bt-typing-stop:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-typing-stop:active:not(:disabled){scale:.92}
.bt-typing-stop:disabled{opacity:.5;cursor:default}
.bt-typing-stop[data-wide]{width:auto;padding:0 13px 0 9px;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap}
.bt-typing-stop-text{font-size:12px;line-height:1;letter-spacing:.01em}
`
