'use strict';
const { randomUUID } = require('crypto');
const fs = require('fs');
const { instancesStore, getConfig, setConfig } = require('./config');
const paths = require('./paths');

function listInstances() {
  return instancesStore.read();
}

function getInstance(id) {
  return instancesStore.read().find((i) => i.id === id) || null;
}

function gameDirFor(instance) {
  if (instance.customGameDir) return instance.customGameDir;
  if (instance.separateFolder) return paths.instanceDir(instance.id);
  return paths.sharedGameDir();
}

function createInstance(data) {
  const name = (data.name || '').trim();
  if (!name) throw new Error('Installation name is required.');
  if (!data.mcVersion) throw new Error('A Minecraft version is required.');
  const loader = data.loader || 'vanilla';
  if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) {
    throw new Error(`Unknown loader: ${loader}`);
  }

  const instance = {
    id: randomUUID(),
    name,
    mcVersion: data.mcVersion,
    versionType: data.versionType || 'release',
    loader,
    loaderVersion: data.loaderVersion || 'latest',
    resolvedVersionId: null,
    separateFolder: !!data.separateFolder,
    customGameDir: data.customGameDir || null,
    createdAt: Date.now(),
    lastPlayedAt: null,
    totalPlaytimeMs: 0,
    installed: false,
    ramMBOverride: data.ramMBOverride || null,
    jvmArgsOverride: data.jvmArgsOverride || null,
  };

  instancesStore.update((cur) => [...cur, instance]);
  const cfg = getConfig();
  if (!cfg.activeInstanceId) setConfig({ activeInstanceId: instance.id });
  return instance;
}

function updateInstance(id, patch) {
  let updated = null;
  instancesStore.update((cur) => cur.map((i) => {
    if (i.id !== id) return i;
    updated = { ...i, ...patch };
    return updated;
  }));
  if (!updated) throw new Error('Unknown installation id.');
  return updated;
}

function deleteInstance(id) {
  const inst = getInstance(id);
  instancesStore.update((cur) => cur.filter((i) => i.id !== id));
  const cfg = getConfig();
  if (cfg.activeInstanceId === id) {
    const remaining = instancesStore.read();
    setConfig({ activeInstanceId: remaining[0] ? remaining[0].id : null });
  }
  if (inst && inst.separateFolder && !inst.customGameDir) {
    try { fs.rmSync(paths.instanceDir(id), { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
  return true;
}

function setActiveInstance(id) {
  if (!getInstance(id)) throw new Error('Unknown installation id.');
  setConfig({ activeInstanceId: id });
}

function getActiveInstance() {
  const cfg = getConfig();
  const list = instancesStore.read();
  return list.find((i) => i.id === cfg.activeInstanceId) || list[0] || null;
}

module.exports = {
  listInstances,
  getInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  setActiveInstance,
  getActiveInstance,
  gameDirFor,
};
