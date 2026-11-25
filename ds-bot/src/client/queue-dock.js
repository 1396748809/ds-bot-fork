import { createElement as h, Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { t } from './i18n.js'
import { ArrowUpIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, PaperclipIcon, PencilIcon, QueueIcon, TrashIcon } from './icons.js'
import { queueLayer } from './queue-layer.js'

// The queue dock above the composer, drawn by DS Bot in place of the shell's own
// (same slot, same id 'queue'). The session inbox also queues the team's mail —
// requests, replies and reports a delivery sends with agent.followup arrive as
// kind 'bot' — but they are the Bot's incoming messages, not drafts of the user.
// The shell's dock draws every queued row as the user's own: a relay looked
// typed, and one tap on its edit, delete or steer controls rewrote or dropped a
// team's exchange (#663). Here only rows the user authored are listed; a Bot's
// deliveries still reach it, they just never sit in this dock.

// Kinds carrying the user's own queued sends: composer submissions, scheduled
// sends and an answer filed through a question card.
const OWN_QUEUE_KINDS = new Set(['user', 'schedule', 'user-question-reply'])

const EMPTY_QUEUE = []
const QUEUE_TEXT_FACTS = { collapseWhitespace: true, trimWhitespace: true }

// The words a row carries, whatever else rides with them. A parked line that also holds a
// picture still has text to correct, so the pencil stays usable on it.

// Durable references carried by one queued row. Inbox projections are wire data,
// so a block without a reference is skipped rather than trusted.
function queueAttachments(content) {
  const attachments = []
  for (const block of content) {
    if (block.type === 'image' || block.type === 'file') {
      if (block.attachment !== undefined) attachments.push({ type: block.type, attachment: block.attachment })
    }
  }
  return attachments
}

const fileSizeText = (bytes) => typeof bytes !== 'number' || !Number.isFinite(bytes) ? ''
  : bytes < 1024 ? `${bytes} B`
    : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`

function QueueFile({ attachment, label }) {
  const size = fileSizeText(attachment.bytes)
  return h('span', { className: 'bt-queue-file', 'aria-label': label, title: attachment.name },
    h('span', { className: 'bt-queue-fileicon', 'aria-hidden': true }, h(PaperclipIcon)),
    h('span', { className: 'bt-queue-filename' }, attachment.name),
    size !== '' ? h('span', { className: 'bt-queue-filesize' }, size) : null)
}

// One durable queued image as a fixed-size thumbnail; a load failure keeps the
// empty placeholder.
function QueueThumb({ attachment, loadImage, label }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let alive = true
    loadImage(attachment).then((resolved) => { if (alive) setUrl(resolved) }, () => {})
    return () => { alive = false }
  }, [attachment, loadImage])
  return url === null
    ? h('span', { className: 'bt-queue-thumb', 'aria-hidden': true })
    : h('img', { className: 'bt-queue-thumb', src: url, alt: label })
}

// The row's content in the plain-text preview the dock draws; the user-text
// factory renders it when the shell provides one.
function Preview({ text, renderFactorySlot }) {
  const rendered = renderFactorySlot?.('conversation.user.text', { text, facts: QUEUE_TEXT_FACTS, interactive: false, ellipsis: true })
  return h('span', { className: 'bt-queue-preview' }, rendered ?? text)
}

function EditField({ text, onChange, onSave, onCancel }) {
  const field = useRef(null)
  // The editor opens with the caret at the end of the line: correcting a queued message
  // usually means adding to it or fixing the tail, and a caret parked before the text sends
  // the first keystroke to the wrong place. Set once, so typing in the middle stays put.
  useEffect(() => {
    const node = field.current
    if (node === null) return
    node.focus()
    try {
      const end = node.value.length
      node.setSelectionRange(end, end)
    } catch {
      // A field that will not take a range still took the focus.
    }
  }, [])
  // The box grows with the text, on the first paint and on every change.
  useEffect(() => {
    const node = field.current
    if (node === null) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [text])
  return h('textarea', {
    ref: field,
    className: 'bt-queue-edit',
    value: text,
    rows: 1,
    'aria-label': t('Edit queued message'),
    onChange: event => onChange(event.target.value),
    onKeyDown: (event) => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.stopPropagation(); onCancel() }
      else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onSave() }
    },
  })
}

function RowButton({ label, title, disabled, onClick, children }) {
  return h('button', { type: 'button', className: 'bt-queue-action', 'aria-label': label, title: title ?? label, disabled, onClick }, children)
}

// One item renders directly; several default to a collapsible count header; an
// empty queue renders nothing. Rows still in flight show a sending state with
// disabled actions until their queue rows arrive.
export function QueueDock({ useSession, useProjection, updateQueue, loadImage, renderFactorySlot, actions }) {
  const inbox = useProjection?.('inbox')
  const pendingSubmissions = useSession?.((s) => s.pendingSubmissions) ?? EMPTY_QUEUE
  const queue = useMemo(() => {
    const rows = (inbox?.['next-turn'] ?? EMPTY_QUEUE).filter(row => OWN_QUEUE_KINDS.has(row.source?.kind))
    const inChat = new Set(pendingSubmissions.filter(item => item.placement === 'transcript').map(item => item.requestId))
    return inChat.size === 0 ? rows : rows.filter(({ source }) => source === null || typeof source !== 'object' || !('rpcId' in source) || !inChat.has(source.rpcId))
  }, [inbox, pendingSubmissions])
  const pendingQueue = useMemo(() => {
    const admitted = new Set(queue.flatMap(({ source }) => (source !== null && typeof source === 'object' && 'rpcId' in source) ? [source.rpcId] : []))
    return pendingSubmissions.filter(submission => submission.placement === 'queued' && !admitted.has(submission.requestId))
  }, [pendingSubmissions, queue])
  const rowCount = queue.length + pendingQueue.length
  const running = useSession?.((s) => s.running) === true
  const queueMutable = useSession?.((s) => s.subagent === null || s.subagent === undefined || s.subagent.address?.mode === 'continuable') ?? true
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(null)
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()
  useEffect(() => {
    if (rowCount === 0 && !collapsed) setCollapsed(true)
    if (editing !== null && (!queueMutable || !queue.some(row => row.id === editing.id))) setEditing(null)
  }, [collapsed, editing, queue, queueMutable, rowCount])
  // A press anywhere outside the dock puts the editor away: an editor that only its own two
  // buttons can close is easy to get stuck in.
  const panelRef = useRef(null)
  useEffect(() => {
    if (editing === null) return undefined
    const onDown = (event) => {
      const target = event.target
      if (target === null || typeof target !== 'object') return
      if (panelRef.current?.contains(target)) return
      setEditing(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [editing])
  if (rowCount === 0) return null
  const interactionActive = queueMutable && (editing !== null || busy !== null)
  const expanded = !collapsed || interactionActive
  const listVisible = rowCount === 1 || expanded
  const applyAction = async (itemId, action, failure) => {
    setBusy(itemId)
    try {
      const result = await updateQueue(itemId, action)
      // A row the Agent already claimed converges by itself — it left the queue,
      // or goes with the next turn either way.
      if (result && result.ok === false
        && result.error?.code !== 'session/queue-item-not-found'
        && result.error?.code !== 'session/steer-unavailable') {
        actions.reportError(new Error(failure), 'queue')
        return false
      }
      return true
    } catch {
      actions.reportError(new Error(failure), 'queue')
      return false
    } finally {
      setBusy(current => current === itemId ? null : current)
    }
  }
  const saveEdit = async () => {
    if (editing === null || editing.text.trim() === '') return
    if (await applyAction(editing.id, { kind: 'edit', content: [{ type: 'text', text: editing.text }] }, t('Couldn’t edit the queued message — it may have started already.'))) setEditing(null)
  }
  // The unfolded list is placed against the header it belongs to, in window coordinates: the
  // composer stack cannot clip what it does not contain, and the conversation under it keeps
  // its own height instead of being pushed up by the queue.
  const [layer, setLayer] = useState(null)
  useLayoutEffect(() => {
    if (!(rowCount > 1 && expanded)) {
      setLayer(null)
      return undefined
    }
    let frame = 0
    const place = () => {
      const next = queueLayer({ rect: panelRef.current?.getBoundingClientRect?.(), viewportWidth: window.innerWidth, viewportHeight: window.innerHeight })
      if (next === null) return
      setLayer(current => (current !== null && current.left === next.left && current.width === next.width && current.bottom === next.bottom ? current : next))
    }
    // The header moves and resizes with the window, the sidebar and the column's own layout, and
    // nothing resizes it by a window event: the measured spot has to follow the element itself,
    // or the card stays where the header used to be.
    const soon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(place)
    }
    place()
    // A second look once this frame is painted: the composer may still be settling when the list
    // opens, and the first measurement can be a staler one.
    frame = requestAnimationFrame(place)
    window.addEventListener?.('resize', soon)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(soon) : null
    if (observer && panelRef.current) observer.observe(panelRef.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener?.('resize', soon)
      observer?.disconnect()
    }
  }, [rowCount, expanded])
  return h('div', { className: 'bt-queue-dock', 'data-queue-dock': '' },
    // With more than one row the list opens as a layer over the conversation instead of
    // taking height in the composer stack: unfolding a queue never shoves the chat up.
    h('div', { className: 'bt-queue-panel', ref: panelRef, 'data-floating': rowCount > 1 ? 'true' : undefined },
      rowCount > 1 && h('button', {
        type: 'button', className: 'bt-queue-head', 'aria-controls': listId, 'aria-expanded': expanded,
        // While a row is being edited, this is the way out: close the editor and fold the list.
        onClick: () => {
          if (editing !== null) { setEditing(null); setCollapsed(true); return }
          setCollapsed(value => !value)
        },
      },
        h('span', { className: 'bt-queue-lead', 'aria-hidden': true }, h(QueueIcon)),
        h('span', { className: 'bt-queue-count' }, t('{n} queued messages', { n: rowCount })),
        // The other half of the story: a queued row is parked until this turn ends, and
        // the composer can move it into the turn with Ctrl+Enter or the row's steer button.
        running && h('span', { className: 'bt-queue-hint' }, t('Waits for this turn to end')),
        !listVisible && pendingQueue.length > 0 && h('span', { className: 'bt-queue-status', role: 'status' }, t('Sending…')),
        h('span', { className: 'bt-queue-chev', 'aria-hidden': true }, expanded ? h(ChevronDownIcon) : h(ChevronUpIcon))),
      h('ul', {
        id: listId, className: 'bt-queue-list', hidden: !listVisible,
        // Measured placement in the window; without it (no layout to measure yet) the stylesheet
        // hangs the list over the panel's top edge instead.
        style: layer === null ? undefined : { position: 'fixed', left: `${layer.left}px`, right: 'auto', width: `${layer.width}px`, bottom: `${layer.bottom}px` },
      },
        listVisible && queue.map((row) => {
          const attachments = queueAttachments(row.content)
          // The host takes text-only queue edits ("queue edits accept text content only"), so
          // saving an edited line keeps its words and drops whatever else it carried. The row
          // says so where the user is editing, instead of hiding the pencil altogether: a
          // parked line is exactly the one worth correcting before the turn ends.
          const words = row.content.filter(block => block.type === 'text').map(block => block.text).join('')
          const dropsAttachments = attachments.length > 0
          return h('li', { key: row.id, className: 'bt-queue-row' },
            rowCount === 1 && h('span', { className: 'bt-queue-lead', 'aria-hidden': true }, h(QueueIcon)),
            editing?.id === row.id
              ? h('div', { className: 'bt-queue-edit-wrap' },
                h(EditField, { text: editing.text, onChange: text => setEditing({ id: row.id, text }), onSave: saveEdit, onCancel: () => setEditing(null) }),
                dropsAttachments ? h('span', { className: 'bt-queue-edit-warn', role: 'note' }, t('Saving keeps the text only — the attachment goes')) : null)
              : h(Fragment, null,
                attachments.length > 0 && h('span', { className: 'bt-queue-attachments' },
                  attachments.map((item, index) => item.type === 'image'
                    ? h(QueueThumb, { key: `${item.attachment.attachmentId}:${index}`, attachment: item.attachment, loadImage, label: t('Queued image') })
                    : h(QueueFile, { key: `${item.attachment.attachmentId}:${item.attachment.name}:${index}`, attachment: item.attachment, label: t('Queued file {name}', { name: item.attachment.name }) }))),
                h(Preview, { text: words, renderFactorySlot })),
            // One row renders without the count header, so the parked note rides on the row.
            rowCount === 1 && running && h('span', { className: 'bt-queue-hint' }, t('Waits for this turn to end')),
            queueMutable && h('div', { className: 'bt-queue-actions' },
              editing?.id === row.id
                ? h(Fragment, null,
                  h(RowButton, { label: t('Save queued message'), disabled: busy !== null || editing.text.trim() === '', onClick: saveEdit }, h(CheckIcon)),
                  h(RowButton, { label: t('Cancel editing'), disabled: busy !== null, onClick: () => setEditing(null) }, h(CloseIcon)))
                : h(Fragment, null,
                  h(RowButton, { label: t('Edit queued message'), title: dropsAttachments ? t('Saving keeps the text only — the attachment goes') : undefined, disabled: busy !== null, onClick: () => setEditing({ id: row.id, text: words }) }, h(PencilIcon)),
                  h(RowButton, { label: t('Delete queued message'), disabled: busy !== null, onClick: () => applyAction(row.id, { kind: 'remove' }, t('Couldn’t delete the queued message — it may have started already.')) }, h(TrashIcon)),
                  h(RowButton, { label: t('Steer queued message'), title: running ? undefined : t('Only while a turn is running'), disabled: busy !== null || !running, onClick: () => applyAction(row.id, { kind: 'steer' }, t('Couldn’t steer the queued message. Try again.')) }, h(ArrowUpIcon)))))
        }),
        listVisible && pendingQueue.map(submission => h('li', { key: submission.requestId, className: 'bt-queue-row bt-queue-pending' },
          rowCount === 1 && h('span', { className: 'bt-queue-lead', 'aria-hidden': true }, h(QueueIcon)),
          submission.attachments.length > 0 && h('span', { className: 'bt-queue-attachments' },
            submission.attachments.map((attachment, index) => attachment.type === 'image'
              ? h('img', { key: `${attachment.value.previewUrl}:${index}`, className: 'bt-queue-thumb', src: attachment.value.previewUrl, alt: t('Queued image') })
              : h(QueueFile, { key: `${attachment.value.attachmentId}:${attachment.value.name}:${index}`, attachment: attachment.value, label: t('Queued file {name}', { name: attachment.value.name }) }))),
          h(Preview, { text: submission.text, renderFactorySlot }),
          h('span', { className: 'bt-queue-status', role: 'status' }, t('Sending…')),
          queueMutable && h('div', { className: 'bt-queue-actions' },
            h(RowButton, { label: t('Edit queued message'), title: t('Sending…'), disabled: true }, h(PencilIcon)),
            h(RowButton, { label: t('Delete queued message'), title: t('Sending…'), disabled: true }, h(TrashIcon)),
            h(RowButton, { label: t('Steer queued message'), title: t('Sending…'), disabled: true }, h(ArrowUpIcon))))))))
}

export const QUEUE_CSS = `
.bt-queue-dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-side-clearance,0px) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));max-width:calc(var(--dsh-composer-card-max-width,748px) - var(--dsh-composer-dock-inset,0px) - var(--dsh-composer-dock-inset,0px));margin:0 auto calc(0px - var(--dsh-composer-stack-gap,8px) - 3px);padding:0 var(--dsh-composer-dock-inset,0px);flex:none}
.bt-queue-panel{position:relative;isolation:isolate;width:100%;padding:2px 0;border-radius:var(--dsw-radius-lg,14px) var(--dsw-radius-lg,14px) 0 0;overflow:hidden}
.bt-queue-panel:before{z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu,var(--bt-main));backdrop-filter:var(--dsw-menu-backdrop-filter,none);content:"";pointer-events:none;position:absolute;inset:0}
.bt-queue-panel:after{border:.5px solid var(--bt-line-2);border-bottom:none;border-radius:inherit;content:"";pointer-events:none;position:absolute;inset:0}
.bt-queue-head{box-sizing:border-box;width:100%;height:36px;border:0;border-radius:var(--dsw-radius-md,10px);background:none;color:var(--bt-ink);text-align:left;font:inherit;cursor:pointer;display:flex;align-items:center;gap:10px;padding:4px 12px}
.bt-queue-head:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-queue-head:disabled{cursor:default}
.bt-queue-lead{color:var(--bt-ink-3);flex:none;display:grid;place-items:center}
.bt-queue-count{min-width:0;flex:auto;font-size:13px;font-weight:500;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-queue-chev{width:14px;height:14px;color:var(--bt-ink-3);flex:none;display:grid;place-items:center}
.bt-queue-list{max-height:180px;margin:0;padding:0;list-style:none;overflow-y:auto}
/* An unfolded list leaves the composer stack: it hangs above the header as its own card, so
   the conversation behind it keeps its place and only the queue moves. */
.bt-queue-panel[data-floating=true]{overflow:visible}
.bt-queue-panel[data-floating=true] .bt-queue-list{position:absolute;left:0;right:0;bottom:calc(100% + 6px);z-index:6;max-height:min(240px,32vh);padding:2px 0;border-radius:var(--dsw-radius-lg,14px);background:var(--dsw-specific-menu,var(--bt-main));backdrop-filter:var(--dsw-menu-backdrop-filter,none);border:.5px solid var(--bt-line-2);box-shadow:0 10px 28px rgba(20,22,28,.14)}
.bt-queue-panel[data-floating=true] .bt-queue-list[hidden]{display:none}
.bt-queue-row{box-sizing:border-box;min-height:36px;width:100%;border-radius:var(--dsw-radius-md,10px);display:flex;align-items:center;gap:10px;padding:4px 5px 4px 12px}
.bt-queue-row+.bt-queue-row{box-shadow:inset 0 1px 0 var(--bt-line)}
.bt-queue-attachments{flex:none;min-width:0;max-width:55%;display:flex;gap:4px;overflow:hidden}
.bt-queue-pending .bt-queue-attachments{flex-shrink:1}
.bt-queue-file{box-sizing:border-box;height:24px;min-width:74px;flex:0 180px;border:.5px solid var(--bt-line);border-radius:var(--dsw-radius-sm,6px);background:var(--bt-main);display:inline-flex;align-items:center;gap:4px;padding:0 6px;overflow:hidden}
.bt-queue-fileicon{flex:none;width:16px;height:16px;color:var(--bt-ink-3);display:inline-flex}
.bt-queue-filename{min-width:0;flex:auto;font-size:13px;line-height:18px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-queue-filesize{flex:none;font-size:10px;color:var(--bt-ink-3);white-space:nowrap}
.bt-queue-thumb{width:24px;height:24px;border:.5px solid var(--bt-line);border-radius:var(--dsw-radius-xs,4px);background:var(--bt-main);object-fit:cover}
.bt-queue-preview{min-width:0;flex:auto;font-size:13px;color:var(--bt-ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-queue-edit{min-width:0;flex:auto;box-sizing:border-box;border:0;outline:none;resize:none;background:none;color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;max-height:120px;padding:4px 0}
.bt-queue-edit-wrap{flex:auto;min-width:0;display:flex;flex-direction:column;gap:1px;padding:2px 0}
.bt-queue-edit-wrap .bt-queue-edit{width:100%;padding:0}
.bt-queue-edit-warn{font-size:11px;line-height:14px;color:var(--bt-danger)}
.bt-queue-actions{flex:none;display:flex;align-items:center;gap:10px}
.bt-queue-status{flex:none;font-size:13px;color:var(--bt-ink-3);white-space:nowrap}
.bt-queue-hint{flex:none;font-size:11px;line-height:14px;color:var(--bt-ink-2);white-space:nowrap}
.bt-queue-action{width:28px;height:28px;border:0;border-radius:999px;background:none;color:var(--bt-ink-2);cursor:pointer;display:grid;place-items:center;padding:0}
.bt-queue-action:hover:not(:disabled){background:var(--bt-hover);color:var(--bt-ink)}
.bt-queue-action:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-queue-action:disabled{cursor:default;opacity:.4;color:var(--bt-ink-3)}
`
