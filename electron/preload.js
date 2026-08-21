const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startTask: (payload) => ipcRenderer.invoke('task:start', payload),
  pauseTask: () => ipcRenderer.invoke('task:pause'),
  resumeTask: () => ipcRenderer.invoke('task:resume'),
  stopTask: () => ipcRenderer.invoke('task:stop'),
  inspectTask: (outputBase, project) => ipcRenderer.invoke('task:inspect', outputBase, project),
  parseExcel: (arrayBuffer) => ipcRenderer.invoke('file:parse-excel', arrayBuffer),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  defaults: () => ipcRenderer.invoke('app:defaults'),
  licenseStatus: () => ipcRenderer.invoke('license:status'),
  getAuthorizationRequest: () => ipcRenderer.invoke('license:get-authorization'),
  copyAuthorizationRequest: () => ipcRenderer.invoke('license:copy-authorization'),
  importLicense: () => ipcRenderer.invoke('license:import'),
  openFolder: (folder) => ipcRenderer.invoke('task:open-folder', folder),
  openReport: (reportPath) => ipcRenderer.invoke('task:open-report', reportPath),
  onTaskUpdate: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('task:update', listener);
    return () => ipcRenderer.removeListener('task:update', listener);
  },
  onLicenseUpdate: (callback) => {
    const listener = (_event, update) => callback(update);
    ipcRenderer.on('license:update', listener);
    return () => ipcRenderer.removeListener('license:update', listener);
  }
});
