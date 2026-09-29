'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marginUpdate', {
  get: () => ipcRenderer.invoke('update:get'),
  check: () => ipcRenderer.invoke('update:check'),
  install: () => ipcRenderer.invoke('update:install'),
  restart: () => ipcRenderer.send('update:restart'),
  setAuto: (on) => ipcRenderer.invoke('update:set-auto', !!on),
  openDownload: () => ipcRenderer.send('update:open-download'),
  close: () => ipcRenderer.send('update:close'),
  onState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
});
