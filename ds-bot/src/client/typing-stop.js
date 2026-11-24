import { createElement as h, useState } from 'react'
import { StopIcon } from './icons.js'
import { t } from './i18n.js'

// The stop on a group's typing row: a member that has been at work too long is stopped
// from where the user is already looking, instead of from the details panel. It has its
// own module because the row is drawn in cells.js while the panel's stop lives in
// member-status.js, which cells.js already imports — the dependency stays one way.
//
// Where the host does not offer the action the button is not drawn: an inert control is
// worse than none.
export function TypingStop({ bot, roomId, actions }) {
  const [stopping, setStopping] = useState(false)
  if (typeof actions?.stopMemberWork !== 'function') return null
  const label = `${t('Stop')} · ${bot.name}`
  const stop = () => {
    setStopping(true)
    void Promise.resolve(actions.stopMemberWork(roomId, bot.id))
      .catch(error => actions.reportError?.(error, 'stop'))
      .finally(() => setStopping(false))
  }
  return h('button', { type: 'button', className: 'bt-typing-stop', disabled: stopping, title: label, 'aria-label': label, onClick: stop }, h(StopIcon))
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
