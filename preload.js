'use strict';
const { contextBridge, ipcRenderer } = require('electron');

function on(channel, callback) {
  const handler = (event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    systemInfo: () => ipcRenderer.invoke('config:systemInfo'),
  },

  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    add: (username) => ipcRenderer.invoke('accounts:add', username),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    setActive: (id) => ipcRenderer.invoke('accounts:setActive', id),
    getActive: () => ipcRenderer.invoke('accounts:getActive'),
  },

  instances: {
    list: () => ipcRenderer.invoke('instances:list'),
    get: (id) => ipcRenderer.invoke('instances:get', id),
    create: (data) => ipcRenderer.invoke('instances:create', data),
    update: (id, patch) => ipcRenderer.invoke('instances:update', id, patch),
    delete: (id) => ipcRenderer.invoke('instances:delete', id),
    setActive: (id) => ipcRenderer.invoke('instances:setActive', id),
    getActive: () => ipcRenderer.invoke('instances:getActive'),
    isRunning: (id) => ipcRenderer.invoke('instances:isRunning', id),
  },

  mojang: {
    listVersions: () => ipcRenderer.invoke('mojang:listVersions'),
  },
  loader: {
    listFabricQuilt: (flavor, mcVersion) => ipcRenderer.invoke('loader:listFabricQuilt', { flavor, mcVersion }),
    listForgeNeo: (flavor, mcVersion) => ipcRenderer.invoke('loader:listForgeNeo', { flavor, mcVersion }),
  },

  install: {
    start: (instanceId) => ipcRenderer.invoke('install:start', instanceId),
    onEvent: (callback) => on('install:event', callback),
  },
  launch: {
    start: (instanceId, opts) => ipcRenderer.invoke('launch:start', instanceId, opts),
    kill: (instanceId) => ipcRenderer.invoke('launch:kill', instanceId),
    onEvent: (callback) => on('launch:event', callback),
  },

  servers: {
    list: () => ipcRenderer.invoke('servers:list'),
    get: (id) => ipcRenderer.invoke('servers:get', id),
    add: (data) => ipcRenderer.invoke('servers:add', data),
    update: (id, patch) => ipcRenderer.invoke('servers:update', id, patch),
    remove: (id) => ipcRenderer.invoke('servers:remove', id),
  },

  mods: {
    list: (instanceId) => ipcRenderer.invoke('mods:list', instanceId),
    toggle: (instanceId, fileName, enabled) => ipcRenderer.invoke('mods:toggle', instanceId, fileName, enabled),
    remove: (instanceId, fileName) => ipcRenderer.invoke('mods:remove', instanceId, fileName),
    addViaDialog: (instanceId) => ipcRenderer.invoke('mods:addViaDialog', instanceId),
    openFolder: (instanceId) => ipcRenderer.invoke('mods:openFolder', instanceId),
  },

  java: {
    verify: (exePath) => ipcRenderer.invoke('java:verify', exePath),
  },

  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
    selectJava: () => ipcRenderer.invoke('dialog:selectJava'),
  },

  app: {
    openPath: (target) => ipcRenderer.invoke('app:openPath', target),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
  },

  wizard: {
    getDefaultDataPath: () => ipcRenderer.invoke('wizard:getDefaultDataPath'),
    selectDataPath: () => ipcRenderer.invoke('wizard:selectDataPath'),
    diskSpace: (targetPath) => ipcRenderer.invoke('wizard:diskSpace', targetPath),
    setDataRoot: (targetPath) => ipcRenderer.invoke('wizard:setDataRoot', targetPath),
    complete: () => ipcRenderer.invoke('wizard:complete'),
  },
});
