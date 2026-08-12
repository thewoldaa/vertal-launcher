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

let _manifestCache = null;
async function getVersionManifest(force = false) {
  if (_manifestCache && !force) return _manifestCache;
  _manifestCache = await getJSON(VERSION_MANIFEST_URL);
  return _manifestCache;
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
