// preload.js — Secure bridge between the main process and the renderer
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getEnv: () => ipcRenderer.invoke('get-env'),
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    closeWindow: () => ipcRenderer.send('window-close'),
    togglePin: (shouldPin) => ipcRenderer.send('window-toggle-pin', shouldPin),
    getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
    setWindowMode: (mode) => ipcRenderer.send('window-set-mode', mode),
    // ─── Stealth Mode ───
    getStealthMode: () => ipcRenderer.invoke('get-stealth-mode'),
    setStealthMode: (enabled) => ipcRenderer.send('set-stealth-mode', enabled),
    onStealthModeChanged: (callback) => ipcRenderer.on('stealth-mode-changed', (event, enabled) => callback(enabled)),
    // ─── Click-Through (Anti-Tab-Detect) ───
    mouseEnterWindow: () => ipcRenderer.send('mouse-enter-window'),
    mouseLeaveWindow: () => ipcRenderer.send('mouse-leave-window'),
});
