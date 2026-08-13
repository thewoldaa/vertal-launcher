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

// Keys the renderer (via IPC config:set) is allowed to touch. Everything
// else — including arbitrary new keys — is silently dropped.
const CONFIG_WHITELIST = new Set([
  'firstRun', 'language', 'theme', 'javaPath', 'ramMB', 'jvmArgs', 'resolution',
  'activeAccountId', 'activeInstanceId', 'closeOnLaunch', 'windowBounds',
  'installDirNote', 'customDataRoot',
]);

function getConfig() {
  // Merge with defaults so newly-added keys always exist for older configs.
  return Object.assign({}, DEFAULT_CONFIG, configStore.read());
}

function setConfig(patch) {
  const safe = {};
  for (const k of Object.keys(patch || {})) {
    if (!CONFIG_WHITELIST.has(k)) continue;
    let v = patch[k];
    if (k === 'jvmArgs' && typeof v === 'string') {
      // Never allow code-injection style agent args, even if a future bug
      // lets the renderer (or injected markup) reach this setter.
      v = v.split(/\s+/).filter((a) => !/^-(javaagent|agentpath|agentlib):/.test(a)).join(' ');
    }
    safe[k] = v;
  }
  return configStore.update((cur) => Object.assign({}, cur, safe));
}

module.exports = {
  DEFAULT_CONFIG,
  getConfig,
  setConfig,
  accountsStore,
  instancesStore,
  serversStore,
};
