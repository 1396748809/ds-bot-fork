import { createElement as h, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { FishLogo } from './dsh-primitives.js'
import { TeamTodoSide } from './todo-panel.js'
import { inkFill } from './inks.js'
import { isMainOf } from './sources.js'
import { currentPart, previewOf, relativeShort } from './text.js'
import { PlusIcon, SearchIcon, SidebarIcon, GaugeIcon, ClockIcon, GearIcon, PinMarkIcon, ConnectorIcon, PlugIcon, SwitchIcon, CloudDownloadIcon, SignInIcon, SignOutIcon, SlidersIcon, ChevronRightIcon, DotsIcon, FolderIcon } from './icons.js'
import { lookOf, MAIN_LOOK } from './characters.js'
import { botState, BotMark, BotAvatar, RoomAvatar } from './mark.js'
import { onStripChange, readStripHidden, readStripMain, readStripRooms } from './strip-bar.js'
import { AgentBadge } from './agent-badge.js'
import { SidebarTaskPill, taskCountsOf } from './bot-tasks.js'
import { reducedMotion } from './activity-row.js'
import { Shimmer, workPhrase } from './cells.js'
import { SPRING_GLIDE, SPRING_POP, SPRING_SHAPE, SPRING_TAP, stepMenuFocus, useLinger, useViewport, viewBottom } from './motion.js'
import { hostText, t } from './i18n.js'
import { clientErrors } from './diagnostics.js'
import { showsDshRow } from './dsh-offer.js'
import { quietly } from './diagnostics.js'
import { frameLayout, dragColumn, RAIL_WIDTH, STRIP_H, FALLBACK_SIDEBAR_WIDTH, userSidebarToggle } from './frame-layout.js'
import { chatRoom, dshCollapsed } from './frame-watch.js'
import { STORAGE } from './storage.js'
import { useEscape } from './overlay-hooks.js'

// -------------------------------------------------------------------------
// Sidebar

// Manual "Mark as Unread" lasts until the conversation is opened again.
function useMarkedUnread(id, active, marked, actions) {
  useEffect(() => {
    if (active && marked) actions.clearUnread(id)
  }, [active, marked])
}

const PinMark = () => h('span', { className: 'bt-pin', 'aria-hidden': true }, h(PinMarkIcon))

// The rail shows a row's name only on hover; the wide list does so when the name is
// cut, which only the laid-out row can tell, so it is measured as the pointer enters.
const nameIfCut = (event) => {
  const row = event.currentTarget
  const name = row.querySelector('.bt-row-title')
  if (name && name.scrollWidth > name.clientWidth) row.title = name.textContent
  else row.removeAttribute('title')
}

// Whether an approval waits for the user: for a Bot, in its own chat; for a group,
// from any of its members in that group (both DSH tool approvals and computer-use asks).
const useApproval = (useWork, useComputer, matchApproval, matchAsk) => {
  const tool = useWork ? useWork(work => (work.approvals ?? []).some(matchApproval)) : false
  const app = useComputer ? useComputer(comp => Object.values(comp?.asks ?? {}).some(matchAsk)) : false
  return tool || app
}

// Work running in group Sessions, as "botId|tool" keys so a row redraws only when it
// changes: the groups one Bot works in, or the members at work in one group.
// Picked as text, so a row redraws only when what it shows changes.
const useGroupWork = (useWork, pick) => {
  const raw = useWork ? useWork(work => JSON.stringify(pick(work.rooms ?? {}))) : '[]'
  return useMemo(() => JSON.parse(raw), [raw])
}
const doingOf = ({ tool, said, note, target, switching }) => ({ tool, said, note, target, switching })
const workLine = (lead, doing, more) => h(Shimmer, null, `${lead} · ${workPhrase(doing)}…${more > 0 ? ` +${more}` : ''}`)
// The row already names the Bot; its own-chat preview is just what it is doing.
const doingLine = doing => h(Shimmer, null, `${workPhrase(doing)}…`)
// The Bots and groups a Bot waits for (handoffs.js), by the names they have now.
const waitingFor = (roster, waits) => {
  const names = [...(waits?.bots ?? []).map(id => roster.byId[id]?.name), ...(waits?.rooms ?? []).map(id => roster.roomsById[id]?.name)].filter(Boolean)
  return names.length === 0 ? '' : t('Waiting for {names}', { names: names.join(t(' and ')) })
}

function BotRow({ bot, roster, actions, useSessions, useSessionStatus, useSessionRetainInfo, useActivity, useWork, useComputer, wide, marked, onDragStart, chip, plain }) {
  const id = bot.id
  const part = currentPart(bot)
  const preview = useSessions(list => previewOf(list, part, roster.exchangeTurns[part]))
  const running = useSessionStatus(map => map.get(part)?.running === true)
  const active = useSessionRetainInfo(part, info => (info?.retainedBy?.mainView ?? 0) > 0)
  const unread = useSessionStatus(map => map.get(part)?.completionUnread === true || map.get(part)?.pendingInteraction !== undefined) || (marked && !active)
  useMarkedUnread(id, active, marked, actions)
  const main = isMainOf(roster, id)
  const tile = roster.mainBotId === id
  const approval = useApproval(useWork, useComputer, entry => entry.roomId === undefined && entry.botId === id, ask => ask.roomId === undefined && ask.botId === id)
  const alert = roster.questions?.[part] !== undefined || approval
  const doing = useActivity(map => map[id])
  // Work in a group runs in a Session of its own, so the Bot's chat stays idle meanwhile.
  const groups = useGroupWork(useWork, rooms => Object.entries(rooms).flatMap(([roomId, entries]) => entries.filter(entry => entry.botId === id).map(entry => ({ id: roomId, ...doingOf(entry) }))))
  const away = !running && groups.length > 0
  // Group approvals live on the group's row and header island, not on the Bot's
  // own DM avatar (#1623).
  const dmDoing = doing === 'alert' && !approval ? undefined : doing
  const state = botState(running || away, dmDoing, alert)
  // A Bot running in its own chat previews what it is doing, like a group's row.
  const runningLine = running && doing ? doingLine(doing) : null
  const awayLine = away ? workLine(roster.roomsById[groups[0].id]?.name ?? t('a group chat'), groups[0], groups.length - 1) : null
  const waitsRaw = useWork ? useWork(work => JSON.stringify(work.waiting?.[id] ?? null)) : 'null'
  const waits = useMemo(() => JSON.parse(waitsRaw), [waitsRaw])
  const waitsFor = state === 'waiting' ? waitingFor(roster, waits) : ''
  if (bot.hidden && !active && !main) return null
  const onContextMenu = (event) => {
    event.preventDefault()
    actions.openMenu({ kind: 'bot', id, x: event.clientX, y: event.clientY })
  }
  const pinned = bot.pinned === true && !tile
  const taskCounts = taskCountsOf({ bot })
  const openTasks = () => { actions.openSession(id); actions.openTaskDeck?.(id) }
  const label = [bot.name, main ? t('Main Bot') : '', pinned ? t('Pinned') : '', running || away ? t('Working') : '', taskCounts.active > 0 ? t('{count} background tasks running', { count: taskCounts.active }) : '', waitsFor, approval ? t('Waiting for your approval') : alert ? t('Waiting for your answer') : '', unread ? t('Unread activity') : ''].filter(Boolean).join(', ')
  if (tile && wide && chip) {
    // The Main Bot sits in the sidebar's own header as a small disc: the big tile spent a
    // whole card on one Bot the user opens far more often than reads, and the list below it
    // is what they came for. Its state, unread mark and task count come along unchanged.
    return h('button', {
      type: 'button', className: 'bt-main-chip', 'aria-label': label, 'aria-current': active ? 'page' : undefined,
      'data-bot-id': id, title: preview ? `${bot.name} · ${preview}` : bot.name,
      onClick: () => actions.openSession(id), onContextMenu,
    },
    h(BotAvatar, { bot, size: 32, state, main: true }),
    taskCounts.active > 0 ? h('span', { className: 'bt-main-chip-tasks', 'aria-hidden': true }, String(taskCounts.active))
      : unread && !active ? h('span', { className: 'bt-main-chip-dot', 'aria-hidden': true }) : null)
  }
  // `plain` keeps the Main Bot an ordinary row when the list pins one at its top; the tile
  // is the older presentation and has no place there.
  if (tile && wide && !plain) {
    return h('div', { className: 'bt-tile-wrap' }, h('button', {
      type: 'button', className: 'bt-tile', 'aria-label': label, 'aria-current': active ? 'page' : undefined,
      'data-bot-id': id, title: preview || bot.name, onClick: () => actions.openSession(id), onContextMenu,
    },
    h(BotAvatar, { bot, size: 60, state, main: true }),
    h('span', { className: 'bt-tile-name' }, bot.name),
    bot.role ? h('span', { className: 'bt-chip' }, bot.role) : null,
    h(SidebarTaskPill, { active: taskCounts.active, waitingApproval: taskCounts.waitingApproval, onClick: openTasks })))
  }
  return h('button', {
    type: 'button', className: 'bt-row', 'aria-label': label, 'aria-current': active ? 'page' : undefined,
    'data-bot-id': id, title: wide ? undefined : bot.name,
    draggable: wide && !tile && onDragStart ? true : undefined,
    onDragStart: wide && !tile && onDragStart ? event => onDragStart(event, id) : undefined,
    onMouseEnter: wide ? nameIfCut : undefined, onClick: () => actions.openSession(id), onContextMenu,
  },
  h(BotAvatar, { bot, size: wide ? 36 : 44, state, main }),
  pinned && !wide ? h(PinMark) : null,
  wide ? h('span', { className: 'bt-row-body' },
    h('span', { className: 'bt-row-name' }, h('span', { className: 'bt-row-title' }, bot.name), bot.engine ? h(AgentBadge, { engine: bot.engine }) : null, pinned ? h(PinMark) : null, h(SidebarTaskPill, { active: taskCounts.active, waitingApproval: taskCounts.waitingApproval, onClick: openTasks })),
    runningLine ? h('span', { className: 'bt-row-preview' }, runningLine)
      : awayLine ? h('span', { className: 'bt-row-preview' }, awayLine)
        : waitsFor ? h('span', { className: 'bt-row-preview' }, waitsFor)
          : preview ? h('span', { className: 'bt-row-preview' }, preview) : null) : null,
  wide && unread && !active ? h('span', { className: 'bt-unread', 'aria-hidden': true })
    : !wide && !active && (alert || unread) ? h('span', { className: `bt-dot${alert ? ' bt-dot-wait' : ''}`, 'aria-hidden': true }) : null)
}

function RoomRow({ room, roster, actions, useSessions, useSessionStatus, useSessionRetainInfo, useWork, useComputer, wide, marked, onDragStart }) {
  const id = room.id
  // The group's own Session is a chain of parts; the row shows the current one.
  const sessionId = room.sessionId ?? id
  const fallback = useSessions(list => previewOf(list, sessionId))
  const preview = room.preview?.replace(/\s+/g, ' ').trim() || fallback
  const active = useSessionRetainInfo(sessionId, info => (info?.retainedBy?.mainView ?? 0) > 0)
  const unread = useSessionStatus(map => map.get(sessionId)?.completionUnread === true) || (marked && !active)
  useMarkedUnread(id, active, marked, actions)
  const approval = useApproval(useWork, useComputer, entry => entry.roomId === id, ask => ask.roomId === id)
  const members = useGroupWork(useWork, rooms => (rooms[id] ?? []).filter(entry => entry.botId !== undefined).map(entry => ({ id: entry.botId, ...doingOf(entry) })))
  const first = roster.byId[members[0]?.id]
  const workingLine = first ? workLine(first.name, members[0], members.length - 1) : null
  if (room.hidden && !active) return null
  const pinned = room.pinned === true
  const taskCounts = taskCountsOf({ room, roster })
  const openTasks = () => { actions.openSession(id); actions.openTaskDeck?.(id) }
  const label = [room.name, pinned ? t('Pinned') : '', members.length > 0 ? t('Working') : '', taskCounts.active > 0 ? t('{count} background tasks running', { count: taskCounts.active }) : '', approval ? t('Waiting for your approval') : ''].filter(Boolean).join(', ')
  return h('button', {
    type: 'button', className: 'bt-row', 'aria-label': label, 'aria-current': active ? 'page' : undefined,
    'data-room-id': id, title: wide ? undefined : room.name,
    draggable: wide && onDragStart ? true : undefined,
    onDragStart: wide && onDragStart ? event => onDragStart(event, id) : undefined,
    onMouseEnter: wide ? nameIfCut : undefined, onClick: () => actions.openSession(id),
    onContextMenu: (event) => { event.preventDefault(); actions.openMenu({ kind: 'room', id, x: event.clientX, y: event.clientY }) },
  },
  h(RoomAvatar, { room, roster, size: wide ? 36 : 44 }),
  pinned && !wide ? h(PinMark) : null,
  wide ? h('span', { className: 'bt-row-body' },
    h('span', { className: 'bt-row-name' }, h('span', { className: 'bt-row-title' }, room.name), pinned ? h(PinMark) : null, h(SidebarTaskPill, { active: taskCounts.active, waitingApproval: taskCounts.waitingApproval, onClick: openTasks })),
    workingLine ? h('span', { className: 'bt-row-preview' }, workingLine) : preview ? h('span', { className: 'bt-row-preview' }, preview) : null) : null,
  wide && approval && !active ? h('span', { className: 'bt-unread bt-unread-wait', 'aria-hidden': true })
    : wide && unread && !active ? h('span', { className: 'bt-unread', 'aria-hidden': true })
      : !wide && !active && (approval || unread) ? h('span', { className: `bt-dot${approval ? ' bt-dot-wait' : ''}`, 'aria-hidden': true }) : null)
}

const agentSessionTitle = session => (session.title === '' ? t('New session') : session.title)

// One expanded DSH Agent Session row: title, relative stamp, rename field, and a
// context menu for rename/archive.
function AgentSessionRow({ session, agent, actions, renaming, index }) {
  const input = useRef(null)
  useLayoutEffect(() => {
    if (!renaming) return
    input.current?.focus()
    input.current?.select()
  }, [renaming])
  if (renaming) {
    const commit = (keep) => {
      const value = input.current?.value ?? ''
      if (!keep || value.trim() === '' || value.trim() === session.title) { actions.endAgentRename(); return }
      // The editor closes only after the rename landed; a failure keeps it open.
      void (async () => {
        try {
          await actions.renameAgentSession(agent.id, session.id, value)
          actions.endAgentRename()
        } catch (error) {
          actions.reportError(error, 'agent-rename')
        }
      })()
    }
    return h('div', { className: 'bt-agent-sub-row bt-agent-edit', style: { '--i': index } },
      h('input', {
        ref: input, defaultValue: session.title, 'aria-label': t('Rename'),
        onKeyDown: (event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Enter') commit(true)
          else if (event.key === 'Escape') commit(false)
        },
        onBlur: () => commit(true),
      }))
  }
  return h('button', {
    type: 'button', className: 'bt-agent-sub-row', 'aria-current': session.active ? 'page' : undefined, style: { '--i': index },
    onClick: () => actions.openAgentSession(session.id),
    onContextMenu: (event) => {
      event.preventDefault()
      event.stopPropagation()
      actions.openMenu({ kind: 'agent-session', id: session.id, agentId: agent.id, x: event.clientX, y: event.clientY })
    },
  },
  h('span', { className: 'bt-agent-sub-title' }, agentSessionTitle(session)),
  h('span', { className: 'bt-agent-sub-time' }, session.at > 0 ? relativeShort(session.at) : ''))
}

// The DSH Agent row: a plain dsh Session list lives in the Bot workspace, so it
// sits among the Bots with the harness's own whale mark.
function AgentRow({ agent, actions, useSessions, useSessionStatus, useUi, wide, marked, onDragStart }) {
  const info = useSessions(list => JSON.stringify(agent.sessions.map((id) => {
    const row = list.byId[id]
    return {
      id,
      // A blank Session's title is the workspace folder name; show the label instead.
      title: row?.blank === true ? '' : (row?.displayTitle ?? row?.title ?? ''),
      at: row?.updatedAt ?? 0,
      running: row?.running === true,
      active: (row?.retainedBy?.mainView ?? 0) > 0,
    }
  }).sort((a, b) => b.at - a.at)))
  const statusInfo = useSessionStatus(map => JSON.stringify(agent.sessions.map(id => ({
    id, running: map.get(id)?.running === true, unread: map.get(id)?.completionUnread === true,
  }))))
  const sessions = useMemo(() => {
    const statuses = Object.fromEntries(JSON.parse(statusInfo).map(entry => [entry.id, entry]))
    return JSON.parse(info).map(session => ({
      ...session,
      running: statuses[session.id]?.running ?? session.running,
      unread: statuses[session.id]?.unread ?? false,
    }))
  }, [info, statusInfo])
  const renaming = useUi(value => value.renameAgent)
  const active = sessions.some(session => session.active)
  const running = sessions.some(session => session.running)
  const unread = sessions.some(session => session.unread) || (marked && !active)
  useMarkedUnread(agent.id, active, marked, actions)
  const preview = sessions[0] === undefined ? t('New session') : agentSessionTitle(sessions[0])
  const label = ['DSH Agent', running ? t('Working') : '', unread ? t('Unread activity') : ''].filter(Boolean).join(', ')
  const open = active && wide
  return h('div', { className: 'bt-agent' },
    h('button', {
      type: 'button', className: 'bt-row', 'aria-label': label, 'aria-current': active ? 'page' : undefined,
      'data-agent-id': agent.id, title: wide ? undefined : 'DSH Agent',
      draggable: wide && onDragStart ? true : undefined,
      onDragStart: wide && onDragStart ? event => onDragStart(event, agent.id) : undefined,
      onClick: () => actions.openAgent(agent.id),
      onContextMenu: (event) => { event.preventDefault(); actions.openMenu({ kind: 'agent', id: agent.id, x: event.clientX, y: event.clientY }) },
    },
    h('span', { className: `bt-agent-ava${running ? ' bt-run' : ''}` }, h(FishLogo, { size: wide ? 22 : 24 })),
    wide ? h('span', { className: 'bt-row-body' },
      h('span', { className: 'bt-row-name' }, 'DSH Agent'),
      preview ? h('span', { className: 'bt-row-preview' }, preview) : null) : null,
    wide && unread && !active ? h('span', { className: 'bt-unread', 'aria-hidden': true })
      : !wide && unread && !active ? h('span', { className: 'bt-dot', 'aria-hidden': true }) : null),
    // The rail has no Session list. Left in, its text is wider than the rail, so this wrapper
    // filled the rail and the 56px row sat at its left edge instead of the centre.
    wide ? h('div', { className: 'bt-agent-sub', 'data-open': open || undefined },
      h('div', { className: 'bt-agent-sub-in' },
        h('button', { type: 'button', className: 'bt-agent-sub-row bt-agent-new', style: { '--i': 0 }, onClick: () => { void actions.newAgentSession(agent.id).catch(error => actions.reportError(error, 'agent-session')) } },
          h(PlusIcon), h('span', { className: 'bt-agent-sub-title' }, t('New session'))),
        sessions.map((session, index) => h(AgentSessionRow, {
          key: session.id, session, agent, actions, index: index + 1,
          renaming: renaming === session.id,
        })))) : null)
}

function renderSidebarEntry(entry, rowProps, markedUnread, onDragStart) {
  return entry.kind === 'bot'
    ? h(BotRow, { key: entry.item.id, ...rowProps, bot: entry.item, marked: markedUnread[entry.item.id] === true, onDragStart })
    : entry.kind === 'room'
      ? h(RoomRow, { key: entry.item.id, ...rowProps, room: entry.item, marked: markedUnread[entry.item.id] === true, onDragStart })
      : h(AgentRow, { key: entry.item.id, ...rowProps, agent: entry.item, marked: markedUnread[entry.item.id] === true, onDragStart })
}

// The faces keep whatever order the user dragged them into. Ids are the only thing saved:
// a Bot that leaves the team drops out on read, and a new one joins at the end.
const readStripOrder = () => {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(STORAGE.strip) ?? '[]')
    return Array.isArray(saved) ? saved.filter(id => typeof id === 'string') : []
  } catch {
    return []
  }
}
const writeStripOrder = (ids) => {
  try { globalThis.localStorage?.setItem(STORAGE.strip, JSON.stringify(ids)) } catch { /* storage unavailable */ }
}

// Every Bot as a face in the window's top band, in the strip the shell leaves empty
// between the column and the window buttons: a conversation is one click away without
// costing the page a row of its own.
//
// The faces part around the cursor the way a dock does — the one under the cursor grows and
// its neighbours slide aside, so nothing jumps under the pointer — and they can be dragged
// into whatever order the user wants.
function TopBotStrip({ roster, markedUnread, actions, left, useSessions, useWork }) {
  const dragId = useRef('')
  // A press opens the conversation when it stays put, and drags the face when it does not:
  // a `click` never arrives once a draggable element started a drag, so the press itself is
  // the signal.
  const pressed = useRef(null)
  // The Bot whose conversation is open keeps its face raised and on a plate, so the strip
  // says where the user is as well as offering the way to somewhere else.
  const watch = typeof useSessions === 'function' ? useSessions : null
  const shownSession = watch === null
    ? ''
    : watch(list => Object.values(list.byId ?? {}).find(session => (session?.retainedBy?.mainView ?? 0) > 0)?.id ?? '')
  const activeId = shownSession === '' || shownSession === undefined
    ? undefined
    : roster.bots.find(bot => currentPart(bot) === shownSession)?.id
  const [order, setOrder] = useState(readStripOrder)
  // Which Bots the user keeps off the strip, and which group chats the user put on it: the
  // band takes both, but a group has to be asked for, since there are usually more of them
  // than the band has room for.
  const [offStrip, setOffStrip] = useState(readStripHidden)
  const [roomIds, setRoomIds] = useState(readStripRooms)
  const [mainIds, setMainIds] = useState(readStripMain)
  useEffect(() => onStripChange(() => { setOffStrip(readStripHidden()); setRoomIds(readStripRooms()); setMainIds(readStripMain()) }), [])
  // The face under the pointer names itself just below the band, where the eye already is.
  // While it names the conversation on screen, the header's own name capsule steps aside so
  // the two do not stack on each other.
  const stripRef = useRef(null)
  const [named, setNamed] = useState(null)
  const nameFace = (event, id, entry) => {
    const box = event.currentTarget.getBoundingClientRect()
    const host = stripRef.current?.getBoundingClientRect()
    setNamed({ entry, x: box.left + box.width / 2 - (host?.left ?? 0) })
    if (typeof document !== 'undefined') {
      if (id === activeId) document.body.dataset.btStripHover = 'active'
      else delete document.body.dataset.btStripHover
    }
  }
  const clearName = () => {
    setNamed(null)
    if (typeof document !== 'undefined') delete document.body.dataset.btStripHover
  }
  // Which Bots are at work right now: a turn running in one of its Sessions, or work it
  // took on in a group (that runs in a Session of its own, so its own chat stays idle).
  // The press-mark under the face says so without opening anything.
  const partsRun = roster.partsRunning ?? {}
  const roomWorkRaw = useWork
    ? useWork(work => JSON.stringify(Object.values(work.rooms ?? {}).flatMap(entries => entries.map(entry => entry.botId)).filter(Boolean)))
    : '[]'
  const busyInRooms = useMemo(() => new Set(JSON.parse(roomWorkRaw)), [roomWorkRaw])
  const atWork = (bot) => {
    const ids = [currentPart(bot), ...(bot.openParts ?? []).map(entry => entry.sessionId)].filter(Boolean)
    return ids.some(id => partsRun[id] === true) || busyInRooms.has(bot.id)
  }
  // The Main Bot takes the same treatment as a group: it is off the band until the user puts
  // it there, and it keeps its ordinary row at the top of the list either way.
  const bots = roster.bots.filter((bot) => {
    if (bot.hidden === true) return false
    if (bot.id === roster.mainBotId) return mainIds.includes(bot.id)
    return !offStrip.includes(bot.id)
  })
  const rooms = (roster.rooms ?? []).filter(room => room.hidden !== true && roomIds.includes(room.id))
  const entries = [
    ...bots.map(bot => ({ kind: 'bot', id: bot.id, item: bot })),
    ...rooms.map(room => ({ kind: 'room', id: room.id, item: room })),
  ]
  const known = order.map(id => entries.find(entry => entry.id === id)).filter(Boolean)
  const list = [...known, ...entries.filter(entry => !order.includes(entry.id))]
  if (list.length === 0) return null
  const place = (from, to) => {
    if (from === '' || to === '' || from === to) return
    const ids = list.map(entry => entry.id)
    const next = ids.slice()
    next.splice(next.indexOf(from), 1)
    next.splice(next.indexOf(to), 0, from)
    setOrder(next)
    writeStripOrder(next)
  }
  const working = entry => (entry.kind === 'bot'
    ? atWork(entry.item)
    : partsRun[entry.item.sessionId ?? entry.id] === true)
  // One face per Bot or group on the band. A Bot wears its character, a group the cluster of
  // its members, so the band reads like the list it mirrors.
  const face = (entry, movable) => {
    const id = entry.id
    const name = entry.item.name
    const at = working(entry)
    return h('button', {
      key: id, type: 'button', className: 'bt-topstrip-btn', draggable: movable || undefined,
      // No title: the band names the face itself, at once, and two tooltips would overlap.
      'aria-label': at ? `${name}, ${t('Working')}` : name,
      'data-name': name,
      'data-id': id,
      'data-kind': entry.kind,
      'data-active': id === activeId ? 'true' : undefined,
      'data-running': at ? 'true' : undefined,
      'data-unread': markedUnread[id] === true ? 'true' : undefined,
      onMouseEnter: (event) => nameFace(event, id, entry),
      onMouseLeave: clearName,
      // The same menu the row in the list opens, from the same call: one Bot, one menu,
      // wherever the user right-clicked it.
      onContextMenu: (event) => { event.preventDefault(); pressed.current = null; actions.openMenu({ kind: entry.kind, id, from: 'strip', x: event.clientX, y: event.clientY }) },
      // Keyboard activation only: a pointer press is handled on pointerup, above.
      onClick: (event) => { if (event.detail === 0) actions.openSession(id) },
      onPointerDown: (event) => {
        // A right press opens the menu; it is not a visit, so it never counts as one.
        pressed.current = event.button === 0 ? { id, x: event.clientX, y: event.clientY } : null
      },
      onPointerUp: (event) => {
        const start = pressed.current
        pressed.current = null
        if (start === null || start.id !== id) return
        // A drag took the face somewhere else; that press is not a visit.
        if (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4) return
        actions.openSession(id)
      },
      onDragStart: movable
        ? (event) => {
            dragId.current = id
            event.dataTransfer?.setData('text/plain', id)
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
          }
        : undefined,
      onDragOver: movable ? (event) => { event.preventDefault(); if (dragId.current !== '') place(dragId.current, id) } : undefined,
      onDragEnd: movable ? () => { dragId.current = '' } : undefined,
    }, entry.kind === 'room'
      ? h(RoomAvatar, { room: entry.item, roster, size: 26 })
      : h(BotAvatar, { bot: entry.item, size: 26, state: botState(at, undefined, false), main: id === roster.mainBotId, live: false }))
  }
  return createPortal(h('div', {
    className: 'bt-topstrip', role: 'group', 'aria-label': t('Bot list'),
    ref: stripRef,
    style: { left: `${Math.max(0, left)}px` },
    onDragOver: event => event.preventDefault(),
    // The band takes no presses of its own any more, so a double-click on it never reaches
    // the window's title strip either. Kept as the guard for the faces' own row.
    onDoubleClick: (event) => { event.preventDefault(); event.stopPropagation() },
    onMouseLeave: clearName,
  },
  // The Main Bot has its own place in the sidebar's header; this row is the rest of the team.
  h('div', { className: 'bt-topstrip-row' }, list.map(entry => face(entry, true))),
  // The band's right end is where the Windows caption buttons stand. The app fills their
  // background with the colour it samples under them, and the band itself is a gradient with
  // no surface to sample, so this patch carries the ramp's end colour instead of the white
  // the frame would otherwise offer. It takes presses only where nothing of ours sits above it.
  h('div', { className: 'bt-topstrip-tint', 'aria-hidden': true }),
  // The name of the face under the pointer, hung off the bottom edge of the band, its own
  // face leading it.
  named === null ? null : h('span', { className: 'bt-topstrip-name', style: { left: `${named.x}px` } },
    h('span', { className: 'bt-topstrip-name-mark', 'aria-hidden': true },
      named.entry.kind === 'room'
        ? h(RoomAvatar, { room: named.entry.item, roster, size: 24 })
        : h(BotMark, { bot: named.entry.item, size: 24 })),
    named.entry.item.name)), document.body)
}

function SectionBlock({ section, entries, rowProps, markedUnread, renaming, dropTarget, onDragStart, onDragOverSec, onDropSec, secDrag, secOver, onSecDragStart, onSecDragOver, onSecDrop, onSecDragEnd }) {
  const { roster, actions, useSessions, useSessionStatus, useWork, useComputer, wide } = rowProps
  const input = useRef(null)
  // The click folds the section at once and the file is written behind it: waiting for the
  // host to answer and come back through the roster made every toggle feel like a pause.
  // The wish drops away as soon as the section arrives carrying it.
  const [wish, setWish] = useState(null)
  const collapsed = wish === null ? section.collapsed : wish
  useEffect(() => {
    if (wish !== null && section.collapsed === wish) setWish(null)
  }, [section.collapsed, wish])
  useLayoutEffect(() => {
    if (!renaming) return
    input.current?.focus()
    input.current?.select()
  }, [renaming])
  const visibleEntries = entries.filter(entry => !entry.item.hidden || (entry.kind === 'bot' && isMainOf(roster, entry.item.id)))
  const botsInSec = useMemo(() => {
    const seen = new Set()
    const list = []
    for (const entry of visibleEntries) {
      if (entry.kind === 'bot') {
        if (!seen.has(entry.item.id)) { seen.add(entry.item.id); list.push(entry.item) }
      } else if (entry.kind === 'room') {
        for (const memberId of entry.item.members ?? []) {
          const bot = roster.byId[memberId]
          if (bot && !seen.has(bot.id)) { seen.add(bot.id); list.push(bot) }
        }
      }
    }
    return list
  }, [visibleEntries, roster.byId])
  const sessionIds = useMemo(() => entries.flatMap(entry => (
    entry.kind === 'bot' ? [currentPart(entry.item)]
      : entry.kind === 'room' ? [entry.item.sessionId ?? entry.item.id]
        : entry.item.sessions ?? []
  )), [entries])
  const activeSession = useSessions(list => sessionIds.find(id => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0) ?? '')
  const activeEntry = useMemo(() => {
    if (activeSession === '') return undefined
    return entries.find(entry => (
      entry.kind === 'bot' ? currentPart(entry.item) === activeSession
        : entry.kind === 'room' ? (entry.item.sessionId ?? entry.item.id) === activeSession
          : (entry.item.sessions ?? []).includes(activeSession)
    ))
  }, [entries, activeSession])
  const statusBits = useSessionStatus(map => JSON.stringify(sessionIds.map(id => [
    id,
    map.get(id)?.running === true ? 1 : 0,
    map.get(id)?.completionUnread === true || map.get(id)?.pendingInteraction !== undefined ? 1 : 0,
  ])))
  const workBits = useWork ? useWork(work => {
    const botIds = new Set(entries.filter(e => e.kind === 'bot').map(e => e.item.id))
    const roomIds = new Set(entries.filter(e => e.kind === 'room').map(e => e.item.id))
    const approval = (work.approvals ?? []).some(a => (a.roomId === undefined && botIds.has(a.botId)) || roomIds.has(a.roomId))
    const roomWorking = Object.entries(work.rooms ?? {}).some(([rId, list]) => (
      (roomIds.has(rId) && list.some(e => e.botId !== undefined)) || list.some(e => botIds.has(e.botId))
    ))
    return `${approval ? 1 : 0}|${roomWorking ? 1 : 0}`
  }) : '0|0'
  const hasComputerAsk = useComputer ? useComputer(comp => {
    const botIds = new Set(entries.filter(e => e.kind === 'bot').map(e => e.item.id))
    const roomIds = new Set(entries.filter(e => e.kind === 'room').map(e => e.item.id))
    return Object.values(comp?.asks ?? {}).some(ask => (ask.roomId === undefined && botIds.has(ask.botId)) || roomIds.has(ask.roomId))
  }) : false
  const parsedStatuses = JSON.parse(statusBits)
  const [hasApproval, hasRoomWork] = workBits.split('|').map(v => v === '1')
  const hasQuestion = entries.some(entry => entry.kind === 'bot' && roster.questions?.[currentPart(entry.item)] !== undefined)
  const hasAlert = hasQuestion || hasApproval || hasComputerAsk
  const hasWorking = hasRoomWork || parsedStatuses.some(([, run]) => run === 1)
  const hasUnread = parsedStatuses.some(([id, , unread]) => unread === 1 && id !== activeSession)
    || entries.some(entry => markedUnread[entry.item.id] === true && entry !== activeEntry)
  const statusKind = hasAlert ? 'alert' : hasWorking ? 'working' : hasUnread ? 'unread' : null
  const toggle = () => {
    const next = !collapsed
    setWish(next)
    void Promise.resolve(actions.saveSection({ id: section.id, collapsed: next }))
      .catch((error) => { setWish(null); actions.reportError(error, 'section') })
  }
  const openSecMenu = (kind, x, y) => actions.openMenu({ kind, id: section.id, x, y })
  if (!wide) {
    if (collapsed) {
      const folderRoom = { id: section.id, name: section.name, members: botsInSec.map(bot => bot.id) }
      return h('div', { className: 'bt-rail-sec', 'data-sec-id': section.id },
        h('div', { className: 'bt-rail-sec-div', title: section.name, onClick: toggle },
          h('span', { className: 'bt-rail-sec-pill', style: section.color ? { background: inkFill(section.color) } : undefined })),
        h('button', {
          type: 'button', className: 'bt-rail-folder', 'aria-label': section.name, title: `${section.name} (${visibleEntries.length})`,
          'aria-current': activeEntry ? 'page' : undefined,
          onClick: toggle,
          onContextMenu: (event) => { event.preventDefault(); openSecMenu('section', event.clientX, event.clientY) },
        },
        botsInSec.length > 0 ? h(RoomAvatar, { room: folderRoom, roster, size: 38 }) : h(FolderIcon),
        statusKind ? h('span', { className: `bt-dot${statusKind === 'alert' ? ' bt-dot-wait' : ''}`, style: statusKind === 'working' ? { background: 'var(--bt-green)' } : undefined, 'aria-hidden': true }) : null))
    }
    return h(Fragment, null,
      h('div', { className: 'bt-rail-sec-div', 'data-sec-id': section.id, title: section.name, onClick: toggle },
        h('span', { className: 'bt-rail-sec-pill', style: section.color ? { background: inkFill(section.color) } : undefined })),
      entries.map(entry => renderSidebarEntry(entry, rowProps, markedUnread)))
  }
  const commitRename = (keep) => {
    const value = input.current?.value ?? ''
    actions.endSectionRename()
    if (!keep || value.trim() === '' || value.trim() === section.name) return
    void Promise.resolve(actions.saveSection({ id: section.id, name: value.trim() })).catch(error => actions.reportError(error, 'section-rename'))
  }
  return h('div', {
    className: 'bt-sec',
    'data-sec-id': section.id,
    'data-collapsed': collapsed ? 'true' : 'false',
    'data-drop': dropTarget === section.id ? 'true' : undefined,
    // A section being dragged, and the edge the one under the pointer would put it on.
    'data-sec-dragging': secDrag === section.id ? 'true' : undefined,
    'data-sec-drop': secOver?.id === section.id ? (secOver.after ? 'after' : 'before') : undefined,
    onDragOver: (event) => { if (secDrag) onSecDragOver?.(event, section.id); else onDragOverSec?.(event, section.id) },
    onDrop: (event) => { if (secDrag) onSecDrop?.(event, section.id); else onDropSec?.(event, section.id) },
  },
  renaming
    ? h('div', { className: 'bt-sec-edit' },
        h('input', {
          ref: input, defaultValue: section.name, maxLength: 32, 'aria-label': t('Rename section'),
          onKeyDown: (event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') commitRename(true)
            else if (event.key === 'Escape') commitRename(false)
          },
          onBlur: () => commitRename(true),
        }))
    : h('div', { className: 'bt-sec-head-wrap' },
        h('button', {
          type: 'button', className: 'bt-sec-head', 'aria-expanded': !collapsed,
          draggable: true,
          onDragStart: (event) => { event.stopPropagation(); onSecDragStart?.(event, section.id) },
          onDragEnd: () => onSecDragEnd?.(),
          onClick: toggle,
          onDoubleClick: (event) => { event.stopPropagation(); actions.beginSectionRename(section.id) },
          onContextMenu: (event) => { event.preventDefault(); event.stopPropagation(); openSecMenu('section', event.clientX, event.clientY) },
        },
        h('span', { className: 'bt-sec-chev', 'aria-hidden': true }, h(ChevronRightIcon)),
        section.color ? h('span', { className: 'bt-sec-dot', style: { background: inkFill(section.color) }, 'aria-hidden': true }) : null,
        h('span', { className: 'bt-sec-title' }, section.name),
        h('span', { className: `bt-sec-count${!collapsed ? ' bt-sec-count-hide' : ''}` }, visibleEntries.length),
        h('span', { className: 'bt-sec-tail' },
          collapsed && botsInSec.length > 0
            ? h('span', { className: 'bt-sec-pile', 'aria-hidden': true },
                botsInSec.slice(0, 3).map(bot => h('span', { key: bot.id, className: 'bt-sec-pile-item' }, h(BotMark, { bot, size: 18 }))),
                botsInSec.length > 3 ? h('span', { className: 'bt-sec-pile-more' }, `+${botsInSec.length - 3}`) : null)
            : null,
          collapsed && statusKind
            ? h('span', { className: 'bt-sec-status', 'data-kind': statusKind, 'aria-hidden': true }, statusKind === 'alert' ? '?' : null)
            : null)),
        h('span', { className: 'bt-sec-acts' },
          h('button', {
            type: 'button', className: 'bt-sec-act', 'aria-label': t('Add to {name}', { name: section.name }), title: t('Add to {name}', { name: section.name }),
            onClick: (event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              openSecMenu('section-add', rect.left, rect.bottom + 4)
            },
          }, h(PlusIcon)),
          h('button', {
            type: 'button', className: 'bt-sec-act', 'aria-label': t('{name} actions', { name: section.name }), title: t('{name} actions', { name: section.name }),
            onClick: (event) => {
              event.stopPropagation()
              const rect = event.currentTarget.getBoundingClientRect()
              openSecMenu('section', rect.left, rect.bottom + 4)
            },
          }, h(DotsIcon)))),
  h('div', {
    className: 'bt-sec-body',
    inert: collapsed ? true : undefined,
    'aria-hidden': collapsed ? true : undefined,
  },
    h('div', { className: 'bt-sec-body-in' },
      entries.map(entry => renderSidebarEntry(entry, rowProps, markedUnread, onDragStart)))))
}

// Bots that belong to no section still form one group of their own, called "Ungrouped": the
// list never mixes loose rows with grouped ones, the header folds like any other, and a row
// dropped on it leaves its section. A Bot created without a section is born here, which is
// what makes the newest Bot easy to find. The fold is remembered, since a section's own fold
// lives in the roster file and this one has no entry of its own there.
const UNGROUPED_KEY = 'ds-bot:ungrouped-collapsed'
function ungroupedFolded() {
  try {
    return globalThis.localStorage?.getItem(UNGROUPED_KEY) === '1'
  } catch {
    return false
  }
}

// The rows arrive as children, built by the list itself like every other row: the block only
// owns the header, its fold, and the drop target.
function UngroupedBlock({ entries, children, dropTarget, onDragOverSec, onDropSec }) {
  const [collapsed, setCollapsed] = useState(ungroupedFolded())
  const name = t('Ungrouped')
  const toggle = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      globalThis.localStorage?.setItem(UNGROUPED_KEY, next ? '1' : '0')
    } catch {
      // A window that refuses storage folds for this visit only.
    }
  }
  return h('div', {
    className: 'bt-sec bt-sec-ungrouped',
    'data-ungrouped': 'true',
    'data-collapsed': collapsed ? 'true' : 'false',
    'data-drop': dropTarget === '__none__' ? 'true' : undefined,
    onDragOver: event => onDragOverSec?.(event, '__none__'),
    onDrop: event => onDropSec?.(event, null),
  },
  h('div', { className: 'bt-sec-head-wrap' },
    h('button', {
      type: 'button', className: 'bt-sec-head', 'aria-expanded': !collapsed, title: name,
      onClick: toggle,
    },
    h('span', { className: 'bt-sec-chev', 'aria-hidden': true }, h(ChevronRightIcon)),
    h('span', { className: 'bt-sec-title' }, name),
    h('span', { className: `bt-sec-count${!collapsed ? ' bt-sec-count-hide' : ''}` }, entries.length),
    h('span', { className: 'bt-sec-tail' },
      collapsed && entries.length > 0
        ? h('span', { className: 'bt-sec-pile', 'aria-hidden': true },
            entries.slice(0, 3).map(entry => h('span', { key: entry.item.id, className: 'bt-sec-pile-item' }, h(BotMark, { bot: entry.item, size: 18 }))),
            entries.length > 3 ? h('span', { className: 'bt-sec-pile-more' }, `+${entries.length - 3}`) : null)
        : null))),
  h('div', {
    className: 'bt-sec-body',
    inert: collapsed ? true : undefined,
    'aria-hidden': collapsed ? true : undefined,
  },
    h('div', { className: 'bt-sec-body-in' }, children)))
}

// The pinned Main Bot row sits right above the list, so while rows are still scrolled away
// under it the boundary needs an edge: it takes a shadow, and drops it again once the list is
// back at its top. The rows themselves are no longer faded at either edge — a mask there left
// a see-through band over the first row while scrolling, which read as a hole in the column.
function useEdgeFade(listRef) {
  useEffect(() => {
    const list = listRef.current
    if (!list) return undefined
    const paint = () => {
      const overTop = list.scrollTop > 1
      // The pinned row sits right above the list.
      const pin = list.previousElementSibling
      if (pin?.classList?.contains('bt-list-pin')) {
        if (overTop) pin.dataset.shadow = ''
        else delete pin.dataset.shadow
      }
    }
    paint()
    list.addEventListener('scroll', paint, { passive: true })
    // Rows come and go without the list itself resizing, so every child is watched too.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(paint) : null
    if (observer) {
      observer.observe(list)
      for (const child of Array.from(list.children)) observer.observe(child)
    }
    return () => {
      list.removeEventListener('scroll', paint)
      if (observer) observer.disconnect()
    }
  })
}

function useListGlide(listRef, layout, key) {
  const tops = useRef({ layout, map: new Map() })
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const next = new Map()
    const still = reducedMotion() || tops.current.layout !== layout
    for (const row of list.querySelectorAll('[data-bot-id],[data-room-id],[data-agent-id],[data-sec-id]')) {
      if (row.closest?.('[aria-hidden="true"]')) continue
      const id = row.dataset.secId ? `sec:${row.dataset.secId}` : (row.dataset.botId ?? row.dataset.roomId ?? row.dataset.agentId)
      // offsetTop ignores transforms, so a glide in flight does not skew the next one.
      const top = row.offsetTop
      next.set(id, top)
      const before = tops.current.map.get(id)
      if (!still && before !== undefined && Math.abs(before - top) > 0.5) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], SPRING_GLIDE)
      }
    }
    tops.current = { layout, map: next }
  }, [layout, key])
}

// In the Bot view the left column is ours, drawn on <body> over the shell's
// collapsed sidebar: the open column or the avatar rail push the conversation
// over, the drawer floats above it. Its right edge drags the open width, and
// down to the rail.
// The window's top bar: the column's title row hoisted out of the column, so it sits on the
// window's own edge and never slides with the column. A host without a document (or without a
// portal in its renderer) simply keeps the row in the column.
function WindowBar({ children }) {
  if (typeof document === 'undefined' || typeof createPortal !== 'function') return null
  return createPortal(h('div', { className: 'bt-topbar' },
    children,
    // The window's caption buttons sit at this bar's right end, and the app fills their background
    // with the colour it samples there. This sliver is what it can sample: the measured point is
    // the window's top-right corner, and the bar itself is click-through and so invisible to that
    // sampling. Narrow enough that it takes no press worth having.
    h('div', { className: 'bt-topbar-tint', 'aria-hidden': true })), document.body)
}

function LeftColumn({ mode, width, onGrip, leaving, topbar, children }) {
  return createPortal(h('div', { className: 'bt-leftcol', 'data-left': mode, 'data-topbar': topbar ? '' : undefined, 'data-leaving': leaving || undefined, 'aria-hidden': leaving || undefined, style: { width: `${width}px` } },
    children,
    h('div', { className: 'bt-leftcol-grip', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': t('Resize sidebar'), title: t('Resize sidebar'), onPointerDown: onGrip })), document.body)
}

// The top-left switch hides the whole column and brings it back. Under a
// Windows title bar it takes the shell's own place in the title band; elsewhere
// it shows only while the column is hidden, since the column's own top row
// carries it otherwise.
function TitleToggle({ hidden, onToggle }) {
  if (typeof document === 'undefined') return null
  // Only while the column is out of sight: open, its own top row carries the switch, in
  // line with the folder, search and new buttons.
  if (!hidden) return null
  const titlebar = document.documentElement.hasAttribute('data-windows-titlebar')
  const label = t(hidden ? 'Expand sidebar' : 'Collapse sidebar')
  return createPortal(h('button', {
    type: 'button', className: titlebar ? 'bt-title-toggle' : 'bt-round bt-title-toggle', 'aria-label': label, title: label, onClick: onToggle,
  }, h(SidebarIcon)), document.body)
}

// The Bot-API-down hint cannot send the user to Settings → Feedback: its
// diagnostics request needs the same API. What still works in this state is
// the last error this window recorded, and the engine's own startup output —
// its console, or the app's startup error box (#516). With no Bot team there is
// nothing to use on this surface, so the hint also offers the classic view.
const bootHint = () => {
  const last = clientErrors().at(-1)?.text
  return last === undefined
    ? t('The Bot team could not start. The engine’s startup output — its console, or the app’s startup error box — has the cause.')
    : t('The Bot team could not start. {error}. The engine’s startup output — its console, or the app’s startup error box — has the cause.', { error: last })
}

function BootFailed({ actions }) {
  return h('div', { className: 'bt-hint bt-boot-failed', role: 'alert' },
    h('div', null, bootHint()),
    typeof actions.setSurface === 'function'
      ? h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: () => actions.setSurface('agent') }, t('Switch to classic Agent mode'))
      : null)
}

// The to-do block's height belongs to the user: drag the line under it to give the Bot list
// more room or the to-do list more, and the height is kept for the next window. The value
// rides a CSS variable, so the block itself stays the one that owns its layout.
const BLOCK_HEIGHT_KEY = 'ds-bot:side-block-h'
const BLOCK_HEIGHT_MIN = 96
const BLOCK_HEIGHT_DEFAULT = 220
// Never so tall that the Bot list has nowhere left to live.
const blockHeightMax = () => Math.max(BLOCK_HEIGHT_MIN + 80, (typeof window === 'undefined' ? 800 : window.innerHeight) - 320)

function readBlockHeight() {
  if (typeof localStorage === 'undefined') return BLOCK_HEIGHT_DEFAULT
  try {
    const saved = Number(localStorage.getItem(BLOCK_HEIGHT_KEY))
    if (!Number.isFinite(saved) || saved <= 0) return BLOCK_HEIGHT_DEFAULT
    return Math.min(Math.max(Math.round(saved), BLOCK_HEIGHT_MIN), blockHeightMax())
  } catch {
    // A window that refuses storage just keeps the height for this session.
    return BLOCK_HEIGHT_DEFAULT
  }
}

function saveBlockHeight(value) {
  try {
    localStorage.setItem(BLOCK_HEIGHT_KEY, String(Math.round(value)))
  } catch {
    /* nothing to keep it in */
  }
}

function SideBlockResizer({ children }) {
  const [height, setHeight] = useState(readBlockHeight())
  const [dragging, setDragging] = useState(false)
  // The drag reads the live height from a ref: the pointer handler is bound once, while
  // every move re-renders with a newer height.
  const live = useRef(height)
  live.current = height
  const clamp = value => Math.min(Math.max(Math.round(value), BLOCK_HEIGHT_MIN), blockHeightMax())
  const apply = (value) => {
    const next = clamp(value)
    setHeight(next)
    return next
  }
  const onDown = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const startY = event.clientY
    const startHeight = live.current
    setDragging(true)
    const onMove = (move) => { live.current = apply(startHeight + (move.clientY - startY)) }
    const onUp = () => {
      setDragging(false)
      saveBlockHeight(live.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  const onKey = (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      saveBlockHeight(live.current + (event.key === 'ArrowUp' ? -16 : 16))
      apply(live.current + (event.key === 'ArrowUp' ? -16 : 16))
    } else if (event.key === 'Home') {
      event.preventDefault()
      saveBlockHeight(BLOCK_HEIGHT_DEFAULT)
      apply(BLOCK_HEIGHT_DEFAULT)
    }
  }
  return h('div', {
    className: 'bt-side-resize', 'data-dragging': dragging ? '' : undefined,
    style: { '--bt-side-block-h': `${height}px` },
  },
  children,
  h('div', {
    className: 'bt-side-grip', role: 'separator', 'aria-orientation': 'horizontal',
    'aria-label': t('Resize the to-do area'), 'aria-valuenow': height, tabIndex: 0,
    onPointerDown: onDown, onKeyDown: onKey,
  }))
}

export function TeamSidebar(props) {
  const { wide, useRoster, useUi, useSessions, actions } = props
  const listRef = useRef(null)
  const roster = useRoster(value => value)
  const markedUnread = useUi(value => value.unread)
  const leftDrawer = useUi(value => value.leftDrawer === true)
  const details = useUi(value => value.details ?? null)
  const view = useUi(value => value.view ?? 'details')
  const panelYield = useUi(value => value.panelYield === true)
  const bootFailed = useUi(value => value.bootFailed === true)
  const renameSection = useUi(value => value.renameSection)
  props.useRegistry(value => value)
  const frameSnap = props.useFrame ? props.useFrame(value => value) : { viewport: typeof window === 'undefined' ? 0 : window.innerWidth, sidebarWidth: FALLBACK_SIDEBAR_WIDTH, collapsedWidth: 0 }
  const pref = props.useSidebarPref ? props.useSidebarPref(value => value) : 'open'
  const layout = frameLayout({
    viewport: frameSnap.viewport, sidebarWidth: frameSnap.sidebarWidth,
    pref, drawer: leftDrawer,
    panel: details ? { view, yielded: panelYield } : null,
  })
  // A drag of the column's edge shows where it would land, live.
  const [drag, setDrag] = useState(null)
  const mode = drag?.left ?? layout.left
  // A hidden column stays mounted for its slide out; `shown` is the mode it last had.
  const [held, leaving] = useLinger(mode === 'hidden' ? null : mode, SPRING_SHAPE.duration)
  const shown = held ?? mode
  const wideContent = shown !== 'rail'
  // No column, no band. While the column is hidden the strip has nothing to hang from, and
  // left where it fell it spanned the whole window top — on top of the very switch that
  // brings the column back, so the sidebar could not be restored.
  const stripOn = wideContent && shown !== 'hidden'
  const updated = useSessions(list => {
    const stamps = {}
    for (const id of list.ids) stamps[id] = list.byId[id]?.updatedAt ?? 0
    return JSON.stringify(stamps)
  })
  // A row dropped into a section moves there at once, and the file is written behind it:
  // waiting for the roster to come back carried made every drop feel like a pause. The wish
  // drops away as soon as the roster arrives with the row in that section.
  const [moveWish, setMoveWish] = useState(null)
  const order = useMemo(() => {
    const stamps = JSON.parse(updated)
    const entries = [
      ...roster.bots.filter(bot => bot.id !== roster.mainBotId).map(bot => ({ kind: 'bot', item: bot, at: stamps[currentPart(bot)] ?? bot.createdAt })),
      ...roster.rooms.map(room => ({ kind: 'room', item: room, at: stamps[currentPart(room)] ?? room.createdAt })),
      // The Agent sorts by its most recent Session, falling back to when it was added.
      ...(roster.agents ?? []).map(agent => ({ kind: 'agent', item: agent, at: Math.max(0, ...agent.sessions.map(id => stamps[id] ?? 0)) || agent.createdAt })),
    ]
    const sorted = entries.sort((a, b) => Number(Boolean(b.item.pinned)) - Number(Boolean(a.item.pinned)) || b.at - a.at)
    if (moveWish === null) return sorted
    return sorted.map(entry => (
      entry.item.id === moveWish.id ? { ...entry, item: { ...entry.item, sectionId: moveWish.sectionId } } : entry
    ))
  }, [roster, updated, moveWish])
  useEffect(() => {
    if (moveWish === null) return
    const entry = roster.byId[moveWish.id] ?? roster.roomsById?.[moveWish.id]
    if (entry !== undefined && (entry.sectionId ?? null) === (moveWish.sectionId ?? null)) setMoveWish(null)
  }, [moveWish, roster])
  // Dragging a section puts it where it was dropped at once, and the file is written behind
  // it: waiting for the order to come back through the roster made every drop feel like a
  // pause. The wish drops away as soon as the roster arrives carrying that order.
  const [sectionWish, setSectionWish] = useState(null)
  const sections = useMemo(() => {
    const stored = roster.sections ?? []
    if (sectionWish === null) return stored
    const byId = new Map(stored.map(sec => [sec.id, sec]))
    const moved = sectionWish.map(id => byId.get(id)).filter(Boolean)
    const rest = stored.filter(sec => !sectionWish.includes(sec.id))
    return [...moved, ...rest]
  }, [roster.sections, sectionWish])
  useEffect(() => {
    if (sectionWish === null) return
    const stored = (roster.sections ?? []).map(sec => sec.id)
    if (stored.length === sectionWish.length && stored.every((id, index) => id === sectionWish[index])) setSectionWish(null)
  }, [sectionWish, roster.sections])
  const sectionSet = useMemo(() => new Set(sections.map(sec => sec.id)), [sections])
  const ungrouped = useMemo(
    () => order.filter(entry => !entry.item.sectionId || !sectionSet.has(entry.item.sectionId)),
    [order, sectionSet],
  )
  const main = roster.byId[roster.mainBotId]
  // The key watches which sections exist and where the rows sit, not whether a section is
  // open: a fold changes the height on its own, and gliding every row below it at the same
  // time made the fold look and feel stuck.
  const glideKey = useMemo(
    () => `${sections.map(s => s.id).join(',')}|${order.map(entry => `${entry.item.id}:${entry.item.sectionId ?? ''}`).join(',')}`,
    [sections, order],
  )
  useListGlide(listRef, wideContent, glideKey)
  useEdgeFade(listRef)
  useLandOnMainBot(roster, useSessions, actions)
  useReportReady(roster.ready, roster)
  const [dragId, setDragId] = useState(null)
  const [dropTarget, setDropTarget] = useState(null)
  // A to-do item names the Bot it came from and the moment it was added. The name is matched
  // exactly: "Chief自测" is a label, not a Bot, and must not open Chief. The moment is the
  // row's address inside that chat — every message carries the time it happened, so the
  // newest message at or before that moment is where the item was raised.
  const scrollChatTo = (at) => {
    const target = Date.parse(String(at ?? ''))
    if (typeof document === 'undefined' || !Number.isFinite(target)) return
    let tries = 0
    const attempt = () => {
      tries += 1
      const scroller = document.querySelector('[data-conversation-scroll]')
      const rows = scroller === null ? [] : [...scroller.querySelectorAll('[data-time]')]
        .map(node => ({ node, time: Number(node.getAttribute('data-time')) }))
        .filter(row => Number.isFinite(row.time))
        .sort((left, right) => left.time - right.time)
      // The chat paints after the session opens, and its earlier parts can arrive later still.
      if (rows.length === 0) {
        if (tries < 14) setTimeout(attempt, 120)
        return
      }
      // The last row before the moment; when the item predates everything loaded, the first
      // row is nearer the truth than the bottom of the page.
      const before = rows.filter(row => row.time <= target)
      const pick = before.length > 0 ? before[before.length - 1] : rows[0]
      pick.node.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // Marked for a moment so the eye finds the row it was sent to rather than a wall of text.
      pick.node.style.transition = 'outline-color .3s ease'
      pick.node.style.outline = '2px solid var(--bt-accent)'
      pick.node.style.outlineOffset = '4px'
      pick.node.style.borderRadius = '8px'
      setTimeout(() => {
        pick.node.style.outline = 'transparent'
        pick.node.style.outlineOffset = ''
        pick.node.style.borderRadius = ''
      }, 1800)
    }
    setTimeout(attempt, 90)
  }
  const openFromTodo = (name, probe, at) => {
    const bot = roster.bots.find(candidate => candidate.name === name)
    if (bot === undefined) return false
    if (probe !== true) {
      actions.openSession(bot.id)
      scrollChatTo(at)
    }
    return true
  }
  const onDragStart = (event, id) => {
    setDragId(id)
    event.dataTransfer?.setData?.('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
  // Sections move the same way their rows do: the header is the handle, and the block it is
  // dropped over says whether it lands above or below, by which half the pointer is in.
  const [secDrag, setSecDrag] = useState(null)
  const [secOver, setSecOver] = useState(null)
  const onSecDragStart = (event, id) => {
    setSecDrag(id)
    setDragId(null)
    setDropTarget(null)
    event.dataTransfer?.setData?.('text/plain', `section:${id}`)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }
  const onSecDragOver = (event, id) => {
    if (!secDrag || secDrag === id) return
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > box.top + box.height / 2
    setSecOver(previous => (previous?.id === id && previous?.after === after ? previous : { id, after }))
  }
  const onSecDrop = (event, id) => {
    if (!secDrag) return
    event.preventDefault()
    const moving = secDrag
    const after = secOver?.id === id ? secOver.after : false
    setSecDrag(null)
    setSecOver(null)
    if (moving === id) return
    const ids = sections.map(sec => sec.id).filter(one => one !== moving)
    const at = ids.indexOf(id)
    ids.splice(at < 0 ? ids.length : at + (after ? 1 : 0), 0, moving)
    setSectionWish(ids)
    void Promise.resolve(actions.reorderSections(ids)).catch((error) => {
      // The order did not take, so the rows go back to the one the roster still holds.
      setSectionWish(null)
      actions.reportError(error, 'section-order')
    })
  }
  const onSecDragEnd = () => { setSecDrag(null); setSecOver(null) }
  const onDragOverSec = (event, secId) => {
    if (!dragId) return
    event.preventDefault()
    if (dropTarget !== secId) setDropTarget(secId)
  }
  const onDropSec = (event, secId) => {
    event.preventDefault()
    const id = dragId
    setDragId(null)
    setDropTarget(null)
    if (!id) return
    setMoveWish({ id, sectionId: secId ?? null })
    void Promise.resolve(actions.setFlags(id, { sectionId: secId })).catch((error) => {
      // The move did not take: the row goes back where the roster still has it.
      setMoveWish(null)
      actions.reportError(error, 'section')
    })
    if (secId && sections.find(s => s.id === secId)?.collapsed) {
      void Promise.resolve(actions.saveSection({ id: secId, collapsed: false })).catch(() => {})
    }
  }
  const createNewSection = () => {
    void Promise.resolve(actions.saveSection({}))
      .then((sec) => { if (sec?.id) actions.beginSectionRename(sec.id) })
      .catch(error => actions.reportError(error, 'section'))
  }

  // Our column pushes the conversation over by what it takes beyond the shell's
  // collapsed track; a drawer floats over the rail's place, so it pushes as much
  // as the rail and the chat stays put when it opens or closes.
  const openWidth = drag?.width ?? frameSnap.sidebarWidth
  const ourWidth = shown === 'rail' ? RAIL_WIDTH : openWidth
  const pushed = mode === 'open' ? openWidth : mode === 'hidden' ? 0 : RAIL_WIDTH
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    chatRoom.setLeft(Math.max(0, pushed - (frameSnap.collapsedWidth ?? 0)))
  }, [pushed, frameSnap.collapsedWidth])
  // The Bot strip takes a band of its own above the conversation rather than floating over
  // it: the room is padding on the shell's column, so the header and the first message sit
  // below the faces instead of under them.
  useLayoutEffect(() => {
    if (typeof document === 'undefined') return
    chatRoom.setTop(stripOn ? STRIP_H : null)
  }, [stripOn])
  useEffect(() => () => {
    if (typeof document === 'undefined') return
    chatRoom.setLeft(null)
    chatRoom.setTop(null)
  }, [])

  // The edge drag: live while the pointer moves, the column's new state on release.
  // Per frame the drag writes the column's own inline style and each conversation
  // column's inline margin — the same path the panel's resize takes — so nothing
  // re-renders or restyles the chat while the pointer moves. A render only happens
  // when the drag crosses the rail's snap line, and the spring (`data-folding`)
  // rides that switch alone: it comes off when the switch settles, so a drag that
  // keeps going afterwards follows the cursor frame by frame again.
  const settleTimer = useRef(0)
  const springTimer = useRef(0)
  const startDrag = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    clearTimeout(settleTimer.current)
    clearTimeout(springTimer.current)
    const grip = event.currentTarget
    const column = grip.parentElement
    // A re-grab can land while a previous spring still stands: the new drag owns
    // the column from here, so its fold state starts clean.
    delete column.dataset.folding
    grip.setPointerCapture?.(event.pointerId)
    chatRoom.hold(true)
    const columns = chatRoom.columns()
    for (const col of columns) col.style.setProperty('transition', 'none', 'important')
    const panes = [...document.querySelectorAll('.bt-pane')]
    const offLeft = frameSnap.collapsedWidth ?? 0
    let last = null
    let liveLeft = mode
    let done = false
    const write = (at) => {
      const width = at.left === 'rail' ? RAIL_WIDTH : at.width
      column.style.width = `${width}px`
      column.style.setProperty('--bt-lc-w', `${width}px`)
      const occupied = at.left === 'open' ? width : RAIL_WIDTH
      const push = Math.max(0, occupied - offLeft)
      for (const col of columns) col.style.setProperty('margin-left', `${push}px`, 'important')
      for (const pane of panes) pane.style.left = `${occupied}px`
    }
    // A snap crossing arms the spring for the switch's glide; the timer takes it
    // back off once the switch has had its duration.
    let springUntil = 0
    const springOff = () => {
      springUntil = 0
      delete column.dataset.folding
      for (const col of columns) col.style.setProperty('transition', 'none', 'important')
    }
    const springOn = () => {
      column.dataset.folding = ''
      for (const col of columns) col.style.setProperty('transition', `margin-left ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}`, 'important')
      springUntil = performance.now() + SPRING_SHAPE.duration
      clearTimeout(springTimer.current)
      springTimer.current = setTimeout(springOff, SPRING_SHAPE.duration)
    }
    const track = (x) => {
      last = dragColumn(x, window.innerWidth)
      if (last.left !== liveLeft) {
        liveLeft = last.left
        if (!reducedMotion()) springOn()
        setDrag(last)
      }
      write(last)
    }
    const onMove = (move) => track(move.clientX)
    // The rules and props take the landed geometry back over; while the fold's
    // spring still runs this waits it out so the landing does not snap. The
    // inline `width` stays: it is the landed geometry, and React writes its width
    // prop only when the value changes, so removing it would leave the edge at
    // its CSS fallback (57px on the rail).
    const finish = () => {
      clearTimeout(springTimer.current)
      if (column.isConnected && last !== null) chatRoom.setLeft(Math.max(0, (last.left === 'open' ? last.width : RAIL_WIDTH) - offLeft))
      for (const col of columns) { col.style.removeProperty('margin-left'); col.style.removeProperty('transition') }
      column.style.removeProperty('--bt-lc-w')
      delete column.dataset.folding
      chatRoom.hold(false)
    }
    const ends = ['pointerup', 'pointercancel', 'lostpointercapture']
    const onEnd = (end) => {
      if (done) return
      done = true
      if (end.type === 'pointerup') track(end.clientX)
      grip.removeEventListener('pointermove', onMove)
      for (const name of ends) grip.removeEventListener(name, onEnd)
      setDrag(null)
      if (last === null) { finish(); return }
      // The drag is the latest explicit gesture: it takes back a yielded panel's room.
      actions.setPanelYield?.(false)
      if (last.left === 'rail') { actions.setLeftDrawer?.(false); actions.setSidebarPref?.('rail') }
      else {
        actions.setSidebarWidth?.(last.width)
        actions.setSidebarPref?.('open')
        actions.setLeftDrawer?.(last.left === 'drawer')
      }
      if (springUntil === 0) finish()
      else settleTimer.current = setTimeout(finish, Math.max(0, springUntil - performance.now()) + 60)
    }
    grip.addEventListener('pointermove', onMove)
    for (const name of ends) grip.addEventListener(name, onEnd)
  }

  // In the Bot view the shell's own sidebar stays collapsed under our column. A
  // flip we did not ask for is the user's own switch gesture (the shell's button
  // or shortcut where it still reaches), unless the width just crossed the
  // shell's auto-collapse line, which re-applies the shell's own rule.
  const dsh = useRef(null)
  const requested = useRef(false)
  // The request mark always lapses on its own: a re-render before the shell's
  // flip must not leave it set, or the user's next switch would read as ours.
  // A lapse checks the shell again, since our flip and another one landing in
  // the same frame cancel out and no flip arrives to settle it.
  const requestLapse = useRef(0)
  const [lapsed, setLapsed] = useState(0)
  useEffect(() => () => clearTimeout(requestLapse.current), [])
  // The window's own resize event lands before the shell's next-frame measure,
  // so it dates a width change even while our frame source still holds the old one.
  const resizedAt = useRef(0)
  useEffect(() => {
    const onResize = () => { resizedAt.current = performance.now() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const quiet = (on) => {
    // Our own collapse of the shell's sidebar lands at once: its slide would drag
    // the conversation across under our column.
    if (on) document.documentElement.setAttribute('data-bt-collapsing', '')
    else document.documentElement.removeAttribute('data-bt-collapsing')
  }
  useEffect(() => () => quiet(false), [])
  useLayoutEffect(() => {
    if (typeof document === 'undefined' || typeof actions.toggleSidebar !== 'function') return undefined
    const collapsed = dshCollapsed() ?? !wide
    const prev = dsh.current
    const viewport = window.innerWidth
    dsh.current = { collapsed, viewport }
    if (prev !== null && collapsed !== prev.collapsed) {
      if (requested.current) requested.current = false
      else if (!collapsed && userSidebarToggle({ before: prev, after: { collapsed, viewport }, sinceResize: performance.now() - resizedAt.current })) {
        toggleRef.current()
      }
    }
    if (collapsed) { clearTimeout(requestLapse.current); requested.current = false; quiet(false); return undefined }
    if (requested.current) return undefined
    requested.current = true
    quiet(true)
    actions.toggleSidebar()
    clearTimeout(requestLapse.current)
    requestLapse.current = setTimeout(() => { requested.current = false; quiet(false); setLapsed(value => value + 1) }, 300)
    return undefined
  }, [wide, frameSnap.viewport, frameSnap.collapsed, lapsed])

  // The drawer closes on a row pick, on Escape and on a press outside it.
  useEscape(() => actions.setLeftDrawer?.(false), mode === 'drawer')
  useEffect(() => {
    if (mode !== 'drawer') return undefined
    const onDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.bt-leftcol')) return
      actions.setLeftDrawer?.(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('mousedown', onDown) }
  }, [mode])

  const navigate = (open, id) => {
    const result = open(id)
    if (leftDrawer) actions.setLeftDrawer?.(false)
    return result
  }
  const rowActions = {
    ...actions,
    openSession: id => navigate(actions.openSession, id),
    openAgent: id => navigate(actions.openAgent, id),
    openAgentSession: id => navigate(actions.openAgentSession, id),
    newAgentSession: id => navigate(actions.newAgentSession, id),
  }
  const rowProps = { roster, actions: rowActions, useSessions, useUi, useSessionStatus: props.useSessionStatus, useSessionRetainInfo: props.useSessionRetainInfo, useActivity: props.useActivity, useWork: props.useWork, useComputer: props.useComputer, wide: wideContent }
  // Typing while the sidebar has focus starts a search.
  const typeToSearch = (event) => {
    if (event.defaultPrevented || event.key.length !== 1 || event.key === ' ' || event.metaKey || event.ctrlKey || event.altKey || event.nativeEvent.isComposing) return
    if (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable]')) return
    event.preventDefault()
    actions.openPalette(event.key)
  }
  // The switch (top-left button, the shortcut) hides the whole column or brings
  // back the one it hid.
  const onToggle = () => actions.toggleLeftHidden?.()
  // The shell's sidebar shortcut is caught on its way down, before the shell's
  // own listener on window sees it: left to the shell, it would expand the shell's
  // sidebar first and our sync would pull it back, a visible flash.
  const toggleRef = useRef(onToggle)
  toggleRef.current = onToggle
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing || !pressesShellShortcut(event, 'sidebar.left.toggle')) return
      if (event.target instanceof Element && event.target.closest('.xterm')) return
      if (document.querySelector('[aria-modal="true"]')) return
      event.preventDefault()
      event.stopPropagation()
      toggleRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])
  // The title row is the window's, in both shapes the column takes: the bar carries the switch,
  // the name and the window-wide actions, whether the column below it is the open one or the rail.
  // Collapsed, the same switch is the way back, so it names what it does there.
  const switchLabel = t(mode === 'hidden' ? 'Expand sidebar' : 'Collapse sidebar')
  const top = h('div', { className: 'bt-side-top' },
    // The switch leads the row, level with the buttons across from it.
    h('button', { type: 'button', className: 'bt-round bt-side-collapse', 'aria-label': switchLabel, title: switchLabel, onClick: onToggle }, h(SidebarIcon)),
    h('span', { className: 'bt-brand' }, h(BrandName)),
    h(UpdateButton, { useUpdate: props.useUpdate, actions }),
    h('button', { type: 'button', className: 'bt-round', 'aria-label': t('New section'), title: t('New section'), onClick: createNewSection }, h(FolderIcon)),
    h('button', { type: 'button', className: 'bt-round', 'aria-label': t('Search'), title: t('Search'), onClick: () => actions.openPalette() }, h(SearchIcon)),
    h('button', { type: 'button', className: 'bt-round', 'aria-label': t('New…'), title: t('New…'), onClick: () => actions.openNewChat('new') }, h(PlusIcon)))
  // What the rail keeps for itself, now that the switch and the actions sit above it: the Main
  // Bot's face, standing in for the list the rail has no room for.
  const railTop = h('div', { className: 'bt-rail-top' },
    main ? h(BotRow, { ...rowProps, bot: main, marked: markedUnread[main.id] === true }) : roster.ready ? null : bootFailed ? h(BootFailed, { actions }) : h('div', { className: 'bt-hint' }, t('Setting up your Main Bot…')),
    h('span', { className: 'bt-rail-sep', 'aria-hidden': true }))
  // The foot stands in for the shell's hidden footer: the account avatar, and on
  // the rail the new-chat button above it.
  const foot = wideContent
    ? h('div', { className: 'bt-leftcol-foot' }, h(AccountLauncher, { seat: false, actions }), h(PluginsButton, { actions }))
    : h('div', { className: 'bt-leftcol-foot bt-leftcol-foot-rail' },
        h('button', { type: 'button', className: 'bt-round', 'aria-label': t('New…'), title: t('New…'), onClick: () => actions.openNewChat('new') }, h(PlusIcon)),
        h(AccountLauncher, { seat: false, actions }),
        h(PluginsButton, { actions }))
  // The title row belongs to the window, not to the column: under its own bar at the top edge it
  // stays put whatever width the column is dragged to — rail or open — and the column starts
  // below it. A collapsed column takes the column and nothing else: the band above the
  // conversation keeps its own background and its own switch, so what goes away is the list
  // under the band. Handing the band to the column's state repainted the whole top edge as the
  // frame's white and shrank the switch to the floating one.
  const windowBar = true
  const content = h('div', { className: wideContent ? 'bt-side' : 'bt-side bt-rail', onKeyDown: typeToSearch },
    wideContent ? null : railTop,
    wideContent ? h(SideBlockResizer, null, h(TeamTodoSide, { actions, openFrom: openFromTodo })) : null,
    // The resizer's own line is the boundary: a second hairline under it only spent height
    // the Bot list needs.
    wideContent && roster.readOnly ? h('div', { className: 'bt-hint bt-read-only', role: 'status' }, hostText(roster.readOnly)) : null,
    // The Main Bot keeps an ordinary row of its own above the list: it stands outside the
    // scroll box, so it cannot move, and the list's own top fade dissolves the rows passing
    // beneath it at its lower edge.
    wideContent && main
      ? h('div', { className: 'bt-list-pin' }, h(BotRow, { ...rowProps, bot: main, plain: true, marked: markedUnread[main.id] === true }))
      : null,
    h('div', {
      ref: listRef, className: 'bt-list', role: 'region', 'aria-label': t('Bot list'),
      onDragEnd: () => { setDragId(null); setDropTarget(null) },
      onDragLeave: (event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null) },
    },
      wideContent ? (main || roster.ready ? null : bootFailed ? h(BootFailed, { actions }) : h('div', { className: 'bt-hint' }, t('Setting up your Main Bot…'))) : null,
      wideContent && (sections.length > 0 || ungrouped.length > 0)
        ? h(UngroupedBlock, {
            entries: ungrouped,
            dropTarget,
            onDragOverSec,
            onDropSec,
          }, ungrouped.map(entry => renderSidebarEntry(entry, rowProps, markedUnread, onDragStart)))
        : ungrouped.map(entry => renderSidebarEntry(entry, rowProps, markedUnread, onDragStart)),
      sections.map(section => h(SectionBlock, {
        key: section.id,
        section,
        entries: order.filter(entry => entry.item.sectionId === section.id),
        rowProps,
        markedUnread,
        renaming: renameSection === section.id,
        dropTarget,
        onDragStart,
        onDragOverSec,
        onDropSec,
        secDrag,
        secOver,
        onSecDragStart,
        onSecDragOver,
        onSecDrop,
        onSecDragEnd,
      }))),
    foot)
  return h(Fragment, null,
    h(TitleToggle, { hidden: mode === 'hidden' && !windowBar, onToggle }),
    shown === 'hidden' ? null : h(LeftColumn, { mode: shown, width: ourWidth, onGrip: startDrag, leaving, topbar: windowBar }, content),
    windowBar ? h(WindowBar, null, top) : null,
    // The strip starts where the column ends, the same edge the conversation is pushed to.
    stripOn ? h(TopBotStrip, { roster, markedUnread, actions: rowActions, useSessions, useWork: props.useWork, left: Math.max(0, ourWidth - (frameSnap.collapsedWidth ?? 0)) }) : null)
}

// The update button at the sidebar's top right: a cloud while a newer DS Bot —
// or a newer verified DSH — is available, then the install's progress and
// result. Its card has one row each for the bot and DSH, with their versions,
// the release notes link, and each row's own button.
function UpdateButton({ useUpdate, actions }) {
  const update = useUpdate(value => value)
  const [open, setOpen] = useState(false)
  const [shown, leaving] = useLinger(open, 120)
  const [box, setBox] = useState(null)
  const [error, setError] = useState('')
  const [dshError, setDshError] = useState('')
  const button = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (event.target instanceof Element && (event.target.closest('.bt-update-pop') || button.current?.contains(event.target))) return
      setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { event.stopPropagation(); setOpen(false); button.current?.focus() } }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [open])
  const phase = update?.phase ?? 'idle'
  const dsh = update?.dsh
  const dshPhase = dsh?.phase ?? 'idle'
  const dshRow = showsDshRow(dsh, update?.app)
  // Hooks first: an update that turns visible after the sidebar mounted would
  // otherwise add hooks on a later render and crash the slot.
  const tick = useViewport()
  useLayoutEffect(() => {
    if (!open) return
    const rect = button.current?.getBoundingClientRect()
    if (rect) setBox({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)), top: rect.bottom + 6 })
  }, [open, tick])
  if (!update?.available && !dshRow && phase === 'idle' && dshPhase === 'idle') return null
  const cloudPhase = phase === 'installing' || dshPhase === 'installing' ? 'installing' : phase !== 'idle' ? phase : dshPhase
  const toggle = () => setOpen(value => !value)
  const start = () => {
    setError('')
    void actions.installUpdate().catch(failure => setError(hostText(failure?.message ?? String(failure))))
  }
  const startDsh = () => {
    setDshError('')
    void actions.installDshUpdate().catch(failure => setDshError(hostText(failure?.message ?? String(failure))))
  }
  const label = phase === 'installing' ? t('Updating DS Bot…')
    : dshPhase === 'installing' ? t('Updating DSH…')
      : phase === 'installed' ? t('DS Bot {version} is installed. Restart DSH to use it.', { version: update.installed ?? update.latest })
        : phase === 'updated' ? t('DS Bot {version} is installed.', { version: update.installed ?? update.latest })
        : dshPhase === 'installed' ? t('Restart DSH to start using DSH {version}.', { version: dsh.installed ?? dsh.verified })
          : update?.available ? t('DS Bot {version} is available', { version: update.latest })
            : t('DSH {version} is available', { version: dsh?.verified })
  const message = error || (phase === 'failed' ? update.error : '')
  const dshMessage = dshError || (dshPhase === 'failed' ? dsh?.error : '')
  const dshText = dshPhase === 'installed'
    ? t('Restart DSH to start using DSH {version}.', { version: dsh.installed ?? dsh.verified })
    : dsh?.available === false && dsh?.blockedBy
      ? t('Update DS Bot {version} first.', { version: dsh.blockedBy })
      : t('You have {version}.', { version: dsh?.current })
  return h(Fragment, null,
    h('button', {
      ref: button, type: 'button', className: 'bt-round bt-update', 'data-phase': cloudPhase, 'aria-label': label, title: label,
      'aria-haspopup': 'dialog', 'aria-expanded': open, onClick: toggle,
    }, h(CloudDownloadIcon, { done: phase === 'installed' || phase === 'updated' }), phase === 'failed' || dshPhase === 'failed' ? h('span', { className: 'bt-update-dot', 'aria-hidden': true }) : null),
    shown && box ? createPortal(h('div', { className: 'bt-update-pop', role: 'dialog', 'aria-label': update?.available || phase !== 'idle' ? t('DS Bot update') : t('DSH update'), style: box, 'data-leaving': leaving || undefined },
      update?.available || phase !== 'idle' ? h(Fragment, null,
        h('div', { className: 'bt-update-title' }, phase === 'installed' || phase === 'updated' ? t('Update installed') : t('DS Bot {version}', { version: update.latest })),
        h('div', { className: 'bt-update-text' }, phase === 'installed'
          ? t('Restart DSH to start using DS Bot {version}.', { version: update.installed ?? update.latest })
          : phase === 'updated' ? t('DS Bot {version} is installed.', { version: update.installed ?? update.latest })
            : t('You have {version}.', { version: update.current })),
        message ? h('div', { className: 'bt-update-error', role: 'alert' }, t('The update did not finish: {reason}', { reason: message })) : null,
        h('div', { className: 'bt-update-actions' },
          update.notesUrl ? h('a', { className: 'bt-update-notes', href: update.notesUrl, target: '_blank', rel: 'noopener noreferrer' }, t("What's new")) : null,
          phase === 'installed' || phase === 'updated' ? null : h('button', {
            type: 'button', className: 'bt-update-go', disabled: phase === 'installing', onClick: start,
          }, phase === 'installing' ? t('Updating…') : phase === 'failed' ? t('Try again') : t('Update')))) : null,
      dshRow ? h('div', { className: 'bt-update-dsh' },
        h('div', { className: 'bt-update-title' }, t('DSH {version}', { version: dsh.verified })),
        h('div', { className: 'bt-update-text' }, dshText),
        dshMessage ? h('div', { className: 'bt-update-error', role: 'alert' }, t('The update did not finish: {reason}', { reason: dshMessage })) : null,
        h('div', { className: 'bt-update-actions' },
          dsh.kind === 'app' ? (dsh.available
            ? h('button', { type: 'button', className: 'bt-update-go', onClick: () => void actions.openAppUpdates(dsh.verified).catch(() => {}) }, t('Open updates'))
            : null)
            : !dsh.available && dshPhase === 'idle' ? null
              : dshPhase === 'installed' ? null
                : h('button', {
                  type: 'button', className: 'bt-update-go', disabled: dshPhase === 'installing', onClick: startDsh,
                }, dshPhase === 'installing' ? t('Updating…') : dshPhase === 'failed' ? t('Try again') : t('Update')))) : null), document.body) : null)
}

// Account seat of the Settings trigger: the visible label stays for assistive tech only.
export function YouAvatar() {
  return h('span', { className: 'bt-you-wrap' },
    h('span', { className: 'bt-you', 'aria-hidden': true }, h(GearIcon)),
    h('span', { style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } }, t('Settings')))
}

let shellShortcuts = null

export function holdShellShortcuts(shortcuts) {
  shellShortcuts = shortcuts
  return () => { if (shellShortcuts === shortcuts) shellShortcuts = null }
}

// Whether a key press is the shell's current binding for one of its shortcuts.
function pressesShellShortcut(event, id) {
  const binding = shellShortcuts?.catalog.getSnapshot().find(row => row.id === id)?.binding
  if (!binding) return false
  const held = new Set(binding.modifiers)
  return event.code === binding.code && event.ctrlKey === held.has('control') && event.altKey === held.has('alt')
    && event.shiftKey === held.has('shift') && event.metaKey === held.has('meta')
}

const NO_SUBSCRIBE = () => () => {}
const NO_SNAPSHOT = () => null

// The footer avatar opens an account menu above itself, with Bot settings as one
// entry. Shell panels hidden from the Bot sidebar (plugins, automation) live here too.
// `seat` is the shell's settings.launcher seat: at priority -10 the whale wins it
// over a shell account plugin's own launcher (the Desktop's "··· More"), which comes
// back in Agent mode; FooterAccount stands in while no seat exists at all.
export function AccountLauncher({ seat = true, settingsOpen, actions }) {
  const [open, setOpen] = useState(false)
  useLayoutEffect(() => {
    if (!seat) return undefined
    actions.seatAccount(true)
    return () => actions.seatAccount(false)
  }, [seat])
  const [box, setBox] = useState(null)
  const button = useRef(null)
  const menuRef = useRef(null)
  useEffect(() => { if (settingsOpen) setOpen(false) }, [settingsOpen])
  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (event.target instanceof Element && (event.target.closest('.bt-account-menu') || button.current?.contains(event.target))) return
      setOpen(false)
    }
    const onKey = (event) => {
      if (stepMenuFocus(menuRef.current, event, button.current)) return
      if (event.key === 'Escape' && !event.isComposing && event.keyCode !== 229) { event.stopPropagation(); setOpen(false); button.current?.focus() }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [open])
  // The shell's account plugin lends its sign-out operation; the item shows only
  // when the plugin's entry is there and its account snapshot says signed in. The
  // entry can arrive after this mounts, so its operations follow the entry.
  const signIn = actions.signInEntry?.() ?? null
  const ops = useMemo(() => signIn?.inject?.() ?? {}, [signIn])
  const accountSource = ops.hooks?.account
  const account = useSyncExternalStore(accountSource?.subscribe ?? NO_SUBSCRIBE, accountSource ? () => accountSource.getSnapshot() : NO_SNAPSHOT)
  const signedIn = signIn !== null && typeof ops.signOut === 'function' && account?.view?.status === 'credential-stored'
  const signedOut = signIn !== null && typeof actions.signIn === 'function' && account?.view?.status === 'signed-out'
  const accountT = actions.accountT?.() ?? (key => key)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [signOutError, setSignOutError] = useState('')
  const askSignOut = async () => {
    setSignOutError('')
    let state = 'none'
    try {
      if (await ops.hasRunningAccountTasks?.()) state = 'running'
    } catch { state = 'unknown' }
    setConfirm(state)
  }
  const cancelSignOut = () => { setConfirm(null); setSignOutError('') }
  const runSignOut = async () => {
    setBusy(true)
    setSignOutError('')
    try {
      await ops.signOut()
      setConfirm(null)
      setOpen(false)
    } catch (error) {
      setSignOutError(String(error?.message ?? error))
    } finally {
      setBusy(false)
    }
  }
  const tick = useViewport()
  const anchor = () => {
    const rect = button.current?.getBoundingClientRect()
    if (rect) setBox({ left: rect.left, bottom: viewBottom() - rect.top + 5 })
  }
  useLayoutEffect(() => { if (open) anchor() }, [open, tick])
  const toggle = () => { if (!open) anchor(); setOpen(value => !value) }
  // Closing the menu drops a half-finished sign-out confirm with it.
  useEffect(() => {
    if (open) return
    setConfirm(null)
    setSignOutError('')
    setBusy(false)
  }, [open])
  const openModels = actions.openModels
  const groups = [
    [
      [t('Usage'), GaugeIcon, () => actions.openSettings('usage')],
      openModels ? [t('Models and API keys'), SlidersIcon, () => openModels()] : null,
      [t('Connectors'), ConnectorIcon, () => actions.openConnectors()],
      [t('Automation tasks'), ClockIcon, () => actions.selectPanel('schedules')],
      [t('Settings'), GearIcon, () => actions.openSettings('general')],
    ].filter(Boolean),
    typeof actions.setSurface === 'function' ? [[t('Classic Agent mode'), SwitchIcon, () => actions.setSurface('agent')]] : null,
  ].filter(Boolean)
  if (signedIn) groups.push([[accountT('signOut'), SignOutIcon, askSignOut, undefined, true]])
  else if (signedOut) groups.push([[t('Sign in to DeepSeek'), SignInIcon, () => actions.signIn()]])
  return h(Fragment, null,
    h('button', { ref: button, type: 'button', className: 'bt-account', 'aria-label': t('Account'), 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: toggle },
      h('span', { className: 'bt-you', 'aria-hidden': true }, h(GearIcon))),
    open && box ? createPortal(h('div', { ref: menuRef, className: 'bt-menu bt-menu-up bt-account-menu', role: 'menu', 'aria-label': t('Account'), style: box },
      confirm !== null ? h('div', { className: 'bt-confirm', role: 'alertdialog', 'aria-label': accountT('signOut') },
        h('p', { className: 'bt-confirm-text' }, accountT(confirm === 'running' ? 'signOutRunningDescription' : confirm === 'unknown' ? 'signOutUnknownDescription' : 'signOutDescription')),
        signOutError !== '' ? h('p', { className: 'bt-confirm-error', role: 'alert' }, signOutError) : null,
        h('div', { className: 'bt-confirm-row' },
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm', onClick: cancelSignOut }, t('Cancel')),
          h('button', { type: 'button', className: 'bt-confirm-go', disabled: busy, onClick: () => { void runSignOut() } }, accountT('signOut'))))
        : groups.map((group, index) => h(Fragment, { key: index },
          index > 0 ? h('div', { className: 'bt-menu-sep', role: 'separator' }) : null,
          group.map(([label, Icon, run, hint, stay]) => h('button', {
            key: label, type: 'button', role: 'menuitem',
            onClick: () => { if (stay !== true) setOpen(false); void Promise.resolve(run()).catch(error => actions.reportError(error, 'menu')) },
          }, h(Icon), h('span', { className: 'bt-menu-label' }, label), hint ? h('span', { className: 'bt-menu-hint' }, hint) : null))))), document.body) : null)
}

// The desktop app keeps its main window hidden until the team interface has drawn
// the first state, and shows its failure page when that never comes. The report
// says where the Main Bot's avatar is when it wears the start window's whale: the
// start window hands that whale over at the top of its jump, and it glides onto
// the avatar here.
let readyReported = false
function useReportReady(drawn, roster) {
  useEffect(() => {
    if (!drawn || readyReported) return
    readyReported = true
    void Promise.resolve().then(() => {
      const app = globalThis.dsBotApp
      if (typeof app?.ready !== 'function') return undefined
      // The place is a nicety: whatever goes wrong measuring it, the report still goes.
      let place
      try { place = mainAvatarPlace(roster) } catch { place = undefined }
      if (place === undefined) return app.ready()
      const mainId = roster.mainBotId
      app.onHandoff?.((from) => { try { glideOnto(mainMarkOf(mainId), from) } catch (error) { quietly('handoff')(error) } })
      return app.ready(place)
    }).catch(quietly('app ready'))
  }, [drawn])
}

function mainMarkOf(id) {
  if (typeof document === 'undefined') return null
  const key = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
  return document.querySelector(`.bt-side [data-bot-id="${key}"] .bt-mark`)
}

// The Main Bot's avatar in the team column, in CSS px of the page, with the page's size.
// Only the default look: a photo or another character would not match the start window's whale.
function mainAvatarPlace(roster) {
  const main = roster?.byId?.[roster.mainBotId]
  if (main === undefined || main.avatar?.image || typeof document === 'undefined') return undefined
  const look = lookOf(main)
  if (look.shape !== MAIN_LOOK.shape || look.color !== MAIN_LOOK.color) return undefined
  const mark = mainMarkOf(main.id)
  // Not the opacity: the column fades in as it first draws, which is when this is measured.
  if (!mark || mark.checkVisibility?.({ visibilityProperty: true }) === false) return undefined
  const box = restingBox(mark)
  const view = document.documentElement
  return { x: box.left, y: box.top, width: box.width, height: box.height, viewportWidth: globalThis.innerWidth ?? view.clientWidth, viewportHeight: globalThis.innerHeight ?? view.clientHeight }
}

// The avatar's box where the team column comes to rest. The column also slides in as it first
// draws (bt-leftcol-in, from off the left edge), and measured mid-slide the avatar would be
// outside the page and the whale would have nowhere to land; offsetLeft and offsetTop leave the
// slide's transform out.
function restingBox(mark) {
  const box = mark.getBoundingClientRect()
  const column = mark.closest?.('.bt-leftcol')
  if (!column) return box
  const now = column.getBoundingClientRect()
  const dx = column.offsetLeft - now.left
  const dy = column.offsetTop - now.top
  return { left: box.left + dx, top: box.top + dy, width: box.width, height: box.height }
}

// The whale the start window hands over (app/src/start-window.mjs): `from` is where it is on
// this page at the top of its jump. A copy of the avatar waits there for `hold` ms, while the two
// windows cross-fade, then glides onto the avatar in one compositor animation, so the jump does
// not stutter the way a window that resizes under it would. x and y ease differently, so the path
// bows upward; the avatar itself is hidden until the copy is on it, then gives a small bounce.
// Hidden by opacity, not visibility: the copy draws through the avatar's own masks (same ids),
// which a hidden avatar would stop drawing.
const GLIDE_MS = 460
function glideOnto(mark, from) {
  if (!mark || reducedMotion()) return
  const box = restingBox(mark)
  if (!box.width) return
  const outer = document.createElement('div')
  const inner = document.createElement('div')
  const copy = mark.cloneNode(true)
  copy.removeAttribute('data-live')
  Object.assign(outer.style, { position: 'fixed', left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, zIndex: '2147483647', pointerEvents: 'none' })
  Object.assign(inner.style, { width: '100%', height: '100%', transformOrigin: '0 0' })
  Object.assign(copy.style, { width: '100%', height: '100%' })
  copy.style.setProperty('--bt-ink-deepseek', getComputedStyle(mark).getPropertyValue('--bt-ink-deepseek'))
  inner.append(copy)
  outer.append(inner)
  outer.setAttribute('aria-hidden', 'true')
  document.body.append(outer)
  mark.style.opacity = '0'
  const timing = { delay: Math.max(0, Number(from.hold) || 0), duration: GLIDE_MS, fill: 'both' }
  outer.animate([{ transform: `translateX(${from.x - box.left}px)` }, { transform: 'none' }], { ...timing, easing: 'cubic-bezier(.45,0,.25,1)' })
  const glide = inner.animate([{ transform: `translateY(${from.y - box.top}px) scale(${from.size / box.width})` }, { transform: 'none' }], { ...timing, easing: 'cubic-bezier(.2,.65,.3,1)' })
  let landed = false
  const land = () => {
    if (landed) return
    landed = true
    outer.remove()
    mark.style.opacity = ''
    mark.animate([{ transform: 'scale(1.08, .92)' }, { transform: 'none' }], { duration: SPRING_POP.duration, easing: SPRING_POP.easing })
  }
  glide.finished.then(land, land)
  // A hidden page stops ticking animations: the avatar comes back regardless.
  setTimeout(land, timing.delay + GLIDE_MS + 500)
}

// Opens the Main Bot whenever the main view holds no Bot conversation, the way
// The view always lands on a Bot rather than an empty New Session page.
// When a Bot's chat moves on to a fresh part, the shell clears the view of the part
// it archived; the chat then goes on in the Bot's current part instead.
function useLandOnMainBot(roster, useSessions, actions) {
  const mainView = useSessions((list) => {
    const row = Object.values(list.byId).find(session => (session?.retainedBy?.mainView ?? 0) > 0)
    return row ? `${row.id}|${row.blank ? 1 : 0}` : ''
  })
  const lastBot = useRef(null)
  useEffect(() => {
    if (!roster.ready || !roster.mainBotId) return undefined
    const [id, blank] = mainView.split('|')
    const bot = id === '' ? undefined : roster.byId[id]
    if (bot !== undefined) {
      lastBot.current = { botId: bot.id, sessionId: id }
      if (currentPart(bot) !== id) actions.landOn(bot.id)
      return undefined
    }
    // The group's own Session moves on like a Bot's chat does: the part it archived
    // is cleared, and the view goes on in the fresh one.
    const room = id === '' ? undefined : roster.roomsById[id]
    if (room !== undefined) {
      lastBot.current = null
      if ((room.sessionId ?? room.id) !== id) actions.openSession(room.id)
      return undefined
    }
    // A DSH Agent Session, blank or not, is a real destination: it stays.
    if (id !== '' && ((actions.isAgentSession?.(id) ?? roster.agentOf[id] !== undefined) || blank !== '1')) {
      lastBot.current = null
      return undefined
    }
    const last = lastBot.current
    const timer = setTimeout(() => actions.landOn(roster.mainBotId, last), last ? 0 : 400)
    return () => clearTimeout(timer)
  }, [mainView, roster])
}

// The Plugins icon beside the foot's account gear: it opens the shell's plugin
// manager panel. Wherever that panel's navigation face is absent — such as a
// profile the peer may not list bundles in — nothing renders.
export function PluginsButton({ actions }) {
  if (!actions.hasPlugins?.()) return null
  return h('button', { type: 'button', className: 'bt-account', 'aria-label': t('Plugins'), title: t('Plugins'), onClick: () => actions.openPlugins() },
    h('span', { className: 'bt-you', 'aria-hidden': true }, h(PlugIcon)))
}

export function FooterAccount(props) {
  const seated = props.useUi(value => value.accountSeated === true)
  if (seated) return null
  return h('span', { className: 'bt-foot-account' }, h(AccountLauncher, { ...props, seat: false }))
}

// The only entry registered in every mode: in Agent mode the whole Bot surface is
// withdrawn, and this button in the shell's own footer is the way back.
export function BotReturn({ wide, useSurface, useRoster, actions }) {
  const mode = useSurface(value => value.mode)
  const ready = useRoster(value => value.ready)
  // Agent mode draws no team sidebar; there this button is the team interface.
  useReportReady(mode === 'agent' && ready)
  if (mode !== 'agent') return null
  const label = t('Back to DS Bot')
  return h('button', { type: 'button', className: 'bt-return', 'aria-label': label, title: label, onClick: () => actions.setSurface('bot') },
    h(BotMark, { look: MAIN_LOOK, size: 20 }),
    wide ? h('span', { className: 'bt-return-name' }, label) : null,
    wide ? h('span', { className: 'bt-return-swap', 'aria-hidden': true }, h(SwitchIcon)) : null)
}

// Agent mode has none of the shell-group styles, so the return button carries its own.
export const RETURN_CSS = `
.bt-return{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:36px;padding:0 14px;border:0;border-radius:999px;background:var(--bt-return-fill);color:inherit;font:inherit;font-size:14px;line-height:20px;cursor:pointer;transition:background-color .12s ease}
.bt-return:hover{background:var(--bt-return-fill-hover)}
.bt-return:active{transform:scale(.96)}
.bt-return .bt-mark{display:inline-flex;flex:none;line-height:0}
.bt-return .bt-mark svg{width:100%;height:100%;overflow:visible}
/* Shell styles carry --bt-ink-deepseek and Agent mode withdraws them; pin it here. */
.bt-return .bt-mark{--bt-ink-deepseek:#4D6BFE}
.bt-return-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-return-swap{display:inline-flex;flex:none;line-height:0;opacity:.55}
.bt-return-swap svg{width:16px;height:16px}
`

export function BrandMark({ size = 24 }) {
  return h('span', { className: 'bt-brand-whale' }, h(BotMark, { look: MAIN_LOOK, size }))
}
export function BrandName() {
  return h('span', { style: { fontWeight: 600, fontSize: 14 } }, 'DS Bot-C')
}

// With the whale holding the settings seat, the Bot row is just the account menu;
// FooterAccount only shows when the seat went to no one. The shell's footer classes
// are CSS-module names, so they match on their stems.
// A section folds on its own shorter clock than the shared 400ms spring: the state already
// changed under the click, and 400ms of rows rearranging afterwards reads as lag.
const FOLD_MS = 150
export const SIDEBAR_CSS = `
.bt-confirm{width:100%;max-width:260px;box-sizing:border-box;padding:10px 12px 12px;display:flex;flex-direction:column;gap:10px}
.bt-confirm-text{margin:0;font-size:13px;line-height:19px;color:var(--bt-ink-2)}
.bt-confirm-error{margin:0;font-size:12px;line-height:17px;color:var(--bt-danger);overflow-wrap:anywhere}
.bt-confirm-row{display:flex;justify-content:flex-end;gap:8px}
.bt-menu .bt-confirm button{width:auto;min-height:0}
.bt-confirm-go{height:28px;padding:0 14px;border:0;border-radius:999px;background:var(--bt-accent);color:var(--bt-accent-ink);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .12s ease}
.bt-confirm-go:hover:not(:disabled){opacity:.9}
.bt-confirm-go:disabled{opacity:.6;cursor:default}
.bt-side-top .bt-brand{cursor:default;padding-left:6px}
/* A hairline between the tab area and the list: it fades at both ends so it reads as a
   separation rather than a box edge. */
.bt-side-resize{flex:none;display:flex;flex-direction:column;min-height:0}
.bt-side-grip{position:relative;flex:none;height:9px;margin:-4px 10px 0;cursor:ns-resize;touch-action:none;border-radius:6px}
.bt-side-grip::before{content:"";position:absolute;left:14%;right:14%;top:50%;height:1px;margin-top:-.5px;border-radius:2px;background:color-mix(in srgb,var(--bt-ink) 13%,transparent);transition:background-color .12s ease,height .12s ease}
.bt-side-grip:hover::before,.bt-side-grip:focus-visible::before,.bt-side-resize[data-dragging] .bt-side-grip::before{height:2px;margin-top:-1px;background:color-mix(in srgb,var(--bt-ink) 26%,transparent)}
.bt-side-grip:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-3px}
.bt-side-resize[data-dragging]{cursor:ns-resize}
.bt-side-top .bt-brand:hover{background:none}
.bt-brand .bt-mark{flex:none}
.bt-main-chip{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0;border-radius:50%;background:none;cursor:pointer;transition:background-color .12s ease,scale .12s ease}
.bt-main-chip:hover{background:var(--bt-hover)}
.bt-main-chip:active{scale:.94}
.bt-main-chip[aria-current=page]{background:var(--bt-active)}
.bt-main-chip-dot{position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:var(--bt-green);box-shadow:0 0 0 2px var(--bt-sidebar)}
.bt-main-chip-tasks{position:absolute;top:-2px;right:-3px;min-width:14px;height:14px;padding:0 3px;border-radius:7px;background:var(--bt-accent);color:var(--bt-accent-ink);font-size:9px;line-height:14px;font-weight:600;text-align:center;font-variant-numeric:tabular-nums}
.bt-pin{flex:none;display:inline-flex;color:var(--bt-ink-3)}
.bt-rail .bt-row{position:relative}
.bt-rail .bt-pin{position:absolute;top:1px;left:calc(50% + 14px)}
.bt-side .bt-read-only{margin:4px 8px 6px;padding:8px 10px;border-radius:10px;background:var(--bt-hover);font-size:12px;line-height:1.45;text-align:left}
[class*="_footArea"]:has(.bt-foot-account){grid-template-columns:auto minmax(0,1fr) auto;column-gap:6px}
[class*="_footArea"]>[class*="_footerActions"]>div>.bt-foot-account{grid-column:1;order:1;display:inline-flex}
[class*="_footArea"]:has(.bt-foot-account)>[class*="_settingsArea"]{grid-column:3}
[class*="_footArea"]:has(.bt-foot-account)>[class*="_settingsArea"] button[class*="_trigger"] [class*="_label"]{display:none!important}

/* The update cloud springs in when a newer DS Bot shows up; its arrow drops in a
   loop while the install runs. */
.bt-round.bt-update{position:relative;color:var(--bt-accent,#4D6BFE);animation:bt-update-in ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-round.bt-update svg{width:17px;height:17px}
.bt-round.bt-update[data-phase=installed]{color:var(--bt-ink-2)}
@keyframes bt-update-in{from{opacity:0;transform:scale(.6);filter:var(--bt-fx-blur-4,blur(4px))}}
.bt-update[data-phase=installing] .bt-cloud-arrow{animation:bt-cloud-drop 1.1s cubic-bezier(.45,0,.55,1) infinite}
@keyframes bt-cloud-drop{0%{transform:translateY(-3px);opacity:0}35%{opacity:1}70%{transform:translateY(1px);opacity:1}100%{transform:translateY(2px);opacity:0}}
.bt-update-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:#E5484D;box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.bt-update-pop{position:fixed;z-index:60;width:280px;padding:14px 14px 12px;border-radius:16px;background:var(--bt-glass-bg);-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);border:.5px solid var(--bt-glass-rim);box-shadow:var(--bt-glass-shadow);color:var(--bt-ink);box-sizing:border-box;transform-origin:top left;font-family:var(--bt-font);animation:bt-update-pop ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-update-pop[data-leaving]{animation:bt-pop-out .12s cubic-bezier(.4,0,1,1) forwards;pointer-events:none}
@keyframes bt-update-pop{from{opacity:0;transform:scale(.96);filter:var(--bt-fx-blur-4,blur(4px))}}
.bt-update-title{font-size:14px;line-height:20px;font-weight:600}
.bt-update-text{margin-top:2px;font-size:12px;line-height:18px;color:var(--bt-ink-2)}
.bt-update-error{margin-top:8px;font-size:12px;line-height:17px;color:var(--bt-danger);overflow-wrap:anywhere;max-height:90px;overflow:auto}
.bt-update-actions{display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:12px}
.bt-update-notes{margin-right:auto;font-size:12px;color:var(--bt-ink-2);text-decoration:none}
.bt-update-notes:hover{color:var(--bt-ink);text-decoration:underline}
.bt-update-go{height:30px;padding:0 14px;border:0;border-radius:999px;background:var(--bt-accent,#4D6BFE);color:var(--bt-accent-ink,#fff);font:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:opacity .12s ease,transform .12s ease}
.bt-update-go:hover:not(:disabled){opacity:.9}
.bt-update-go:active:not(:disabled){transform:scale(.96)}
.bt-update-go:disabled{opacity:.6;cursor:default}
.bt-update-dsh:not(:first-child){margin-top:12px;padding-top:12px;border-top:.5px solid var(--bt-line-2)}
@media (prefers-reduced-motion:reduce){.bt-round.bt-update,.bt-update-pop,.bt-update .bt-cloud-arrow{animation:none}}

/* The DSH Agent row and its expanding Session list. The black whale is the
   harness's own mark, so the row reads as "plain dsh" next to the Bot marks. */
.bt-agent-ava{flex:none;width:36px;height:36px;border-radius:50%;corner-shape:round;display:inline-flex;align-items:center;justify-content:center;background:var(--bt-hover);color:var(--bt-ink)}
.bt-agent-ava.bt-run{animation:bt-agent-pulse 1.4s ease-in-out infinite}
@keyframes bt-agent-pulse{0%,100%{opacity:1}50%{opacity:.55}}
.bt-agent-sub{display:grid;grid-template-rows:0fr;transition:grid-template-rows ${SPRING_SHAPE.duration}ms ${SPRING_SHAPE.easing}}
.bt-agent-sub[data-open]{grid-template-rows:1fr}
.bt-agent-sub-in{overflow:hidden;min-height:0;margin-left:44px}
.bt-agent-sub-row{display:flex;align-items:center;gap:8px;width:100%;padding:5px 10px 5px 8px;border:0;border-radius:8px;background:none;color:var(--bt-ink-2);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer}
.bt-agent-sub-row:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-agent-sub-row[aria-current=page]{background:var(--bt-hover);color:var(--bt-ink);font-weight:500}
/* .bt-agent-sub-in clips for the expand animation and the rows touch its edges, so the ring goes inside. */
.bt-agent-sub-row:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-agent-sub-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt-agent-sub-time{flex:none;font-size:12.5px;color:var(--bt-ink-2);font-variant-numeric:tabular-nums}
.bt-agent-new{color:var(--bt-ink-3)}
.bt-agent-new svg{width:14px;height:14px;flex:none}
.bt-agent-edit{padding:3px 10px 3px 4px}
.bt-agent-edit input{width:100%;border:0;border-radius:6px;background:var(--bt-hover);color:var(--bt-ink);font:inherit;font-size:13px;line-height:20px;padding:2px 8px;outline:none;box-shadow:inset 0 0 0 .5px var(--bt-line-2)}
.bt-agent-sub[data-open] .bt-agent-sub-row{animation:bt-agent-row-in .24s ease both;animation-delay:calc(var(--i, 0)*30ms)}
@keyframes bt-agent-row-in{from{opacity:0;filter:var(--bt-fx-blur-4,blur(4px))}to{opacity:1;filter:none}}
@media (prefers-reduced-motion:reduce){.bt-agent-sub{transition:none}.bt-agent-sub .bt-agent-sub-row{animation:none}}

/* Sidebar sections: collapsible header with a 3D character pile and live status when
   folded, active conversation peek, drag-and-drop highlight, and 88px rail cluster. */
.bt-sec-ungrouped{display:flex;flex-direction:column;gap:3px;border-radius:10px;transition:min-height .14s ease,background-color .14s ease,box-shadow .14s ease}
.bt-sec-ungrouped[data-dragging=true]:empty{min-height:28px;margin-bottom:2px;box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-sec-ungrouped[data-drop=true]{background:color-mix(in srgb,var(--bt-accent) 9%,transparent);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--bt-accent) 65%,transparent)}
/* The Ungrouped header has no rename, colour or add buttons behind it, so nothing needs the
   room those usually take: the count and the pile stay where they are on hover. */
.bt-sec-ungrouped .bt-sec-head-wrap:is(:hover,:focus-within) .bt-sec-tail{padding-right:0}
.bt-sec{display:flex;flex-direction:column;margin-top:6px;border-radius:12px;transition:background-color .14s ease,box-shadow .14s ease}
/* A section in flight, and the edge the one under the pointer would take it. */
.bt-sec[data-sec-dragging=true]{opacity:.55}
.bt-sec[data-sec-drop=before]{box-shadow:inset 0 2px 0 var(--bt-accent)}
.bt-sec[data-sec-drop=after]{box-shadow:inset 0 -2px 0 var(--bt-accent)}
.bt-sec[data-drop=true]{background:color-mix(in srgb,var(--bt-accent) 9%,transparent);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--bt-accent) 65%,transparent)}
.bt-sec-head-wrap{position:relative;display:flex;align-items:center}
.bt-sec-head{display:flex;align-items:center;gap:6px;height:30px;padding:0 8px 0 6px;border:0;border-radius:8px;background:transparent;color:var(--bt-ink-2);font-family:var(--bt-font);font-size:12px;line-height:16px;font-weight:600;cursor:pointer;width:100%;text-align:left;transition:background-color .12s ease,color .12s ease}
.bt-sec-head-wrap:hover .bt-sec-head{background:var(--bt-hover);color:var(--bt-ink)}
.bt-sec-head:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-sec-chev{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;flex:none;color:var(--bt-ink-3);transition:transform ${FOLD_MS}ms ease-out,color .12s ease}
.bt-sec-head-wrap:hover .bt-sec-chev{color:var(--bt-ink-2)}
.bt-sec[data-collapsed=false] .bt-sec-chev{transform:rotate(90deg)}
.bt-sec-chev svg{width:12px;height:12px}
.bt-sec-dot{width:6px;height:6px;border-radius:50%;corner-shape:round;flex:none}
.bt-sec-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto}
.bt-sec-count{font-size:11px;line-height:16px;font-weight:500;color:var(--bt-ink-3);font-variant-numeric:tabular-nums;flex:none}
.bt-sec-head-wrap:is(:hover,:focus-within) .bt-sec-count-hide{display:none}
.bt-sec-tail{margin-left:auto;display:inline-flex;align-items:center;gap:6px;flex:none}
.bt-sec-head-wrap:is(:hover,:focus-within) .bt-sec-tail{padding-right:44px}
.bt-sec-pile{display:inline-flex;align-items:center;animation:bt-sec-pile-in ${SPRING_POP.duration}ms ${SPRING_POP.easing}}
@keyframes bt-sec-pile-in{from{opacity:0;transform:translateX(6px) scale(.82)}to{opacity:1;transform:none}}
.bt-sec-pile-item{display:inline-flex;border-radius:50%;corner-shape:round;background:var(--bt-sidebar);box-shadow:0 0 0 1.5px var(--bt-sidebar)}
.bt-sec-pile-item+.bt-sec-pile-item{margin-left:-5px}
.bt-sec-pile-more{font-size:11px;line-height:16px;font-weight:600;color:var(--bt-ink-3);margin-left:3px;font-variant-numeric:tabular-nums}
.bt-sec-status{width:8px;height:8px;border-radius:50%;corner-shape:round;flex:none}
.bt-sec-status[data-kind=working]{background:var(--bt-green);box-shadow:0 0 0 2px color-mix(in srgb,var(--bt-green) 22%,transparent)}
.bt-sec-status[data-kind=alert]{width:12px;height:12px;background:var(--bt-accent);color:var(--bt-accent-ink);font-size:8.5px;line-height:12px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.bt-sec-status[data-kind=unread]{background:var(--bt-accent)}
.bt-sec-acts{position:absolute;right:4px;top:50%;transform:translateY(-50%);display:inline-flex;align-items:center;gap:2px;opacity:0;pointer-events:none;transition:opacity .12s ease}
.bt-sec-head-wrap:is(:hover,:focus-within) .bt-sec-acts{opacity:1;pointer-events:auto}
.bt-sec-act{position:relative;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--bt-ink-3);cursor:pointer;transition:background-color .12s ease,color .12s ease,transform ${SPRING_TAP.duration}ms ${SPRING_TAP.easing}}
.bt-sec-act::after{content:"";position:absolute;inset:-4px}
.bt-sec-act:hover{background:var(--bt-active);color:var(--bt-ink)}
.bt-sec-act:active{transform:scale(.9)}
.bt-sec-act:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-sec-act svg{width:13px;height:13px}
.bt-sec-edit{display:flex;align-items:center;height:30px;padding:0 4px}
.bt-sec-edit input{width:100%;height:24px;padding:0 8px;border:0;border-radius:6px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:12px;line-height:16px;font-weight:600;outline:none;box-shadow:inset 0 0 0 1.5px var(--bt-accent)}
.bt-sec-body{display:grid;grid-template-rows:1fr;transition:grid-template-rows ${FOLD_MS}ms ease-out}
.bt-sec[data-collapsed=true] .bt-sec-body{grid-template-rows:0fr}
.bt-sec-body-in{overflow:hidden;min-height:0;display:flex;flex-direction:column;gap:3px;position:relative;contain:layout paint}
.bt-sec[data-collapsed=false] .bt-sec-body-in{padding-top:2px}
.bt-sec[data-collapsed=false]:hover .bt-sec-body-in::before{content:'';position:absolute;left:10px;top:6px;bottom:6px;width:1.5px;border-radius:999px;background:var(--bt-line-2);opacity:.55;pointer-events:none}
.bt-rail-sec{display:flex;flex-direction:column;align-items:center;gap:4px;width:100%}
.bt-rail-sec-div{display:flex;align-items:center;justify-content:center;width:100%;padding:5px 0 2px;cursor:pointer}
.bt-rail-sec-pill{width:22px;height:3px;border-radius:999px;background:var(--bt-line-2);transition:width .14s ease,background-color .14s ease}
.bt-rail-sec-div:hover .bt-rail-sec-pill{width:30px;background:var(--bt-ink-3)}
.bt-rail-folder{position:relative;display:flex;align-items:center;justify-content:center;width:56px;height:56px;padding:0;border:0;border-radius:16px;background:color-mix(in srgb,var(--bt-ink) 5%,transparent);color:var(--bt-ink-2);box-shadow:inset 0 0 0 .5px var(--bt-line-2);cursor:pointer;transition:background-color .12s ease,transform ${SPRING_TAP.duration}ms ${SPRING_TAP.easing}}
.bt-rail-folder:hover{background:var(--bt-hover);color:var(--bt-ink)}
.bt-rail-folder:active{transform:scale(.95)}
.bt-rail-folder:focus-visible{outline:2px solid var(--bt-accent);outline-offset:-2px}
.bt-rail-folder[aria-current=page]{background:var(--bt-active);box-shadow:inset 0 0 0 1.5px var(--bt-accent)}
.bt-menu-sub-head{padding:4px 8px 2px;font-size:11px;line-height:16px;font-weight:600;color:var(--bt-ink-3);user-select:none}
.bt-menu-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;text-align:left}
.bt-menu-hint{margin-left:auto;font-size:11px;line-height:16px;color:var(--bt-ink-3);flex:none}
.bt-menu-check{margin-left:auto;color:var(--bt-accent);display:inline-flex;flex:none}
.bt-menu-colors{display:flex;align-items:center;gap:6px;padding:4px 8px 6px}
.bt-menu-color-dot{width:16px;height:16px;border-radius:50%;corner-shape:round;border:0;padding:0;cursor:pointer;box-shadow:inset 0 0 0 1px var(--bt-line-2)}
.bt-menu-color-dot[aria-pressed=true]{outline:2px solid var(--bt-ink);outline-offset:1.5px}
.bt-menu-color-dot:focus-visible{outline:2px solid var(--bt-accent);outline-offset:2px}
.bt-sec-add-menu{max-width:260px}
.bt-sec-add-list{display:flex;flex-direction:column;gap:2px;max-height:240px;overflow-y:auto}
@media (prefers-reduced-motion:reduce){.bt-sec-body,.bt-sec-chev,.bt-sec-act,.bt-rail-folder{transition:none}.bt-sec-pile,.bt-agent-ava.bt-run{animation:none}}
`
