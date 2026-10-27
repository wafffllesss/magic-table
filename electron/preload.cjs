const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('meuMagicDesktop', Object.freeze({
  isElectron: true,
  showNotification(title, body) { return ipcRenderer.invoke('notifications:show', { title, body }); },
  checkForUpdate() { return ipcRenderer.invoke('updates:check'); },
  openUpdate() { return ipcRenderer.invoke('updates:open'); },
  onInvite(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, code) => callback(code);
    ipcRenderer.on('invite:join', listener);
    return () => ipcRenderer.removeListener('invite:join', listener);
  },
  onBeforeQuit(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('app:before-quit', listener);
    return () => ipcRenderer.removeListener('app:before-quit', listener);
  },
  completeBeforeQuit() { ipcRenderer.send('app:quit-ready'); },
  startMcpServer() { return ipcRenderer.invoke('mcp:start'); },
  stopMcpServer() { return ipcRenderer.invoke('mcp:stop'); },
  onMcpToolCall(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('mcp:tool-call', listener);
    return () => ipcRenderer.removeListener('mcp:tool-call', listener);
  },
  resolveMcpTool(id, result, error) { ipcRenderer.send('mcp:tool-result', { id, result, error }); },
  startLegacyMigration() { return ipcRenderer.invoke('migration:start'); },
  sendLegacyMigrationEvent(payload) { return ipcRenderer.invoke('migration:event', payload); },
  finishLegacyMigration(error) { return ipcRenderer.invoke('migration:complete', error); },
  onLegacyMigrationEvent(callback) {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('migration:event', listener);
    return () => ipcRenderer.removeListener('migration:event', listener);
  },
  acknowledgeLegacyMigrationEvent(id, error) { ipcRenderer.send('migration:ack', { id, error }); },
}));
