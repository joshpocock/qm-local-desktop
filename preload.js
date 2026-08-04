'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit API surface exposed to renderer content (offline.html
// and settings.html only — the remote qm-local web UI never runs with
// this preload's context, since it's the same window but a different
// loaded document; the API is inert unless the page calls it).
contextBridge.exposeInMainWorld('qmLocal', {
  getConfig: () => ipcRenderer.invoke('qm:get-config'),
  setConfig: (url) => ipcRenderer.invoke('qm:set-config', url),
  retry: () => ipcRenderer.send('qm:retry'),
  openSettings: () => ipcRenderer.send('qm:open-settings'),
});
