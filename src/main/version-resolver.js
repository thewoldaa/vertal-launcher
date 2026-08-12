'use strict';
/**
 * Every loader (vanilla, Fabric, Quilt, Forge, NeoForge) ends up as a
 * version JSON on disk under versionsDir. Loader profiles point back at
 * their vanilla base via `inheritsFrom`. This module walks that chain and
 * merges parent -> child into ONE fully-resolved version JSON that
 * game-files.js can download and launcher.js can build a launch command
 * from — so the rest of the app never needs to know which loader it's
 * dealing with.
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const mojangApi = require('./mojang-api');

function normalizeArguments(vj) {
  if (vj.arguments) {
    return { game: vj.arguments.game || [], jvm: vj.arguments.jvm || [] };
  }
  if (typeof vj.minecraftArguments === 'string') {
    return { game: vj.minecraftArguments.split(/\s+/).filter(Boolean), jvm: [] };
  }
  return { game: [], jvm: [] };
}

function mergeVersionJson(child, parent) {
  const childArgs = normalizeArguments(child);
  const parentArgs = normalizeArguments(parent);
  return {
    ...parent,
    ...child,
    id: child.id || parent.id,
    mainClass: child.mainClass || parent.mainClass,
    libraries: [...(child.libraries || []), ...(parent.libraries || [])],
    arguments: {
      jvm: [...parentArgs.jvm, ...childArgs.jvm],
      game: [...parentArgs.game, ...childArgs.game],
    },
    // These always come from the vanilla base — loader profiles don't redeclare them.
    downloads: parent.downloads,
    assetIndex: parent.assetIndex,
    assets: parent.assets,
    javaVersion: child.javaVersion || parent.javaVersion,
    logging: parent.logging,
  };
}

async function loadRawVersionJson(versionId) {
  const cachedPath = path.join(paths.versionDir(versionId), `${versionId}.json`);
  if (fs.existsSync(cachedPath)) {
    try {
      return JSON.parse(fs.readFileSync(cachedPath, 'utf-8'));
    } catch (e) { /* fall through and try refetching from mojang below */ }
  }
  // Only real Mojang version ids are fetchable this way; loader profiles
  // must already be cached to disk by their own install step.
  const raw = await mojangApi.getVersionJson(versionId);
  fs.mkdirSync(paths.versionDir(versionId), { recursive: true });
  fs.writeFileSync(cachedPath, JSON.stringify(raw, null, 2));
  return raw;
}

async function resolveChain(versionId, depth = 0) {
  if (depth > 5) throw new Error(`inheritsFrom chain too deep starting at ${versionId} — possible cycle.`);
  const raw = await loadRawVersionJson(versionId);
  if (raw.inheritsFrom) {
    const parent = await resolveChain(raw.inheritsFrom, depth + 1);
    return mergeVersionJson(raw, parent);
  }
  return { ...raw, arguments: normalizeArguments(raw) };
}

module.exports = { resolveChain, mergeVersionJson, normalizeArguments, loadRawVersionJson };
