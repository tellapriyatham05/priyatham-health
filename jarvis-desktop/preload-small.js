// Preload for Jarvis's helper windows (numbers layer and the commands editor).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvisNumbers', {
  onShow: (callback) => ipcRenderer.on('numbers', (_e, items) => callback(items)),
});

contextBridge.exposeInMainWorld('jarvisEditor', {
  load: () => ipcRenderer.invoke('editor-load'),
  save: (commands) => ipcRenderer.invoke('editor-save', commands),
  test: (line) => ipcRenderer.invoke('editor-test', line),
  run: (name) => ipcRenderer.invoke('editor-run', name),
});
