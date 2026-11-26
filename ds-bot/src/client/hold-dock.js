import { createElement as h, useState } from 'react'
import { t } from './i18n.js'
import { ArrowUpIcon, TrashIcon } from './icons.js'

// "Hold" stops the running turn without letting the queue start again. The
// shell's stop keeps the inbox and the loop drains it into a fresh turn at
// once, so the rows have to leave the inbox before the turn is cancelled —
// this dock does exactly that, in that order, and keeps the rows here until
// one of them is sent again with its arrow.
//
// Only rows the user authored are touched (composer sends, scheduled sends, a
// question-card answer); a Bot's deliveries still arrive through the inbox.
const OWN_QUEUE_KINDS = new Set(['user', 'schedule', 'user-question-reply'])

// Kept next to the dock rather than in it: switching chats unmounts the dock,
// and a parked message must not go with it.
const parkedBySession = new Map()

function parkedOf(sessionId) {
  return parkedBySession.get(sessionId) ?? []
}

function wordsOf(content) {
  return (content ?? []).filter(block => block?.type === 'text').map(block => block.text).join('')
}

// A parked row keeps its words; an image or a file has no way back into the
// inbox without a fresh upload, so the row says so instead of losing it quietly.
function carriesMore(content) {
  return (content ?? []).some(block => block?.type === 'image' || block?.type === 'file')
}

export function HoldDock({ sessionId, useSession, useProjection, actions, cancelTurn, removeQueued, promptQueued }) {
  const inbox = useProjection?.('inbox')
  const running = useSession?.((s) => s.running) === true
  const [busy, setBusy] = useState(null)
  const [revision, setRevision] = useState(0)
  const queued = ((inbox?.['next-turn']) ?? []).filter(row => OWN_QUEUE_KINDS.has(row.source?.kind))
  const parked = parkedOf(sessionId)
  // `revision` only exists to re-render after the map changes; reading it here
  // keeps the dependency honest without a lint exemption.
  void revision
  if (queued.length === 0 && parked.length === 0) return null
  const bump = () => setRevision(value => value + 1)
  const holdNow = async () => {
    if (busy !== null || queued.length === 0) return
    setBusy('hold')
    const taken = queued.map(row => ({ id: row.id, content: row.content }))
    parkedBySession.set(sessionId, [...parked, ...taken])
    bump()
    try {
      // Out of the inbox first: cancelling with rows still queued would let the
      // loop open a new turn for them, which is the behaviour being replaced.
      for (const row of taken) await removeQueued(row.id)
      await cancelTurn()
    } catch {
      actions.reportError(new Error(t('Couldn’t hold the queue. Try again.')), 'hold-queue')
    } finally {
      setBusy(null)
    }
  }
  const sendParked = async (row) => {
    if (busy !== null) return
    setBusy(row.id)
    try {
      if (await promptQueued(row.content)) {
        parkedBySession.set(sessionId, parkedOf(sessionId).filter(item => item.id !== row.id))
        bump()
      }
    } catch {
      actions.reportError(new Error(t('Couldn’t send the held message. Try again.')), 'hold-queue')
    } finally {
      setBusy(null)
    }
  }
  const dropParked = (row) => {
    parkedBySession.set(sessionId, parkedOf(sessionId).filter(item => item.id !== row.id))
    bump()
  }
  return h('div', { className: 'bt-hold-dock', 'data-hold-dock': '' },
    running && queued.length > 0
      ? h('div', { className: 'bt-hold-bar' },
        h('span', { className: 'bt-hold-note' }, t('{n} queued messages', { n: queued.length })),
        h('button', {
          type: 'button',
          className: 'bt-hold-btn',
          disabled: busy !== null,
          title: t('Hold this turn and keep the queue'),
          onClick: holdNow,
        }, t('Hold')))
      : null,
    parked.length > 0
      ? h('div', { className: 'bt-hold-panel' },
        h('div', { className: 'bt-hold-head' }, t('{n} held messages', { n: parked.length })),
        h('ul', { className: 'bt-hold-list' }, parked.map(row => h('li', { key: row.id, className: 'bt-hold-row' },
          h('span', { className: 'bt-hold-text' }, wordsOf(row.content)),
          carriesMore(row.content)
            ? h('span', { className: 'bt-hold-warn' }, t('The attachment does not survive holding'))
            : null,
          h('button', {
            type: 'button',
            className: 'bt-hold-action',
            'aria-label': t('Send this held message'),
            title: t('Send this held message'),
            disabled: busy !== null,
            onClick: () => void sendParked(row),
          }, h(ArrowUpIcon)),
          h('button', {
            type: 'button',
            className: 'bt-hold-action',
            'aria-label': t('Drop this held message'),
            title: t('Drop this held message'),
            disabled: busy !== null,
            onClick: () => dropParked(row),
          }, h(TrashIcon))))))
      : null)
}

export const HOLD_CSS = `
.bt-hold-dock{box-sizing:border-box;width:100%;margin:0 auto;flex:none;display:flex;flex-direction:column;gap:6px}
.bt-hold-bar{box-sizing:border-box;display:flex;align-items:center;gap:10px;padding:4px 10px;border-radius:12px;background:var(--bt-main);border:.5px solid var(--bt-line-2)}
.bt-hold-note{min-width:0;flex:auto;font-size:12px;line-height:18px;color:var(--bt-ink-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-hold-btn{flex:none;height:26px;padding:0 12px;border:.5px solid var(--bt-line-2);border-radius:999px;background:none;color:var(--bt-ink-2);font:inherit;font-size:12px;cursor:pointer}
.bt-hold-btn:hover:not(:disabled){background:var(--bt-hover);color:var(--bt-ink)}
.bt-hold-btn:disabled{opacity:.4;cursor:default}
.bt-hold-panel{box-sizing:border-box;border-radius:12px;background:var(--bt-main);border:.5px solid var(--bt-line-2);overflow:hidden}
.bt-hold-head{padding:6px 12px;font-size:12px;font-weight:500;color:var(--bt-ink-3)}
.bt-hold-list{margin:0;padding:0;list-style:none;max-height:160px;overflow-y:auto}
.bt-hold-row{box-sizing:border-box;display:flex;align-items:center;gap:10px;min-height:34px;padding:4px 6px 4px 12px}
.bt-hold-row+.bt-hold-row{box-shadow:inset 0 1px 0 var(--bt-line)}
.bt-hold-text{min-width:0;flex:auto;font-size:13px;line-height:18px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-hold-warn{flex:none;font-size:11px;color:var(--bt-ink-3)}
.bt-hold-action{flex:none;width:26px;height:26px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);cursor:pointer;display:grid;place-items:center;padding:0}
.bt-hold-action:hover:not(:disabled){background:var(--bt-hover);color:var(--bt-ink)}
.bt-hold-action:disabled{opacity:.4;cursor:default;color:var(--bt-ink-3)}
`
