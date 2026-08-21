const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('signerAPI', {
  loadPrivateKey: () => ipcRenderer.invoke('key:load'),
  issueLicense: (params) => ipcRenderer.invoke('license:issue', params),
  saveFile: (filename, content) => ipcRenderer.invoke('file:save', filename, content)
});
