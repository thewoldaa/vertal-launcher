'use strict';
const os = require('os');
const { JsonStore } = require('./store');
const paths = require('./paths');

function defaultRamMB() {
  // 4 GB is the sweet spot for modern Minecraft with modloaders; users can
  // lower it down to 256 MB (slow but workable) or raise it up to 8 GB.
  return 4096;
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
