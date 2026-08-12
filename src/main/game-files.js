'use strict';
/**
 * Given a fully-RESOLVED version JSON (vanilla, or vanilla merged with a
 * Fabric/Quilt/Forge/NeoForge profile — see version-resolver.js), this
 * module downloads everything needed to actually run the game:
 *   - the client jar
 *   - every applicable library (filtered by OS rules)
 *   - native libraries extracted from classifier jars (legacy LWJGL2 versions)
 *   - the asset index + every referenced asset object
 *   - the log4j2 config file, if the version ships one
 *
 * Everything is content-addressed and sha1-checked, so re-running this for
 * an already-installed version is a fast no-op pass.
 */
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const paths = require('./paths');
const { downloadQueue, downloadFile, getJSON } = require('./downloader');
const { rulesAllow } = require('./rules');

function mavenNameToPath(name) {
  // "group.id:artifact:version" or "group.id:artifact:version:classifier"
  const parts = name.split(':');
  if (parts.length < 3) throw new Error(`Malformed maven coordinate: ${name}`);
  const [group, artifact, version, classifier] = parts;
  const groupPath = group.replace(/\./g, '/');
  const fileBase = classifier ? `${artifact}-${version}-${classifier}` : `${artifact}-${version}`;
  return `${groupPath}/${artifact}/${version}/${fileBase}.jar`;
}

/** Newer Mojang version JSONs omit artifact `path` — derive the relative
 * library path from the download URL (strip scheme + host), falling back
 * to the maven coordinate when the URL is unparseable. */
function deriveRelPath(url, name) {
  const m = /^https?:\/\/[^/]+\/(.+)$/.exec(url || '');
  if (m && m[1] && !m[1].includes('..')) return m[1];
  return mavenNameToPath(name);
}

/**
 * Resolves the list of classpath libraries + any natives-jar extraction
 * tasks for a resolved version JSON's `libraries` array.
 */
function planLibraries(versionJson, opts = {}) {
  const librariesDir = (opts && opts.librariesDir) || paths.librariesDir();
  const classpathTasks = [];   // { url, dest, sha1, size, label } + absPath for classpath
  const nativeTasks = [];      // same shape, plus `extractExclude`
  const seen = new Set();

  for (const lib of versionJson.libraries || []) {
    if (lib.rules && !rulesAllow(lib.rules)) continue;

    // Modern Mojang-format library with a direct downloadable artifact.
    if (lib.downloads && lib.downloads.artifact) {
      const art = lib.downloads.artifact;
      const rel = art.path || deriveRelPath(art.url, lib.name);
      const dest = path.join(librariesDir, rel);
      const key = 'cp:' + dest;
      if (!seen.has(key)) {
        seen.add(key);
        classpathTasks.push({ url: art.url, dest, sha1: art.sha1, size: art.size, label: path.basename(rel), absPath: dest });
      }
    } else if (lib.name && lib.url !== undefined) {
      // Simple maven-coordinate format used by Fabric/Quilt profile JSON.
      const relPath = mavenNameToPath(lib.name);
      const base = lib.url && lib.url.length ? lib.url : 'https://repo1.maven.org/maven2/';
      const url = base.replace(/\/?$/, '/') + relPath;
      const dest = path.join(librariesDir, relPath);
      const key = 'cp:' + dest;
      if (!seen.has(key)) {
        seen.add(key);
        classpathTasks.push({ url, dest, sha1: null, size: null, label: path.basename(relPath), absPath: dest });
      }
    } else if (lib.name && !lib.downloads) {
      // Bare maven coordinate with no explicit url — default to Maven Central.
      const relPath = mavenNameToPath(lib.name);
      const dest = path.join(librariesDir, relPath);
      const key = 'cp:' + dest;
      if (!seen.has(key)) {
        seen.add(key);
        classpathTasks.push({ url: 'https://repo1.maven.org/maven2/' + relPath, dest, sha1: null, size: null, label: path.basename(relPath), absPath: dest });
      }
    }

    // Legacy LWJGL2-style natives classifier jars (pre ~1.13).
    if (lib.natives) {
      const osKey = { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];
      const classifierKey = lib.natives[osKey];
      if (classifierKey && lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[classifierKey]) {
        const nat = lib.downloads.classifiers[classifierKey];
        const dest = path.join(librariesDir, nat.path);
        nativeTasks.push({
          url: nat.url,
          dest,
          sha1: nat.sha1,
          size: nat.size,
          label: path.basename(nat.path),
          exclude: (lib.extract && lib.extract.exclude) || ['META-INF/'],
        });
      }
    }
  }

  return { classpathTasks, nativeTasks };
}

function extractNatives(nativeTasks, nativesDir) {
  fs.mkdirSync(nativesDir, { recursive: true });
  for (const task of nativeTasks) {
    if (!fs.existsSync(task.dest)) continue;
    const zip = new AdmZip(task.dest);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const excluded = (task.exclude || []).some((pfx) => entry.entryName.startsWith(pfx));
      if (excluded) continue;
      const outPath = path.join(nativesDir, entry.entryName);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, entry.getData());
    }
  }
}

async function planAssets(versionJson) {
  const indexId = versionJson.assetIndex.id;
  const indexPath = path.join(paths.assetIndexesDir(), `${indexId}.json`);
  let index;
  if (fs.existsSync(indexPath)) {
    try { index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch (e) { index = null; }
  }
  if (!index) {
    index = await getJSON(versionJson.assetIndex.url);
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify(index));
  }

  const tasks = [];
  for (const [name, obj] of Object.entries(index.objects || {})) {
    const hash = obj.hash;
    const sub = hash.slice(0, 2);
    const dest = path.join(paths.assetObjectsDir(), sub, hash);
    tasks.push({
      url: `https://resources.download.minecraft.net/${sub}/${hash}`,
      dest,
      sha1: hash,
      size: obj.size,
      label: name,
    });
  }
  return { index, indexId, tasks, isVirtual: !!index.virtual, mapToResources: !!index.map_to_resources };
}

/** For legacy (pre-1.7) asset indexes, mirrors the flat hash store into <gameDir>/resources/<name>. */
function materializeLegacyAssets(index, gameDir) {
  const resourcesDir = path.join(gameDir, 'resources');
  for (const [name, obj] of Object.entries(index.objects || {})) {
    const hash = obj.hash;
    const src = path.join(paths.assetObjectsDir(), hash.slice(0, 2), hash);
    const dest = path.join(resourcesDir, name);
    if (!fs.existsSync(src)) continue;
    if (fs.existsSync(dest)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * Downloads/verifies everything the resolved version JSON needs.
 * @param {object} versionJson - fully-resolved (merged) version JSON
 * @param {string} gameDir - instance's game directory (for legacy asset mirroring)
 * @param {(state:object)=>void} onProgress
 * @returns {Promise<{classpath:string[], nativesDir:string, clientJarPath:string, assetsRoot:string, assetIndexId:string, logArg:string|null}>}
 */
async function ensureGameFiles(versionJson, gameDir, onProgress) {
  const versionId = versionJson.id;
  const versionDir = paths.versionDir(versionId);
  fs.writeFileSync(path.join(versionDir, `${versionId}.json`), JSON.stringify(versionJson, null, 2));

  const clientJarPath = path.join(versionDir, `${versionId}.jar`);
  const clientDl = versionJson.downloads && versionJson.downloads.client;

  const { classpathTasks, nativeTasks } = planLibraries(versionJson);
  const { index: assetIndex, indexId, tasks: assetTasks, isVirtual, mapToResources } = await planAssets(versionJson);

  const allTasks = [...classpathTasks, ...nativeTasks, ...assetTasks];
  if (clientDl) {
    allTasks.push({ url: clientDl.url, dest: clientJarPath, sha1: clientDl.sha1, size: clientDl.size, label: `${versionId}.jar` });
  }

  // Optional log4j2 config (present on most modern versions; avoids the
  // "no log4j2.xml" warning and, on older builds, the Log4Shell mitigation arg).
  let logArg = null;
  if (versionJson.logging && versionJson.logging.client) {
    const file = versionJson.logging.client.file;
    const logDest = path.join(versionDir, file.id);
    allTasks.push({ url: file.url, dest: logDest, sha1: file.sha1, size: file.size, label: file.id });
    logArg = versionJson.logging.client.argument.replace('${path}', logDest);
  }

  await downloadQueue(allTasks, {
    concurrency: 16,
    onProgress: (state) => onProgress && onProgress({ ...state, phase: 'Downloading game files' }),
  });

  const nativesDir = paths.nativesTmpDir(versionId);
  if (nativeTasks.length) extractNatives(nativeTasks, nativesDir);

  if (isVirtual || mapToResources) {
    materializeLegacyAssets(assetIndex, gameDir);
  }

  const classpath = [...classpathTasks.map((t) => t.absPath)];
  if (clientDl) classpath.push(clientJarPath);

  return {
    classpath,
    nativesDir,
    clientJarPath,
    assetsRoot: paths.assetsDir(),
    assetIndexId: indexId,
    logArg,
  };
}

/**
 * Materializes a LINKED installation — files already exist in the user's
 * own Minecraft folder (sourceDir). Nothing is re-downloaded except ONE
 * exception: a missing client jar is fetched into the profile dir (matching
 * the official launcher layout), which is exactly what the official
 * launcher does too. Every other classpath jar and the asset index are
 * verified to exist, and the legacy natives are extracted from the linked
 * libraries into Vertal's natives cache (the linked folder is otherwise
 * only ever READ).
 * @param {object} versionJson - fully-resolved (merged) version JSON
 * @param {string} sourceDir - install root (has versions/, libraries/, assets/)
 * @param {string} gameDir - instance's game directory (legacy asset mirroring)
 * @returns {Promise<{classpath:string[], nativesDir:string, clientJarPath:string, assetsRoot:string, assetIndexId:string, logArg:string|null}>}
 */
async function ensureLinkedGameFiles(versionJson, sourceDir, gameDir, onProgress) {
  const versionId = versionJson.id;

  // Client jar: as stored by the official launcher & SKLauncher, loader
  // profiles keep the vanilla client jar under
  // versions/<profile-id>/<profile-id>.jar (NOT under the base version
  // dir) — e.g. fabric-loader-0.19.3-26.1.2/fabric-loader-0.19.3-26.1.2.jar
  // is the full 38 MB Mojang client jar. Vanilla versions collapse to the
  // same path (versionId == baseId). Explicit clientDl.path (old-format
  // JSON) wins when present.
  let clientJarPath = null;
  const clientDl = versionJson.downloads && versionJson.downloads.client;
  const baseId = versionJson.baseId || versionId;
  if (clientDl && clientDl.path) {
    clientJarPath = path.join(sourceDir, 'versions', clientDl.path);
  } else {
    const profileJar = path.join(sourceDir, 'versions', versionId, `${versionId}.jar`);
    const baseJar = path.join(sourceDir, 'versions', baseId, `${baseId}.jar`);
    clientJarPath = fs.existsSync(profileJar) ? profileJar : baseJar;
  }
  // Where a missing client jar gets downloaded: always the profile dir,
  // matching the official layout so the next launch finds it instantly.
  const clientJarTarget = path.join(sourceDir, 'versions', versionId, `${versionId}.jar`);

  const libsDir = path.join(sourceDir, 'libraries');
  const { classpathTasks, nativeTasks } = planLibraries(versionJson, { librariesDir: libsDir });

  const missing = [];
  for (const task of classpathTasks) {
    if (!fs.existsSync(task.dest)) missing.push(task.label);
  }
  const clientMissing = !fs.existsSync(clientJarPath);
  const clientFetchable = !!(clientDl && clientDl.url);
  if (clientMissing && !clientFetchable) missing.push(path.basename(clientJarPath));
  if (missing.length) {
    throw new Error(
      `The linked installation is missing ${missing.length} file(s) (e.g. ${missing.slice(0, 6).join(', ')}). ` +
      'The folder may be incomplete — check it, or create a normal (download) installation instead.'
    );
  }

  onProgress && onProgress({ phase: 'Verifying linked installation', pct: 5, indeterminate: true });

  // The client jar is the one file we may fetch (it is small and is the
  // official launcher's own behavior); everything else must already be local.
  if (clientMissing && clientFetchable) {
    onProgress && onProgress({ phase: 'Downloading missing client jar', pct: 10, indeterminate: true });
    try {
      fs.mkdirSync(path.dirname(clientJarTarget), { recursive: true });
      await downloadFile(clientDl.url, clientJarTarget, { sha1: clientDl.sha1, size: clientDl.size });
      clientJarPath = clientJarTarget;
      onProgress && onProgress({ phase: 'Verifying linked installation', pct: 20, indeterminate: true });
    } catch (e) {
      throw new Error(
        `The linked folder is missing the client jar (${path.basename(clientJarTarget)}) and downloading it failed: ${e.message}`
      );
    }
  }

  // Assets: read the index from the linked folder; never download.
  const indexId = versionJson.assetIndex && versionJson.assetIndex.id;
  const indexPath = indexId ? path.join(sourceDir, 'assets', 'indexes', `${indexId}.json`) : null;
  if (!indexPath || !fs.existsSync(indexPath)) {
    throw new Error(`Asset index "${indexId || '?'}" was not found in the linked folder (${path.join(sourceDir, 'assets', 'indexes')}).`);
  }
  const assetIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const assetsRoot = path.join(sourceDir, 'assets');
  onProgress && onProgress({ phase: 'Verifying linked installation', pct: 30, indeterminate: true });

  // Legacy pre-1.7 virtual/resource indexes: mirror objects into <gameDir>/resources.
  if (assetIndex.virtual || assetIndex.map_to_resources) {
    const objectsDir = path.join(assetsRoot, 'objects');
    const resourcesDir = path.join(gameDir || sourceDir, 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });
    for (const [name, obj] of Object.entries(assetIndex.objects || {})) {
      const src = path.join(objectsDir, obj.hash.slice(0, 2), obj.hash);
      const dest = path.join(resourcesDir, name);
      if (!fs.existsSync(src) || fs.existsSync(dest)) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
  }

  // Natives: extract legacy classifier jars from the linked libraries into
  // Vertal's own cache (we never write into the linked folder).
  const nativesDir = paths.nativesTmpDir(versionId);
  if (nativeTasks.length) {
    const present = nativeTasks.filter((t) => fs.existsSync(t.dest));
    extractNatives(present, nativesDir);
  }
  onProgress && onProgress({ phase: 'Verifying linked installation', pct: 70, indeterminate: true });

  // Optional log4j2 config — the official launcher keeps it next to the
  // version json; skip the log argument when it is absent (harmless).
  let logArg = null;
  if (versionJson.logging && versionJson.logging.client) {
    const file = versionJson.logging.client.file;
    const logPath = path.join(sourceDir, 'versions', versionId, file.id);
    if (fs.existsSync(logPath)) {
      logArg = versionJson.logging.client.argument.replace('${path}', logPath);
    }
  }

  const classpath = [...classpathTasks.map((t) => t.absPath), clientJarPath];
  onProgress && onProgress({ phase: 'Ready', pct: 100 });

  return {
    classpath,
    nativesDir,
    clientJarPath,
    assetsRoot,
    assetIndexId: indexId,
    logArg,
  };
}

module.exports = { ensureGameFiles, ensureLinkedGameFiles, planLibraries, mavenNameToPath };
