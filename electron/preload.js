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
  }
});
