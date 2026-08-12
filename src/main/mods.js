'use strict';
const fs = require('fs');
const path = require('path');
const instances = require('./instances');

function modsDirFor(instanceId) {
  const instance = instances.getInstance(instanceId);
  if (!instance) throw new Error('Unknown installation.');
  const dir = path.join(instances.gameDirFor(instance), 'mods');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listMods(instanceId) {
  const dir = modsDirFor(instanceId);
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const disabled = f.endsWith('.disabled');
      const displayName = disabled ? f.slice(0, -('.disabled'.length)) : f;
      const stat = fs.statSync(path.join(dir, f));
      return { fileName: f, displayName, enabled: !disabled, sizeBytes: stat.size, modifiedAt: stat.mtimeMs };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

function safeModName(fileName) {
  const name = String(fileName ?? '');
  // Reject any path separator explicitly — never rely on platform basename().
  if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) {
    throw new Error('Invalid mod file name.');
  }
  if (!name.endsWith('.jar') && !name.endsWith('.jar.disabled')) {
    throw new Error('Invalid mod file name.');
  }
  return name;
}

function toggleMod(instanceId, fileName, enabled) {
  const dir = modsDirFor(instanceId);
  const safe = safeModName(fileName);
  const src = path.join(dir, safe);
  if (!fs.existsSync(src)) throw new Error('Mod file not found.');
  const isCurrentlyEnabled = !safe.endsWith('.disabled');
  if (isCurrentlyEnabled === enabled) return safe;
  const dest = enabled ? path.join(dir, safe.replace(/\.disabled$/, '')) : path.join(dir, safe + '.disabled');
  fs.renameSync(src, dest);
  return path.basename(dest);
}

function removeMod(instanceId, fileName) {
  const dir = modsDirFor(instanceId);
  // path containment double-check on top of basename() — belt and suspenders.
  const safe = safeModName(fileName);
  const target = path.resolve(dir, safe);
  if (!target.startsWith(path.resolve(dir) + path.sep)) throw new Error('Invalid mod file name.');
  if (fs.existsSync(target)) fs.rmSync(target);
  return true;
}

function addModFiles(instanceId, sourcePaths) {
  const dir = modsDirFor(instanceId);
  const added = [];
  for (const src of sourcePaths) {
    if (!src.toLowerCase().endsWith('.jar')) continue;
    const dest = path.join(dir, path.basename(src));
    fs.copyFileSync(src, dest);
    added.push(path.basename(dest));
  }
  return added;
}

module.exports = { modsDirFor, listMods, toggleMod, removeMod, addModFiles };
