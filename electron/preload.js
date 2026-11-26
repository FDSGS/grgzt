const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appBridge', {
  onNewTask(callback) {
    ipcRenderer.on('menu:new-task', () => callback());
  },
  action(name) {
    return ipcRenderer.invoke('win:action', name);
  },
  getWindowState() {
    return ipcRenderer.invoke('win:state');
  },
  onWindowState(callback) {
    ipcRenderer.on('win:state', (_event, payload) => callback(payload));
  },
  onAbout(callback) {
    ipcRenderer.on('about:open', (_event, payload) => callback(payload));
  },
  copyText(text) {
    return ipcRenderer.invoke('clipboard:write', text);
  },
  readStore() {
    return ipcRenderer.invoke('store:read');
  },
  writeStore(payload) {
    return ipcRenderer.invoke('store:write', payload);
  },
  onStoreChange(callback) {
    ipcRenderer.on('store:changed', (_event, payload) => callback(payload));
  }
});
