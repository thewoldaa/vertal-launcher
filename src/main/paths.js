'use strict';
/**
 * Central path resolver for everything Vertal Launcher writes to disk.
 *
 *   <userData>/
 *     config.json
 *     accounts.json
 *     instances.json
 *     data/
 *       versions/<id>/<id>.json + <id>.jar
 *       libraries/<maven path>
 *       assets/objects/<xx>/<hash>
 *       assets/indexes/<indexId>.json
 *       runtime/<component>/...        (Mojang-provided JRE, per component name)
 *     instances/<instanceId>/          (per-instance game dir when "separate folder" is on)
 *     data/shared/                     (default shared .minecraft-style folder)
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function root() {
  return app.getPath('userData');
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Optional user-chosen location for the (large) game data folder — set once
// during the first-run wizard's "Installation Path" step. config.json,
// accounts.json and instances.json always stay in the fixed Electron
// userData location so the app can find its own settings no matter what.
let _dataRootOverride = null;
function setDataRootOverride(p) {
  _dataRootOverride = p || null;
}
function dataRootBase() {
  return _dataRootOverride || path.join(root(), 'data');
}

const P = {
  root,
  configFile: () => path.join(root(), 'config.json'),
  accountsFile: () => path.join(root(), 'accounts.json'),
  instancesFile: () => path.join(root(), 'instances.json'),
  serversFile: () => path.join(root(), 'servers.json'),

  dataRoot: () => ensureDir(dataRootBase()),
  versionsDir: () => ensureDir(path.join(dataRootBase(), 'versions')),
  versionDir: (versionId) => ensureDir(path.join(dataRootBase(), 'versions', versionId)),
  librariesDir: () => ensureDir(path.join(dataRootBase(), 'libraries')),
  assetsDir: () => ensureDir(path.join(dataRootBase(), 'assets')),
  assetObjectsDir: () => ensureDir(path.join(dataRootBase(), 'assets', 'objects')),
  assetIndexesDir: () => ensureDir(path.join(dataRootBase(), 'assets', 'indexes')),
  runtimeDir: (component) => ensureDir(path.join(dataRootBase(), 'runtime', component || '')),
  nativesTmpDir: (versionId) => ensureDir(path.join(dataRootBase(), 'natives', versionId)),

  sharedGameDir: () => ensureDir(path.join(dataRootBase(), 'shared')),
  instanceDir: (instanceId) => ensureDir(path.join(dataRootBase(), 'instances', instanceId)),

  logsDir: () => ensureDir(path.join(root(), 'logs')),

  setDataRootOverride,
  dataRootBase,
};

module.exports = P;
