'use strict';
/**
 * Resolves a working `java` executable for a given Minecraft version:
 *   1. A user-configured custom path (Settings > Java Executable Path) wins.
 *   2. A previously auto-downloaded Mojang runtime for the required
 *      component, if present on disk.
 *   3. Otherwise download the correct Mojang-provided JRE for this OS from
 *      the official java-runtime manifest (same runtimes the vanilla
 *      launcher itself downloads) and cache it under userData.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const paths = require('./paths');
const { getJavaRuntimeAll } = require('./mojang-api');
const { downloadQueue, getJSON } = require('./downloader');

function platformKey() {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === 'win32') {
    if (arch === 'arm64') return 'windows-arm64';
    if (arch === 'ia32') return 'windows-x86';
    return 'windows-x64';
  }
  if (plat === 'darwin') {
    return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  }
  if (plat === 'linux') {
    return arch === 'ia32' ? 'linux-i386' : 'linux';
  }
  return null;
}

function componentForVersion(versionJson) {
  if (versionJson.javaVersion && versionJson.javaVersion.component) {
    return versionJson.javaVersion.component;
  }
  return 'jre-legacy';
}

function javaExeInRuntimeDir(component) {
  const dir = paths.runtimeDir(component);
  // Mojang runtimes nest one extra folder level per component on some platforms
  // (e.g. <dir>/<component>/bin/java). Handle both layouts.
  const direct = path.join(dir, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(direct)) return direct;
  const nested = path.join(dir, component, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (fs.existsSync(nested)) return nested;
  const macNested = path.join(dir, component, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
  if (fs.existsSync(macNested)) return macNested;
  return null;
}

async function downloadRuntime(component, onProgress) {
  const plat = platformKey();
  if (!plat) throw new Error(`No Mojang Java runtime available for platform "${process.platform}/${process.arch}". Please set a custom Java path in Settings.`);

  const all = await getJavaRuntimeAll();
  const platEntry = all[plat];
  if (!platEntry || !platEntry[component] || !platEntry[component].length) {
    throw new Error(`No "${component}" runtime published for ${plat}. Please set a custom Java path in Settings.`);
  }
  const chosen = platEntry[component][0];
  const manifest = await getJSON(chosen.manifest.url);

  const destRoot = paths.runtimeDir(component);
  const tasks = [];
  const executableFiles = [];
  for (const [relPath, info] of Object.entries(manifest.files)) {
    if (info.type === 'directory') continue;
    if (info.type === 'link') continue; // symlinks are rare in Windows/most builds we care about; skip safely
    const dest = path.join(destRoot, relPath);
    tasks.push({
      url: info.downloads.raw.url,
      dest,
      sha1: info.downloads.raw.sha1,
      size: info.downloads.raw.size,
      label: relPath,
    });
    if (info.executable) executableFiles.push(dest);
  }

  await downloadQueue(tasks, {
    concurrency: 12,
    onProgress: (state) => onProgress && onProgress({ ...state, phase: `Downloading Java ${component}` }),
  });

  if (process.platform !== 'win32') {
    for (const f of executableFiles) {
      try { fs.chmodSync(f, 0o755); } catch (e) { /* best effort */ }
    }
  }

  const exe = javaExeInRuntimeDir(component);
  if (!exe) throw new Error(`Downloaded Java runtime "${component}" but could not locate the java executable afterwards.`);
  return exe;
}

function verifyJavaExecutable(exePath) {
  return new Promise((resolve) => {
    execFile(exePath, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(false);
      resolve(true);
    });
  });
}

/** Parse the major Java version from `java -version` output ("1.8.0_301" -> 8, "25.0.3" -> 25). */
function javaMajor(exePath) {
  return new Promise((resolve) => {
    execFile(exePath, ['-version'], { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) return resolve(0);
      const m = /version\s+"?(?:1\.)?(\d+)/.exec((stderr || stdout) || '');
      resolve(m ? parseInt(m[1], 10) : 1);
    });
  });
}

/** Locate a Java on the system: JAVA_HOME first, then the PATH (`where java`). */
function findSystemJava() {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const exeName = isWin ? 'java.exe' : 'java';
    if (process.env.JAVA_HOME) {
      const jh = path.join(process.env.JAVA_HOME, 'bin', exeName);
      if (fs.existsSync(jh)) return resolve(jh);
    }
    execFile(isWin ? 'where' : 'which', ['java'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const first = stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (!first) return resolve(null);
      // `where` prints "INFO: Could not find files..." when absent.
      if (isWin && !/\.exe$/i.test(first)) return resolve(null);
      resolve(first);
    });
  });
}

/**
 * @param {object} versionJson - the merged Mojang version JSON for the instance
 * @param {string|null} customJavaPath - config.javaPath override, if any
 * @param {(state:object)=>void} onProgress
 * @returns {Promise<string>} absolute path to a working java executable
 */
async function resolveJava(versionJson, customJavaPath, onProgress) {
  if (customJavaPath) {
    const ok = await verifyJavaExecutable(customJavaPath);
    if (ok) return customJavaPath;
    throw new Error(`The configured Java path does not seem to work: ${customJavaPath}`);
  }

  const component = componentForVersion(versionJson);
  const cached = javaExeInRuntimeDir(component);
  if (cached) return cached;

  // Offline-friendly fallback: a Java already on this machine (JAVA_HOME or
  // PATH) that satisfies the version's minimum. Mojang's java-runtime
  // manifest is frequently unreachable, and the user's own Java (often a
  // current OpenJDK) is a perfectly good launch JVM.
  const need = versionJson.javaVersion && versionJson.javaVersion.majorVersion;
  const sysJava = await findSystemJava();
  if (sysJava && (await verifyJavaExecutable(sysJava))) {
    const have = await javaMajor(sysJava);
    if (!need || have >= need) {
      return sysJava;
    }
    // Wrong major: fall through to the Mojang download (or clear error).
  }

  return downloadRuntime(component, onProgress);
}

module.exports = { resolveJava, platformKey, componentForVersion, verifyJavaExecutable, findSystemJava, javaMajor };
