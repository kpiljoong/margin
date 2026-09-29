'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agentSettings', {
  get: () => ipcRenderer.invoke('agent:get'),
  set: (command) => ipcRenderer.invoke('agent:set', command),
  cancel: () => ipcRenderer.send('agent:cancel'),
});
