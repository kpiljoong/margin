'use strict';
// Exposes a deliberately tiny bridge to the web UI. The agent command itself
// can only be changed in the native settings window, and the page can only ask
// to open files the user actually dropped (it never passes paths itself).
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

contextBridge.exposeInMainWorld('agentNotesDesktop', {
  platform: process.platform,
  openFolder: () => ipcRenderer.send('desktop:open-folder'),
  openFile: () => ipcRenderer.send('desktop:open-file'),
  // File objects from a drop; only real files from the OS have a path.
  openDropped: (files) => ipcRenderer.send('desktop:open-paths', [...files].map((f) => webUtils.getPathForFile(f)).filter(Boolean)),
  onOpenNote: (cb) => ipcRenderer.on('desktop:open-note', (_e, rel) => cb(String(rel))),
  configureAgent: () => ipcRenderer.send('desktop:configure-agent'),
  revealFolder: () => ipcRenderer.send('desktop:reveal'),
  // Shows a workspace file or folder in Finder / Explorer (path relative to the workspace).
  revealPath: (rel) => ipcRenderer.send('desktop:reveal', String(rel)),
  // Native menu → app commands (e.g. ⌘W closes a tab, not the window).
  onCommand: (cb) => ipcRenderer.on('desktop:command', (_e, name) => cb(String(name))),
  // Lets the window background match the theme (no flash on next launch).
  setBackground: (color) => ipcRenderer.send('desktop:background', String(color)),
  // The interface's size (the whole page, 0.5–2).
  setZoom: (f) => { const n = Number(f); if (n >= 0.5 && n <= 2) webFrame.setZoomFactor(n); },
  closeWindow: () => ipcRenderer.send('desktop:close-window'),
  // Changed keyboard shortcuts ({ id: keys }), kept in the app's config so the
  // menu and the system-wide shortcut use them too.
  getShortcuts: () => ipcRenderer.invoke('desktop:get-shortcuts'),
  setShortcuts: (custom) => ipcRenderer.invoke('desktop:set-shortcuts', custom),
  recordingKeys: (on) => ipcRenderer.send('desktop:recording-keys', !!on),
  // The page's small settings, kept in the app's config (see main.js): a
  // snapshot as the page starts (null the first time), and changes.
  pageStore: () => ipcRenderer.sendSync('desktop:page-store'),
  pageStoreSet: (entries) => ipcRenderer.send('desktop:page-store-set', entries),
  // The UI loaded: tells the launcher this app version works.
  uiReady: () => ipcRenderer.send('desktop:ui-ready'),
});
