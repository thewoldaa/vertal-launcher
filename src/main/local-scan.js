'use strict';
/**
 * local-scan.js — detect an EXISTING Minecraft installation (official
 * launcher layout) so Vertal can LINK to it instead of downloading:
 *
 *   <root>/versions/<id>/<id>.json     version metadata + client jar
 *   <root>/libraries/...               library jars (maven layout)
 *   <root>/assets/indexes|objects      assets
 *   <root>/launcher_profiles.json      profiles → gameDir + lastVersionId
 *
 * The folder the user picks may be the install root itself, a folder that
 * CONTAINS a .minecraft folder, or a game directory (config/, saves/,
 * mods/, options.txt) referenced by a profile in the appdata .minecraft —
 * e.g. "D:\minecraft 26.1.2-edisi-liburan-sekolah-2026-6-17" which is the
 * gameDir of a profile whose install lives in %APPDATA%\.minecraft.
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function isInstallRoot(dir) {
  return fs.existsSync(path.join(dir, 'versions')) && fs.statSync(path.join(dir, 'versions')).isDirectory();
}

function normalizePath(p) {
  if (!p) return '';
  return p.replace(/[\\/]+$/, '').toLowerCase();
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/** Detects the modloader from a version JSON's library list. */
function detectLoader(vj) {
  const libs = (vj.libraries || []).map((l) => (l && l.name) || '');
  const find = (re) => libs.find((n) => re.test(n));
  const fabric = find(/^net\.fabricmc:fabric-loader:/);
  if (fabric) return { loader: 'fabric', loaderVersion: fabric.split(':')[2] || null };
  const quilt = find(/^org\.quiltmc:quilt-loader:/);
  if (quilt) return { loader: 'quilt', loaderVersion: quilt.split(':')[2] || null };
  const neo = find(/^net\.neoforged:neoforge:/);
  if (neo) return { loader: 'neoforge', loaderVersion: neo.split(':')[2] || null };
  const forge = find(/^net\.minecraftforge:forge:/);
  if (forge) {
    // "net.minecraftforge:forge:1.21.1-52.0.16" — version is the loader build after the dash.
    const ver = forge.split(':')[2] || '';
    return { loader: 'forge', loaderVersion: ver.includes('-') ? ver.split('-').slice(1).join('-') : ver };
  }
  return { loader: 'vanilla', loaderVersion: null };
}

/** Walks the inheritsFrom chain (within the same install root) to the base vanilla id. */
function baseVersionOf(vj, root) {
  let cur = vj;
  let depth = 0;
  while (cur && cur.inheritsFrom && depth < 8) {
    const parentPath = path.join(root, 'versions', cur.inheritsFrom, `${cur.inheritsFrom}.json`);
    if (!fs.existsSync(parentPath)) break;
    cur = readJsonSafe(parentPath);
    if (!cur) break;
    depth++;
  }
  return cur && cur.id ? cur.id : (vj.inheritsFrom || vj.id || null);
}

function readProfiles(root) {
  const file = path.join(root, 'launcher_profiles.json');
  const data = readJsonSafe(file);
  if (!data || !data.profiles) return [];
  return Object.entries(data.profiles)
    .filter(([, p]) => p && typeof p === 'object')
    .map(([id, p]) => ({
      id,
      name: p.name || id,
      gameDir: p.gameDir || null,
      lastVersionId: p.lastVersionId || null,
      icon: p.icon || null,
      resolution: p.resolution || null,
    }));
}

/** Lists every version in <root>/versions/<id>/<id>.json with loader/base info. */
function scanVersions(root) {
  const versionsDir = path.join(root, 'versions');
  if (!fs.existsSync(versionsDir)) return [];
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(versionsDir); } catch (e) { return []; }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const dir = path.join(versionsDir, entry);
    if (!fs.statSync(dir).isDirectory()) continue;
    const jsonPath = path.join(dir, `${entry}.json`);
    if (!fs.existsSync(jsonPath)) continue;
    const vj = readJsonSafe(jsonPath);
    if (!vj || !vj.id) continue;
    const { loader, loaderVersion } = detectLoader(vj);
    const assetIndexId = vj.assetIndex && vj.assetIndex.id ? vj.assetIndex.id : null;
    out.push({
      id: vj.id,
      inheritsFrom: vj.inheritsFrom || null,
      baseVersion: baseVersionOf(vj, root),
      loader,
      loaderVersion,
      mainClass: vj.mainClass || null,
      hasJar: fs.existsSync(path.join(dir, `${entry}.jar`)),
      hasAssetIndex: !!(assetIndexId && fs.existsSync(path.join(root, 'assets', 'indexes', `${assetIndexId}.json`))),
      hasLibraries: fs.existsSync(path.join(root, 'libraries')),
    });
  }
  // Most usable first: has jar + asset index, then has jar, then anything.
  const score = (v) => (v.hasJar ? 2 : 0) + (v.hasAssetIndex ? 1 : 0);
  return out.sort((a, b) => score(b) - score(a) || b.id.localeCompare(a.id, 'en'));
}

function pickPreferred(root, versions, profiles, linkedGameDir) {
  const wantDir = linkedGameDir ? normalizePath(linkedGameDir) : null;
  const byDir = profiles.find((p) => p.lastVersionId && wantDir && normalizePath(p.gameDir) === wantDir);
  const byId = byDir ? versions.find((v) => v.id === byDir.lastVersionId) : null;
  if (byId) return byId;
  const anyProfile = profiles.find((p) => p.lastVersionId);
  if (anyProfile) {
    const hit = versions.find((v) => v.id === anyProfile.lastVersionId);
    if (hit) return hit;
  }
  return versions[0] || null;
}

/**
 * Scans an arbitrary folder the user points at.
 * @returns {object} {ok:true, kind, root, gameDir, name, versions, profiles, preferred}
 *                   or {ok:false, message}
 */
function scanFolder(folder) {
  const req = path.resolve(String(folder || '').trim());
  if (!req || !fs.existsSync(req)) return { ok: false, message: 'The folder does not exist.' };
  if (!fs.statSync(req).isDirectory()) return { ok: false, message: 'Not a folder.' };

  let root = null;
  let kind = 'install';
  let gameDir = null;

  if (isInstallRoot(req)) {
    root = req;
  } else if (isInstallRoot(path.join(req, '.minecraft'))) {
    root = path.join(req, '.minecraft');
  } else {
    // Not an install root — maybe a game directory referenced by a profile.
    const appdataMc = path.join(app.getPath('appData'), '.minecraft');
    if (isInstallRoot(appdataMc)) {
      const profiles = readProfiles(appdataMc);
      const want = normalizePath(req);
      const hit = profiles.find((p) => p.gameDir && normalizePath(p.gameDir) === want);
      if (hit) {
        root = appdataMc;
        kind = 'gameDir';
        gameDir = req;
      }
    }
    if (!root) {
      // A loose folder with version JSONs directly inside it.
      let direct = [];
      try {
        direct = fs.readdirSync(req)
          .filter((f) => f.endsWith('.json'))
          .map((f) => readJsonSafe(path.join(req, f)))
          .filter((v) => v && v.id && v.mainClass);
      } catch (e) { /* ignore */ }
      if (direct.length) {
        const { loader, loaderVersion } = detectLoader(direct[0]);
        return {
          ok: true,
          kind: 'direct',
          root: req,
          gameDir: null,
          name: path.basename(req),
          versions: [{
            id: direct[0].id,
            inheritsFrom: direct[0].inheritsFrom || null,
            baseVersion: direct[0].inheritsFrom || direct[0].id,
            loader,
            loaderVersion,
            mainClass: direct[0].mainClass,
            hasJar: fs.existsSync(path.join(req, `${direct[0].id}.jar`)) || fs.existsSync(path.join(req, direct[0].id, `${direct[0].id}.jar`)),
            hasAssetIndex: false,
            hasLibraries: fs.existsSync(path.join(req, 'libraries')),
          }],
          profiles: [],
          preferred: {
            id: direct[0].id,
            baseVersion: direct[0].inheritsFrom || direct[0].id,
            loader,
            loaderVersion,
          },
        };
      }
      return {
        ok: false,
        message: 'No Minecraft installation found here. Pick a folder with versions/ + libraries/ + assets/ (a .minecraft folder), or a game folder used by a launcher profile (e.g. "D:\\minecraft 26.1.2-...").',
      };
    }
  }

  const profiles = readProfiles(root);
  const versions = scanVersions(root);
  if (!versions.length) {
    return { ok: false, message: 'No version profiles found under versions/ in this folder.' };
  }
  const preferred = pickPreferred(root, versions, profiles, gameDir || req);

  // Name: the gameDir folder's basename reads best, else the profile name, else root basename.
  let name = null;
  if (kind === 'gameDir') {
    name = path.basename(gameDir);
  } else if (profiles.length) {
    const prof = profiles.find((p) => p.lastVersionId === (preferred && preferred.id)) || profiles[0];
    name = prof.name;
  }
  if (!name) name = path.basename(req);

  return {
    ok: true,
    kind,
    root,
    gameDir,
    name,
    hasLibraries: versions.some((v) => v.hasLibraries),
    versions,
    profiles,
    preferred,
  };
}

module.exports = { scanFolder, detectLoader, baseVersionOf, scanVersions, readProfiles };
