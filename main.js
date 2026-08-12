'use strict';
const { app, BrowserWindow } = require('electron');
const { createWindow } = require('./src/main/window');
const { registerIpc } = require('./src/main/ipc');
const paths = require('./src/main/paths');
const { getConfig } = require('./src/main/config');

// Single instance lock — a second launch just focuses the existing window.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const cfg = getConfig();
    if (cfg.customDataRoot) paths.setDataRootOverride(cfg.customDataRoot);

    registerIpc();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
