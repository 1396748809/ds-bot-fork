
// --- local patch: a panel window, so one conversation's details can stand beside the app ---
// The page asks through `dsBotPanel.open()` (preload.cjs); the window carries the same
// preload and the same Host page, and the page itself switches to its panel-only layout
// from the query it finds. Kept out of the shipped code paths so an upgrade only has to
// re-run D:\apk\asar-append.cjs. Every step appends a line to userData/panel-window.log so
// a silent failure says why.
let panelWindow

function panelLog(line) {
  try { writeFileSync(join(app.getPath('userData'), 'panel-window.log'), `${new Date().toISOString()} ${line}\n`, { flag: 'a' }) } catch { /* logging is best effort */ }
  console.error(`DS Bot panel: ${line}`)
}

function panelWindowUrl(query) {
  const main = mainWindow !== undefined && !mainWindow.isDestroyed() ? mainWindow.webContents.getURL() : ''
  const base = main === '' ? `${origin}/` : main.split('#')[0].split('?')[0]
  const params = new URLSearchParams()
  params.set('ds-bot-window', 'panel')
  for (const key of ['session', 'tab', 'view']) {
    const value = query?.[key]
    if (typeof value === 'string' && value !== '') params.set(key, value)
  }
  return `${base}?${params.toString()}`
}

function openPanelWindow(query) {
  const url = panelWindowUrl(query)
  panelLog(`open ${url}`)
  if (panelWindow !== undefined && !panelWindow.isDestroyed()) {
    void panelWindow.loadURL(url).catch((error) => { panelLog(`reuse load failed: ${error?.message ?? error}`) })
    panelWindow.show()
    panelWindow.focus()
    return true
  }
  const dark = nativeTheme.shouldUseDarkColors
  const win = new BrowserWindow({
    width: 400, height: 820, minWidth: 320, minHeight: 420,
    title: 'DS Bot panel', icon: windowIcon, show: false,
    backgroundColor: dark ? '#1b1b1c' : '#ffffff',
    webPreferences: {
      preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, webviewTag: true,
      additionalArguments: [`--ds-bot-origin=${origin}`],
    },
  })
  panelWindow = win
  panelLog('window created')
  win.on('closed', () => { if (panelWindow === win) panelWindow = undefined })
  win.once('ready-to-show', () => { panelLog('ready to show'); win.show() })
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) { panelLog('shown by fallback timer'); win.show() } }, 1500)
  // The sheets main.mjs injects per window (fonts, the card look, the platform band) are
  // not global, so the panel carries them too.
  const sheets = ['fonts.css', 'page-card.css']
  if (material !== undefined) sheets.push('material.css')
  if (process.platform === 'darwin') sheets.push('macos.css')
  if (process.platform === 'win32') sheets.push('windows.css')
  for (const file of sheets) {
    try {
      const css = readFileSync(join(here, file), 'utf8')
      win.webContents.on('dom-ready', () => { void win.webContents.insertCSS(css) })
    } catch (error) { panelLog(`sheet ${file} skipped: ${error?.message ?? error}`) }
  }
  // A link in the panel leaves for the system browser, the way the main window's do.
  win.webContents.setWindowOpenHandler(({ url: target }) => { openOutside(target); return { action: 'deny' } })
  win.webContents.on('will-navigate', (event, target) => {
    if (target.startsWith(`${origin}/`)) return
    event.preventDefault()
    openOutside(target)
  })
  win.webContents.on('did-fail-load', (_event, code, description, target) => { panelLog(`load failed ${code} ${description} ${target}`) })
  win.webContents.on('did-finish-load', () => { panelLog(`loaded ${win.webContents.getURL()}`) })
  void win.loadURL(url).catch((error) => { panelLog(`loadURL threw: ${error?.message ?? error}`) })
  return true
}

ipcMain.handle('ds-bot:panel-window', (event, query) => {
  try {
    const frame = event.senderFrame
    panelLog(`request from ${String(frame?.url ?? '(no frame)')}`)
    if (frame === undefined || frame === null || !String(frame.url ?? '').startsWith(`${origin}/`)) {
      throw new Error('DS Bot: rejected a panel window request from an unknown page')
    }
    return openPanelWindow(query !== null && typeof query === 'object' ? query : {})
  } catch (error) {
    panelLog(`refused: ${error?.message ?? error}`)
    throw error
  }
})

panelLog(`panel window patch ready (origin ${origin})`)
