const { contextBridge, ipcRenderer } = require('electron');

function createPreloadApi(renderer) {
  return Object.freeze({
    getStatus: () => renderer.invoke('crew:get-status'),
    openDashboard: () => renderer.invoke('crew:open-dashboard'),
  });
}

if (contextBridge && ipcRenderer) contextBridge.exposeInMainWorld('crew', createPreloadApi(ipcRenderer));
module.exports = { createPreloadApi };
