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

function toggleMod(instanceId, fileName, enabled) {
  const dir = modsDirFor(instanceId);
  const src = path.join(dir, fileName);
  if (!fs.existsSync(src)) throw new Error('Mod file not found.');
  const isCurrentlyEnabled = !fileName.endsWith('.disabled');
  if (isCurrentlyEnabled === enabled) return fileName;
  const dest = enabled ? path.join(dir, fileName.replace(/\.disabled$/, '')) : path.join(dir, fileName + '.disabled');
  fs.renameSync(src, dest);
  return path.basename(dest);
}

function removeMod(instanceId, fileName) {
  const dir = modsDirFor(instanceId);
  const target = path.join(dir, fileName);
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
