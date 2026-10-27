const { app, BrowserWindow, ipcMain, net, protocol, shell, Notification } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const mcpServer = require('./mcp-server.bundle.cjs');
const { checkForUpdate, releaseUrl } = require('./updates.cjs');
let availableUpdate = null;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setPath('userData', path.join(app.getPath('appData'), 'meu-magic'));
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let window;
let migrationWindow;
let migrationComplete;
let migrationEventId = 0;
const migrationAcks = new Map();
let pendingInvite;
let quitting = false;
let mcpDispatchId = 0;
const mcpPending = new Map();
async function stopMcp() {
  for (const [id, pending] of mcpPending) {
    clearTimeout(pending.timer);
    pending.reject(new Error('O servidor MCP foi encerrado.'));
    mcpPending.delete(id);
  }
  await mcpServer.stop();
}
function inviteFrom(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'meumagic:' || url.hostname !== 'join' || url.username || url.password || url.search || url.hash) return undefined;
    const code = url.pathname.split('/').filter(Boolean)[0];
    return code && /^[a-zA-Z0-9_-]{6,80}$/.test(code) ? code : undefined;
  } catch { return undefined; }
}
function consumeInvite(value) {
  const code = inviteFrom(value);
  if (!code) return;
  pendingInvite = code;
  if (window?.webContents) { window.webContents.send('invite:join', code); window.show(); window.focus(); }
}

async function copyLegacyProfile() {
  const legacy = path.join(app.getPath('appData'), 'mana-table');
  const current = app.getPath('userData');
  const marker = path.join(current, '.legacy-profile-copied');
  if (path.resolve(legacy) === path.resolve(current)) return;
  try { await fs.access(marker); return; } catch {}
  try { await fs.access(legacy); } catch { return; }
  await fs.mkdir(current, { recursive: true });
  await fs.cp(legacy, current, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter(source) {
      const basename = path.basename(source);
      return !/^Singleton(Lock|Socket|Cookie)$/.test(basename)
        && !['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache', 'ShaderCache', 'Crashpad'].includes(basename);
    },
  });
  await fs.writeFile(marker, 'copied');
}

if (gotLock) {
  ipcMain.handle('notifications:show', (event, payload) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (window.isFocused() || !Notification.isSupported() || !payload || typeof payload.title !== 'string' || typeof payload.body !== 'string' || payload.title.length > 120 || payload.body.length > 300) return;
    const notification = new Notification({ title: payload.title, body: payload.body });
    notification.on('click', () => { if (!window || window.isDestroyed()) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
    notification.show();
  });
  ipcMain.handle('updates:check', async event => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid update request.');
    availableUpdate = await checkForUpdate(app.getVersion(), net.fetch);
    return availableUpdate;
  });
  ipcMain.handle('updates:open', async event => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !availableUpdate || !releaseUrl(availableUpdate.url, `v${availableUpdate.version}`)) throw new Error('Invalid release request.');
    await shell.openExternal(availableUpdate.url);
  });
  ipcMain.handle('mcp:start', async event => {
    if (!window || event.sender !== window.webContents) throw new Error('Invalid MCP server request.');
    return mcpServer.start({ window, dispatch: (tool, args) => new Promise((resolve, reject) => {
      const id = String(++mcpDispatchId);
      const timer = setTimeout(() => { mcpPending.delete(id); reject(new Error('A mesa demorou para responder à ferramenta MCP.')); }, 90_000);
      mcpPending.set(id, { resolve, reject, timer });
      window?.webContents.send('mcp:tool-call', { id, tool, args });
    }) });
  });
  ipcMain.handle('mcp:stop', async event => {
    if (window && event.sender !== window.webContents) throw new Error('Invalid MCP server request.');
    await stopMcp();
  });
  ipcMain.on('mcp:tool-result', (event, response) => {
    if (!window || event.sender !== window.webContents || !response || typeof response.id !== 'string') return;
    const pending = mcpPending.get(response.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    mcpPending.delete(response.id);
    if (response.error) pending.reject(new Error(String(response.error)));
    else pending.resolve(response.result);
  });
  ipcMain.on('app:quit-ready', event => {
    if (window && event.sender === window.webContents && quitting) app.exit(0);
  });
  ipcMain.handle('migration:start', async event => {
    if (!window || event.sender !== window.webContents) throw new Error('Invalid migration request.');
    await copyLegacyProfile();
    if (migrationWindow && !migrationWindow.isDestroyed()) throw new Error('A migração anterior ainda está em andamento.');
    const completed = new Promise((resolve, reject) => { migrationComplete = { resolve, reject }; });
    migrationWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    try {
      await migrationWindow.loadURL('app://mana-table/legacy-migration.html');
      await completed;
      return true;
    } finally {
      for (const pending of migrationAcks.values()) { clearTimeout(pending.timer); pending.reject(new Error('A migração foi encerrada.')); }
      migrationAcks.clear();
      migrationWindow?.close();
      migrationWindow = undefined;
      migrationComplete = undefined;
    }
  });
  ipcMain.handle('migration:event', (event, payload) => {
    if (!migrationWindow || event.sender !== migrationWindow.webContents || !window) throw new Error('Invalid migration source.');
    const id = String(++migrationEventId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { migrationAcks.delete(id); reject(new Error('A migração dos dados locais expirou.')); }, 120_000);
      migrationAcks.set(id, { resolve, reject, timer });
      window.webContents.send('migration:event', { id, event: payload });
    });
  });
  ipcMain.handle('migration:complete', (event, error) => {
    if (!migrationWindow || event.sender !== migrationWindow.webContents || !migrationComplete) throw new Error('Invalid migration completion.');
    if (error) migrationComplete.reject(new Error(String(error)));
    else migrationComplete.resolve(true);
  });
  ipcMain.on('migration:ack', (event, { id, error }) => {
    if (!window || event.sender !== window.webContents || typeof id !== 'string') return;
    const pending = migrationAcks.get(id);
    if (!pending) return;
    clearTimeout(pending.timer);
    migrationAcks.delete(id);
    if (error) pending.reject(new Error(String(error)));
    else pending.resolve();
  });
  app.on('second-instance', (_event, argv) => {
    consumeInvite(argv.find(value => value.startsWith('meumagic://')) || '');
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
  });
  app.on('open-url', (event, url) => { event.preventDefault(); consumeInvite(url); });
  app.whenReady().then(async () => {
    await copyLegacyProfile();
    protocol.handle('app', request => {
      const url = new URL(request.url);
      const legacyMigrationPage = url.host === 'mana-table' && ['/legacy-migration.html', '/legacy-migration.js'].includes(url.pathname);
      if (url.host !== 'meu-magic' && !legacyMigrationPage) return new Response('Not found', { status: 404 });
      const root = path.resolve(app.getAppPath(), 'dist');
      const target = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(target).toString());
    });
    window = new BrowserWindow({
      width: 1440,
      height: 960,
      minWidth: 900,
      minHeight: 640,
      backgroundColor: '#10130f',
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });
    window.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'https:' && ['scryfall.com', 'magic.wizards.com'].includes(parsed.hostname)) void shell.openExternal(url);
      } catch {}
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, target) => {
      if (process.env.MEU_MAGIC_DEV_SERVER_URL && target.startsWith(process.env.MEU_MAGIC_DEV_SERVER_URL)) return;
      if (target.startsWith('app://meu-magic/')) return;
      event.preventDefault();
    });
    window.on('closed', () => { window = undefined; });
    await window.loadURL(process.env.MEU_MAGIC_DEV_SERVER_URL || 'app://meu-magic/index.html');
    if (pendingInvite) window.webContents.send('invite:join', pendingInvite);
  });
  app.on('before-quit', event => {
    if (!quitting && window && !window.isDestroyed()) {
      event.preventDefault();
      quitting = true;
      window.webContents.send('app:before-quit');
      void stopMcp();
      setTimeout(() => app.exit(0), 7000).unref();
    }
  });
  app.on('window-all-closed', () => { app.quit(); });
}
