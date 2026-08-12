'use strict';
/**
 * Thin wrapper around Mojang's public, unauthenticated Piston Meta
 * endpoints. Nothing here requires a Microsoft/Mojang account — these are
 * the same public manifests every launcher (including the official one)
 * reads to know what versions exist and where to download them from.
 */
const { getJSON } = require('./downloader');

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const JAVA_RUNTIME_ALL_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

// Built-in fallback so the version picker is never empty when the network
// (or Mojang's CDN) is unreachable. Only real, published version ids.
const FALLBACK_VERSIONS = [
  '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2',
  '1.18.2', '1.17.1', '1.16.5', '1.15.2', '1.14.4', '1.13.2', '1.12.2',
  '1.11.2', '1.10.2', '1.9.4', '1.8.9', '1.7.10',
  '24w14potato', '23w13a_or_b', // real April Fools snapshots (toggle content offline)
].map((id) => ({
  id,
  type: /^1\.\d+\.\d+$/.test(id) || /^1\.\d+$/.test(id) ? 'release' : 'snapshot',
  url: null,
}));

function fallbackManifest() {
  return { latest: { release: '1.21.1', snapshot: '24w14potato' }, versions: FALLBACK_VERSIONS, offline: true };
}

let _manifestCache = null;
async function getVersionManifest(force = false) {
  if (_manifestCache && !force) return _manifestCache;
  try {
    _manifestCache = await getJSON(VERSION_MANIFEST_URL);
    return _manifestCache;
  } catch (e) {
    if (_manifestCache) return { ..._manifestCache, offline: true }; // stale-but-good
    return fallbackManifest();
  }
}

async function getVersionJson(versionId) {
  const manifest = await getVersionManifest();
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) throw new Error(`Unknown Minecraft version: ${versionId}`);
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
