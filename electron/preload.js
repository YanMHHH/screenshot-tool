const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTask: (payload) => ipcRenderer.invoke('task:start', payload),
  pauseTask: () => ipcRenderer.invoke('task:pause'),
  resumeTask: () => ipcRenderer.invoke('task:resume'),
  stopTask: () => ipcRenderer.invoke('task:stop'),
  parseExcel: (arrayBuffer) => ipcRenderer.invoke('file:parse-excel', arrayBuffer),
  toggleBrowser: (visible) => ipcRenderer.invoke('browser:toggle', visible),
  setBrowserBounds: (bounds) => ipcRenderer.invoke('browser:bounds', bounds),
  openFolder: () => ipcRenderer.invoke('task:open-folder'),
  onTaskUpdate: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('task:update', listener);
    return () => ipcRenderer.removeListener('task:update', listener);
  }
});
