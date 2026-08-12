'use strict';
/**
 * Thin wrapper around Mojang's public, unauthenticated Piston Meta
 * endpoints. Nothing here requires a Microsoft/Mojang account — these are
 * the same public manifests every launcher (including the official one)
 * reads to know what versions exist and where to download them from.
 */
const { getJSON } = require('./downloader');
const fs = require('fs');
const path = require('path');
const P = require('./paths');

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_RUNTIME_ALL_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

// Last-known-good manifest cached to disk: keeps the version list "auto-updated"
// to the latest releases even when the network is down at launch. Fallback
// order is network → disk cache → built-in list.
function manifestCacheFile() { return path.join(P.root(), 'version-manifest.json'); }
function readCachedManifest() {
  try {
    const m = JSON.parse(fs.readFileSync(manifestCacheFile(), 'utf8'));
    return m && m.latest && Array.isArray(m.versions) ? m : null;
  } catch { return null; }
}
function writeCachedManifest(m) {
  try { fs.writeFileSync(manifestCacheFile(), JSON.stringify(m)); } catch {}
}

// Built-in fallback so the version picker is never empty when the network
// (or Mojang's CDN) is unreachable. Only real, published version ids.
const FALLBACK_VERSIONS = [
  '26.2', '26.1', '26.0',
  '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4',
  '1.21.3', '1.21.2', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2',
  '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.13.2',
  '1.12.2', '1.11.2', '1.10.2', '1.9.4', '1.8.9', '1.7.10',
  '24w14potato', '23w13a_or_b', // real April Fools snapshots (toggle content offline)
].map((id) => ({
  id,
  type: /^1\.\d+\.\d+$/.test(id) || /^1\.\d+$/.test(id) || /^\d+\.\d+$/.test(id) ? 'release' : 'snapshot',
  url: null,
}));

function fallbackManifest() {
  return { latest: { release: '26.2', snapshot: '24w14potato' }, versions: FALLBACK_VERSIONS, offline: true };
}

// ---- Loader-version merge ------------------------------------------------
// Loader metas (Fabric/Quilt) list the exact Minecraft versions they support
// and are served from CDNs that are usually reachable even when Mojang's own
// manifest host is not. When the manifest can only come from the fallback
// (or disk cache), we union in the loader lists so the version picker still
// tracks the real, current releases — e.g. Fabric shipping support for a
// brand-new Minecraft version before this machine can reach piston-meta.
const LOADER_GAME_VERSION_URLS = [
  'https://meta.fabricmc.net/v2/versions/game',
  'https://meta.quiltmc.org/v3/versions/game',
];

function compareVersionId(a, b) {
  const ta = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const tb = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const da = ta[i] || 0;
    const db = tb[i] || 0;
    if (da !== db) return db - da; // descending
  }
  return b.localeCompare(a);
}

async function mergeLoaderVersions(manifest) {
  const seen = new Map(manifest.versions.map((v) => [v.id.toLowerCase(), v]));
  const added = [];

  await Promise.allSettled(LOADER_GAME_VERSION_URLS.map(async (url) => {
    let list;
    try { list = await getJSON(url); } catch { return; }
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const id = item && item.version;
      if (typeof id !== 'string' || !id) continue;
      const key = id.toLowerCase();
      if (seen.has(key)) continue;
      const type = /snapshot|pre|rc|^2[0-9]w/.test(id) ? 'snapshot' : 'release';
      seen.set(key, { id, type, url: null, fromLoader: true });
      added.push(seen.get(key));
    }
  }));

  if (!added.length) return manifest;

  const versions = [...manifest.versions, ...added].sort((a, b) => {
    const ra = a.type === 'release' ? 0 : 1;
    const rb = b.type === 'release' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return compareVersionId(a.id, b.id);
  });

  // If loaders already support a newer release than our (offline) manifest
  // knows about, present it as the latest.
  const newestRelease = versions.find((v) => v.type === 'release');
  return {
    ...manifest,
    versions,
    loaderMerged: true,
    latest: newestRelease
      ? { ...manifest.latest, release: newestRelease.id }
      : manifest.latest,
  };
}

let _manifestCache = null;
async function getVersionManifest(force = false) {
  if (_manifestCache && !force) return _manifestCache;
  try {
    _manifestCache = await getJSON(VERSION_MANIFEST_URL);
    writeCachedManifest(_manifestCache);
    return _manifestCache;
  } catch (e) {
    let m;
    if (_manifestCache) m = { ..._manifestCache, offline: true }; // this-session cache
    else {
      const cached = readCachedManifest();
      m = cached ? { ...cached, offline: true } : fallbackManifest(); // last-known-good / built-in
    }
    _manifestCache = await mergeLoaderVersions(m); // union with real Fabric/Quilt releases
    return _manifestCache;
  }
}

async function getVersionJson(versionId) {
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);
  if (!entry.url) {
    throw new Error(`Cannot install ${versionId}: the version manifest is offline. Connect to the internet and retry.`);
  }
  return getJSON(entry.url);
}

async function getLatestVersionId(type = 'release') {
  const manifest = await getVersionManifest();
  return type === 'snapshot' ? manifest.latest.snapshot : manifest.latest.release;
}

let _javaRuntimeAllCache = null;
async function getJavaRuntimeAll(force = false) {
  if (_javaRuntimeAllCache && !force) return _javaRuntimeAllCache;
  _javaRuntimeAllCache = await getJSON(JAVA_RUNTIME_ALL_URL);
  return _javaRuntimeAllCache;
}

module.exports = {
  VERSION_MANIFEST_URL,
  getVersionManifest,
  getVersionJson,
  getLatestVersionId,
  getJavaRuntimeAll,
};
