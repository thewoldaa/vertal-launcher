'use strict';
/**
 * Forge and NeoForge don't publish a ready-to-use launcher profile the way
 * Fabric/Quilt do — installing them means running Mojang/Forge's own
 * "installer processor" pipeline (binary-patching the vanilla jar, merging
 * mappings, etc.). Reimplementing that pipeline from scratch is a huge
 * amount of brittle, version-specific code, so Vertal Launcher takes the
 * same approach several other lightweight launchers use: download the
 * OFFICIAL installer jar Forge/NeoForge publish and run it headlessly with
 * `--installClient <dir>`, pointed at our own data directory (which already
 * uses the same versions/ + libraries/ layout Forge's installer expects).
 * After it finishes, we read back the version JSON it generated, exactly
 * like we do for Fabric/Quilt profiles.
 *
 * This is best-effort: Forge/NeoForge occasionally tweak their installer's
 * CLI flags between versions, so failures are surfaced with the installer's
 * own log output rather than swallowed.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const paths = require('./paths');
const { downloadFile, getJSON, get } = require('./downloader');

const FORGE_PROMOTIONS_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const FORGE_METADATA_URL = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const NEOFORGE_METADATA_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

async function getText(url) {
  const res = await get(url);
  const chunks = [];
  for await (const chunk of res) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf-8');
}

function parseVersionsFromMavenMetadata(xml) {
  const versions = [];
  const re = /<version>([^<]+)<\/version>/g;
  let m;
  while ((m = re.exec(xml))) versions.push(m[1]);
  return versions;
}

async function listForgeVersions(mcVersion) {
  const xml = await getText(FORGE_METADATA_URL);
  const all = parseVersionsFromMavenMetadata(xml);
  const prefix = `${mcVersion}-`;
  const matches = all.filter((v) => v.startsWith(prefix)).map((v) => v.slice(prefix.length));
  let recommended = null;
  try {
    const promos = await getJSON(FORGE_PROMOTIONS_URL);
    recommended = promos.promos[`${mcVersion}-recommended`] || promos.promos[`${mcVersion}-latest`] || null;
  } catch (e) { /* promotions feed is best-effort */ }
  return { versions: matches.reverse(), recommended };
}

/** NeoForge versions are "<mcMinor>.<mcPatch>.<build>", independent of the literal MC version string. */
function neoforgeVersionPrefix(mcVersion) {
  const parts = mcVersion.split('.'); // "1.21.1" -> ["1","21","1"]
  if (parts[0] !== '1') return null;
  const minor = parts[1];
  const patch = parts[2] || '0';
  return `${minor}.${patch}.`;
}

async function listNeoForgeVersions(mcVersion) {
  const prefix = neoforgeVersionPrefix(mcVersion);
  if (!prefix) return { versions: [], recommended: null };
  const xml = await getText(NEOFORGE_METADATA_URL);
  const all = parseVersionsFromMavenMetadata(xml);
  const matches = all.filter((v) => v.startsWith(prefix));
  return { versions: matches.reverse(), recommended: matches[matches.length - 1] || null };
}

function installerUrl(flavor, mcVersion, version) {
  if (flavor === 'forge') {
    return `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${version}/forge-${mcVersion}-${version}-installer.jar`;
  }
  return `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
}

function runInstaller(javaExe, installerJarPath, targetDir, flags, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(javaExe, ['-jar', installerJarPath, ...flags, targetDir], {
      cwd: path.dirname(installerJarPath),
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); onLog && onLog(d.toString()); });
    child.stderr.on('data', (d) => { out += d.toString(); onLog && onLog(d.toString()); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

/**
 * @param {'forge'|'neoforge'} flavor
 * @param {string} mcVersion
 * @param {string} version - forge/neoforge build version (not including the mc version prefix for forge)
 * @param {string} javaExe
 * @param {(state:object)=>void} onProgress
 * @returns {Promise<{id:string, versionJson:object}>}
 */
async function ensureInstalled(flavor, mcVersion, version, javaExe, onProgress) {
  const url = installerUrl(flavor, mcVersion, version);
  const installersDir = path.join(paths.dataRoot(), 'installers');
  fs.mkdirSync(installersDir, { recursive: true });
  const installerJarPath = path.join(installersDir, `${flavor}-${mcVersion}-${version}-installer.jar`);

  onProgress && onProgress({ phase: `Downloading ${flavor} installer`, pct: 0 });
  await downloadFile(url, installerJarPath, {
    onBytes: () => onProgress && onProgress({ phase: `Downloading ${flavor} installer`, pct: 50 }),
  });
  onProgress && onProgress({ phase: `Downloading ${flavor} installer`, pct: 100 });

  const before = new Set(fs.existsSync(paths.versionsDir()) ? fs.readdirSync(paths.versionsDir()) : []);
  const targetDir = paths.dataRoot();

  onProgress && onProgress({ phase: `Running ${flavor} installer (this can take a minute)`, pct: 0, indeterminate: true });

  let log = '';
  let result = await runInstaller(javaExe, installerJarPath, targetDir, ['--installClient'], (chunk) => { log += chunk; });
  if (result.code !== 0) {
    // Some installer builds use the dashed flag spelling instead.
    result = await runInstaller(javaExe, installerJarPath, targetDir, ['--install-client'], (chunk) => { log += chunk; });
  }

  const after = fs.existsSync(paths.versionsDir()) ? fs.readdirSync(paths.versionsDir()) : [];
  const newDirs = after.filter((d) => !before.has(d));

  if (result.code !== 0 && newDirs.length === 0) {
    const tail = log.split('\n').slice(-25).join('\n');
    throw new Error(`${flavor} installer exited with code ${result.code}.\n\nLast installer output:\n${tail}`);
  }

  let chosenId = newDirs.find((d) => d.toLowerCase().includes(flavor)) || newDirs[0];
  if (!chosenId) {
    // Installer may have silently no-op'd because it was already installed previously.
    const guess = flavor === 'forge' ? `${mcVersion}-forge-${version}` : `neoforge-${version}`;
    if (fs.existsSync(path.join(paths.versionsDir(), guess))) chosenId = guess;
  }
  if (!chosenId) {
    const tail = log.split('\n').slice(-25).join('\n');
    throw new Error(`${flavor} installer finished but no new version profile was found.\n\nLast installer output:\n${tail}`);
  }

  const jsonPath = path.join(paths.versionsDir(), chosenId, `${chosenId}.json`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`${flavor} installer reported success but ${chosenId}.json was not created.`);
  }
  const versionJson = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  onProgress && onProgress({ phase: `${flavor} installed`, pct: 100 });
  return { id: chosenId, versionJson };
}

module.exports = { listForgeVersions, listNeoForgeVersions, ensureInstalled, installerUrl };
