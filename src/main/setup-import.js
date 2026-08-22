'use strict';
/**
 * Imports choices made inside the NSIS installer (custom setup page) so the
 * app's first launch is instant — no wizard, no "second installation".
 *
 * The installer writes <userData>/setup.ini:
 *   dataRoot=<folder>
 *   username=<optional offline profile>
 * This module applies them to config.json / accounts.json and removes the
 * file. If the file is missing (e.g. silent install), nothing happens and
 * the normal first-run wizard takes over.
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { getConfig, setConfig } = require('./config');
const offlineAuth = require('./offline-auth');

function importSetupIni() {
  const ini = path.join(paths.root(), 'setup.ini');
  if (!fs.existsSync(ini)) return false;

  const kv = {};
  for (const line of fs.readFileSync(ini, 'utf8').split(/\r?\n/)) {
    const idx = line.indexOf('=');
    if (idx > 0) kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }

  const patch = { firstRun: false };
  if (kv.language && /^[a-z]{2,3}$/.test(kv.language)) patch.language = kv.language;
  // Only a true first run may set the data root — a reinstall/upgrade must
  // keep the existing choice (the installer also stops overwriting setup.ini).
  if (kv.dataRoot && path.isAbsolute(kv.dataRoot) && !getConfig().customDataRoot) {
    patch.customDataRoot = kv.dataRoot;
  }
  setConfig(patch);

  if (kv.username && typeof kv.username === 'string') {
    try { offlineAuth.addAccount(kv.username); } catch { /* invalid/duplicate — user can add later */ }
  }

  try { fs.unlinkSync(ini); } catch { /* keep going even if cleanup fails */ }
  return true;
}

module.exports = { importSetupIni };
