
// --- local patch: the page's way to ask for the panel window (see main.mjs) ---
if (host !== undefined && location.origin === host) {
  contextBridge.exposeInMainWorld('dsBotPanel', {
    open: (query) => ipcRenderer.invoke('ds-bot:panel-window', query !== null && typeof query === 'object' ? query : {}),
  })
}
