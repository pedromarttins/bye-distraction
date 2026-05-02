const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('get-state'),
  addSite: (site) => ipcRenderer.invoke('add-site', site),
  removeSite: (site) => ipcRenderer.invoke('remove-site', site),
  editSite: (old, next) => ipcRenderer.invoke('edit-site', { old, new: next }),
  toggleBlocking: () => ipcRenderer.invoke('toggle-blocking'),
  setPersistBlockingOnQuit: (value) => ipcRenderer.invoke('set-persist-blocking-on-quit', value)
})
