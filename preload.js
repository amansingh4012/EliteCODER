// preload.js — Secure bridge between the main process and the renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getEnv: () => ipcRenderer.invoke('get-env'),
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    togglePin: (shouldPin) => ipcRenderer.send('window-toggle-pin', shouldPin),
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
    setWindowMode: (mode) => ipcRenderer.send('window-set-mode', mode),
});
