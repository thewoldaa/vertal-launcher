'use strict';
const os = require('os');
const { JsonStore } = require('./store');
const paths = require('./paths');

function defaultRamMB() {
  const totalGB = os.totalmem() / (1024 ** 3);
  // Leave headroom for the OS: aim for ~40% of total RAM, clamped to sane bounds.
  const suggested = Math.round((totalGB * 0.4) / 0.5) * 512;
  return Math.max(1024, Math.min(8192, suggested));
}

const DEFAULT_CONFIG = {
  firstRun: true,
  language: 'en',
  theme: 'dark',
  javaPath: null,        // null = auto-detect / auto-download
  ramMB: defaultRamMB(),
  jvmArgs: '',
  resolution: null,      // null = default window size; else { width, height, fullscreen }
  installDirNote: null,  // informational only; real data always lives under userData
  activeAccountId: null,
  activeInstanceId: null,
  closeOnLaunch: false,
  windowBounds: null,
};

const configStore = new JsonStore(paths.configFile, DEFAULT_CONFIG);
const accountsStore = new JsonStore(paths.accountsFile, []);
const instancesStore = new JsonStore(paths.instancesFile, []);
const serversStore = new JsonStore(paths.serversFile, []);

function getConfig() {
  // Merge with defaults so newly-added keys always exist for older configs.
  return Object.assign({}, DEFAULT_CONFIG, configStore.read());
}

function setConfig(patch) {
  return configStore.update((cur) => Object.assign({}, cur, patch));
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  setConfig,
  accountsStore,
  instancesStore,
  serversStore,
};
