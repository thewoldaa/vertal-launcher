'use strict';
/**
 * Fabric and Quilt both expose the same "fabric-meta"-shaped HTTP API
 * (Quilt's is a fork of Fabric's), so one module drives both — only the
 * base URL differs.
 */
const path = require('path');
const fs = require('fs');
const { getJSON } = require('./downloader');
const paths = require('./paths');

const BASE = {
  fabric: 'https://meta.fabricmc.net/v2',
  quilt: 'https://meta.quiltmc.org/v3',
};

/** Lists loader versions available (for any game version) — used to find "latest stable". */
async function listLoaderVersions(flavor) {
  const base = BASE[flavor];
  if (!base) throw new Error(`Unknown loader flavor: ${flavor}`);
  return getJSON(`${base}/versions/loader`);
}

/** Lists loader builds compatible with a specific Minecraft version. */
async function listLoaderVersionsForGame(flavor, mcVersion) {
  const base = BASE[flavor];
  const encoded = encodeURIComponent(mcVersion);
  return getJSON(`${base}/versions/loader/${encoded}`);
}

async function pickLoaderVersion(flavor, mcVersion, requested) {
  const list = await listLoaderVersionsForGame(flavor, mcVersion);
  if (!list.length) throw new Error(`No ${flavor} loader builds found for Minecraft ${mcVersion}.`);
  if (requested && requested !== 'latest') {
    const match = list.find((e) => e.loader.version === requested);
    if (!match) throw new Error(`${flavor} loader ${requested} is not available for Minecraft ${mcVersion}.`);
    return match.loader.version;
  }
  const stable = list.find((e) => e.loader.stable !== false);
  return (stable || list[0]).loader.version;
}

/**
 * Downloads the ready-to-use launcher profile JSON for a given (mcVersion,
 * loaderVersion) pair, caches it to disk under versionsDir, and returns the
 * profile id + the raw JSON.
 */
async function ensureProfile(flavor, mcVersion, loaderVersion) {
  const base = BASE[flavor];
  const resolvedLoaderVersion = await pickLoaderVersion(flavor, mcVersion, loaderVersion);
  const encodedGame = encodeURIComponent(mcVersion);
  const encodedLoader = encodeURIComponent(resolvedLoaderVersion);
  const profile = await getJSON(`${base}/versions/loader/${encodedGame}/${encodedLoader}/profile/json`);

  const dir = paths.versionDir(profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2));

  return { id: profile.id, loaderVersion: resolvedLoaderVersion, profile };
}

module.exports = { listLoaderVersions, listLoaderVersionsForGame, pickLoaderVersion, ensureProfile };
