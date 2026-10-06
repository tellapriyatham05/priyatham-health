const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  sendAudio: (samples) => ipcRenderer.send('audio', samples),
  micStatus: (status) => ipcRenderer.send('mic-status', status),
  micLevel: (level) => ipcRenderer.send('mic-level', level),
  onDisplay: (callback) => ipcRenderer.on('display', (_event, display) => callback(display)),
  onSpeak: (callback) => ipcRenderer.on('speak', (_event, audio) => callback(audio)),
  onLook: (callback) => ipcRenderer.on('look', (_event, look) => callback(look)),
  onVisibility: (callback) => ipcRenderer.on('visibility', (_event, hidden) => callback(hidden)),
  onPrepareImage: (callback) => ipcRenderer.on('prepare-image', (_event, src) => callback(src)),
  imagePrepared: (result) => ipcRenderer.send('image-prepared', result),
  spoke: (id, error) => ipcRenderer.send('spoke', { id, error }),
  pointerOver: (over) => ipcRenderer.send('pointer-over', over),
  homeMoved: (pos) => ipcRenderer.send('home-moved', pos),
  clicked: () => ipcRenderer.send('jarvis-click'),
  menu: () => ipcRenderer.send('jarvis-menu'),
});
