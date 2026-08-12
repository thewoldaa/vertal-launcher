'use strict';
const { ipcMain, dialog, shell, app } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const { getConfig, setConfig } = require('./config');
const paths = require('./paths');
const offlineAuth = require('./offline-auth');
const instances = require('./instances');
const mods = require('./mods');
const mojangApi = require('./mojang-api');
const loaderFabric = require('./loader-fabric');
const loaderForge = require('./loader-forge');
const launcher = require('./launcher');
const javaManager = require('./java-manager');
const servers = require('./servers');
const localScan = require('./local-scan');
const { getMainWindow } = require('./window');

function send(channel, payload) {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function registerIpc() {
  // ---- Window controls ----
  ipcMain.on('window:minimize', () => getMainWindow()?.minimize());
  ipcMain.on('window:maximize', () => {
    const win = getMainWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on('window:close', () => getMainWindow()?.close());
  ipcMain.handle('window:isMaximized', () => getMainWindow()?.isMaximized() || false);

  // ---- Config ----
  ipcMain.handle('config:get', () => getConfig());
  ipcMain.handle('config:set', (e, patch) => setConfig(patch));
  ipcMain.handle('config:systemInfo', () => ({
    totalMemMB: Math.round(os.totalmem() / (1024 * 1024)),
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
  }));

  // ---- Accounts (offline profiles) ----
  ipcMain.handle('accounts:list', () => offlineAuth.listAccounts());
  ipcMain.handle('accounts:add', (e, username) => offlineAuth.addAccount(username));
  ipcMain.handle('accounts:remove', (e, id) => offlineAuth.removeAccount(id));
  ipcMain.handle('accounts:setActive', (e, id) => offlineAuth.setActiveAccount(id));
  ipcMain.handle('accounts:getActive', () => offlineAuth.getActiveAccount());

  // ---- Instances (installations) ----
  ipcMain.handle('instances:list', () => instances.listInstances());
  ipcMain.handle('instances:get', (e, id) => instances.getInstance(id));
  ipcMain.handle('instances:create', (e, data) => instances.createInstance(data));
  ipcMain.handle('instances:update', (e, id, patch) => instances.updateInstance(id, patch));
  ipcMain.handle('instances:delete', (e, id) => instances.deleteInstance(id));
  ipcMain.handle('instances:setActive', (e, id) => instances.setActiveInstance(id));
  ipcMain.handle('instances:getActive', () => instances.getActiveInstance());
  ipcMain.handle('instances:isRunning', (e, id) => launcher.isRunning(id));

  // ---- Mojang / loader metadata ----
  ipcMain.handle('mojang:listVersions', async (e, { force } = {}) => {
    const manifest = await mojangApi.getVersionManifest(!!force);
    return manifest;
  });
  ipcMain.handle('loader:listFabricQuilt', async (e, { flavor, mcVersion }) => {
    return loaderFabric.listLoaderVersionsForGame(flavor, mcVersion);
  });
  ipcMain.handle('loader:listForgeNeo', async (e, { flavor, mcVersion }) => {
    return flavor === 'forge'
      ? loaderForge.listForgeVersions(mcVersion)
      : loaderForge.listNeoForgeVersions(mcVersion);
  });

  // ---- Install pipeline (streamed) ----
  ipcMain.handle('install:start', (e, instanceId) => {
    const requestId = randomUUID();
    (async () => {
      try {
        // Installing extracts ~1 GB of assets and libraries — require a real
        // machine: at least 2 GB of system RAM (same bar as launching).
        if (os.totalmem() < 2 * 1024 ** 3) {
          throw new Error('At least 2 GB of RAM is required to install Minecraft on this machine.');
        }
        await launcher.installInstance(instanceId, (state) => {
          send('install:event', { requestId, instanceId, type: 'progress', ...state });
        });
        send('install:event', { requestId, instanceId, type: 'done' });
      } catch (err) {
        send('install:event', { requestId, instanceId, type: 'error', message: err.message });
      }
    })();
    return { requestId };
  });

  // ---- Launch pipeline (streamed) ----
  ipcMain.handle('launch:start', (e, instanceId, opts) => {
    const requestId = randomUUID();
    (async () => {
      try {
        const result = await launcher.launchInstance(instanceId, {
          server: opts && opts.server ? (typeof opts.server === 'string' ? servers.getServer(opts.server) : opts.server) : null,
          onProgress: (state) => send('launch:event', { requestId, instanceId, type: 'progress', ...state }),
          onLog: (stream, text) => send('launch:event', { requestId, instanceId, type: 'log', stream, text }),
          onExit: (info) => send('launch:event', { requestId, instanceId, type: 'exit', ...info }),
        });
        send('launch:event', { requestId, instanceId, type: 'started', ...result });
        // "Close launcher when the game starts" — give the started event a
        // moment to flush to the renderer, then close the window. The game
        // process itself is independent and keeps running.
        if (getConfig().closeOnLaunch) {
          setTimeout(() => {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) win.close();
          }, 800);
        }
      } catch (err) {
        send('launch:event', { requestId, instanceId, type: 'error', message: err.message });
      }
    })();
    return { requestId };
  });
  ipcMain.handle('launch:kill', (e, instanceId) => launcher.killInstance(instanceId));

  // ---- Servers (quick-play targets) ----
  ipcMain.handle('servers:list', () => servers.listServers());
  ipcMain.handle('servers:get', (e, id) => servers.getServer(id));
  ipcMain.handle('servers:add', (e, data) => servers.addServer(data));
  ipcMain.handle('servers:update', (e, id, patch) => servers.updateServer(id, patch));
  ipcMain.handle('servers:remove', (e, id) => servers.removeServer(id));

  // ---- Mods ----
  ipcMain.handle('mods:list', (e, instanceId) => mods.listMods(instanceId));
  ipcMain.handle('mods:toggle', (e, instanceId, fileName, enabled) => mods.toggleMod(instanceId, fileName, enabled));
  ipcMain.handle('mods:remove', (e, instanceId, fileName) => mods.removeMod(instanceId, fileName));
  ipcMain.handle('mods:addViaDialog', async (e, instanceId) => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Add mod files',
      filters: [{ name: 'Mod jar', extensions: ['jar'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled) return [];
    return mods.addModFiles(instanceId, result.filePaths);
  });
  ipcMain.handle('mods:openFolder', (e, instanceId) => shell.openPath(mods.modsDirFor(instanceId)));

  // ---- Local linked installations (existing Minecraft folders) ----
  ipcMain.handle('local:scanFolder', (e, folder) => localScan.scanFolder(folder));
  ipcMain.handle('local:selectFolder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0];
  });

  // ---- Java ----
  ipcMain.handle('java:verify', (e, exePath) => javaManager.verifyJavaExecutable(exePath));

  // ---- Dialogs / shell ----
  ipcMain.handle('dialog:selectFolder', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('dialog:selectJava', async () => {
    const win = getMainWindow();
    const filters = process.platform === 'win32'
      ? [{ name: 'Java executable', extensions: ['exe'] }]
      : [{ name: 'Java executable', extensions: ['*'] }];
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
    if (result.canceled) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('app:openPath', (e, target) => {
    // Only reveal paths that actually exist — never let the renderer pass
    // arbitrary shell targets (control-panel applets, `file://` tricks, etc.).
    if (typeof target !== 'string' || !target.trim() || !fs.existsSync(target)) return undefined;
    return shell.openPath(target);
  });
  ipcMain.handle('app:openExternal', (e, url) => {
    if (/^https?:\/\//i.test(String(url))) return shell.openExternal(url);
    return undefined;
  });
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));

  // ---- First-run wizard: data folder location ----
  ipcMain.handle('wizard:getDefaultDataPath', () => paths.dataRootBase());
  ipcMain.handle('wizard:selectDataPath', async () => {
    const win = getMainWindow();
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    return result.filePaths[0];
  });
  ipcMain.handle('wizard:diskSpace', async (e, targetPath) => {
    // The target folder may not exist yet on first run — walk up to the
    // nearest existing ancestor so we can still report real free space.
    let probePath = targetPath;
    for (let i = 0; i < 12; i++) {
      if (fs.existsSync(probePath)) break;
      const parent = path.dirname(probePath);
      if (parent === probePath) break;
      probePath = parent;
    }
    try {
      const stat = await fs.promises.statfs(probePath);
      return { freeBytes: stat.bfree * stat.bsize, totalBytes: stat.blocks * stat.bsize };
    } catch (err) {
      return { freeBytes: null, totalBytes: null };
    }
  });
  ipcMain.handle('wizard:setDataRoot', (e, targetPath) => {
    fs.mkdirSync(targetPath, { recursive: true });
    paths.setDataRootOverride(targetPath);
    setConfig({ customDataRoot: targetPath });
    return true;
  });
  ipcMain.handle('wizard:complete', () => setConfig({ firstRun: false }));
}

module.exports = { registerIpc };
