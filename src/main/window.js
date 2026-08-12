'use strict';
const { BrowserWindow, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { getConfig, setConfig } = require('./config');

let mainWindow = null;

function createWindow() {
  const cfg = getConfig();
  const saved = cfg.windowBounds;
  const display = screen.getPrimaryDisplay();
  const defaultWidth = Math.min(1440, Math.round(display.workAreaSize.width * 0.85));
  const defaultHeight = Math.min(900, Math.round(display.workAreaSize.height * 0.85));

  mainWindow = new BrowserWindow({
    width: (saved && saved.width) || defaultWidth,
    height: (saved && saved.height) || defaultHeight,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 1040,
    minHeight: 660,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    // build/ is dev-only (not packaged); the packaged exe gets its icon via
    // scripts/after-pack.js rcedit, so guard the path here.
    icon: fs.existsSync(path.join(__dirname, '..', '..', 'build', 'icon.png'))
      ? path.join(__dirname, '..', '..', 'build', 'icon.png')
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', '..', 'app', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  let saveTimer = null;
  const persistBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const bounds = mainWindow.getBounds();
      setConfig({ windowBounds: bounds });
    }, 400);
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);
  mainWindow.on('closed', () => { mainWindow = null; });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createWindow, getMainWindow };
