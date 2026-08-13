'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const paths = require('./paths');
const { getConfig } = require('./config');
const instances = require('./instances');
const { getActiveAccount } = require('./offline-auth');
const versionResolver = require('./version-resolver');
const gameFiles = require('./game-files');
const javaManager = require('./java-manager');
const loaderFabric = require('./loader-fabric');
const loaderForge = require('./loader-forge');
const { rulesAllow } = require('./rules');
const servers = require('./servers');

/**
 * Feature flags passed into Mojang's rule evaluator. Vertal is an offline
 * launcher, so the demo/realms flags stay false — but custom resolution
 * and quick-play (server shortcuts) are real features, toggled on demand.
 */
function buildFeatureFlags({ server, resolution } = {}) {
  const hasCustomResolution = !!(resolution && (resolution.width || resolution.height || resolution.fullscreen));
  const hasQuickPlay = !!server;
  return {
    is_demo_user: false,
    has_custom_resolution: hasCustomResolution,
    has_quick_plays_support: hasQuickPlay,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: hasQuickPlay,
    is_quick_play_realms: false,
  };
}

/** Resolves the "top-level" version id for an instance, running loader setup if needed. */
async function ensureLoaderInstalled(instance, javaHintExe, onProgress) {
  if (instance.loader === 'vanilla') {
    return instance.mcVersion;
  }
  if (instance.loader === 'fabric' || instance.loader === 'quilt') {
    onProgress && onProgress({ phase: `Resolving ${instance.loader} loader`, pct: 0, indeterminate: true });
    const { id } = await loaderFabric.ensureProfile(instance.loader, instance.mcVersion, instance.loaderVersion);
    return id;
  }
  if (instance.loader === 'forge' || instance.loader === 'neoforge') {
    // Forge/NeoForge installers need a working `java` before they can run,
    // and they also expect the vanilla client jar/json to already exist.
    const vanillaMerged = await versionResolver.resolveChain(instance.mcVersion);
    const gameDir = instances.gameDirFor(instance);
    await gameFiles.ensureGameFiles(vanillaMerged, gameDir, onProgress);
    const javaExe = javaHintExe || await javaManager.resolveJava(vanillaMerged, getConfig().javaPath, onProgress);

    let version = instance.loaderVersion;
    if (!version || version === 'latest') {
      const list = instance.loader === 'forge'
        ? await loaderForge.listForgeVersions(instance.mcVersion)
        : await loaderForge.listNeoForgeVersions(instance.mcVersion);
      version = list.recommended || list.versions[0];
      if (!version) throw new Error(`No ${instance.loader} build found for Minecraft ${instance.mcVersion}.`);
    }

    const { id } = await loaderForge.ensureInstalled(instance.loader, instance.mcVersion, version, javaExe, onProgress);
    return id;
  }
  throw new Error(`Unknown loader: ${instance.loader}`);
}

/**
 * Downloads/verifies everything an instance needs to run, without launching it.
 * @returns {Promise<{merged:object, materialized:object, javaExe:string, gameDir:string, finalVersionId:string}>}
 */
async function installInstance(instanceId, onProgress) {
  const instance = instances.getInstance(instanceId);
  if (!instance) throw new Error('Unknown installation.');
  const cfg = getConfig();

  // ---- Linked installation: files already exist in the user's folder. ----
  // No loader install, no downloads — we resolve the version chain from the
  // linked folder and verify every file the launch command needs.
  if (instance.sourceDir) {
    onProgress && onProgress({ phase: 'Verifying linked installation', pct: 0, indeterminate: true });
    const finalVersionId = instance.resolvedVersionId || instance.mcVersion;
    const merged = await versionResolver.resolveChain(finalVersionId, { sourceDir: instance.sourceDir });
    const gameDir = instances.gameDirFor(instance);
    fs.mkdirSync(gameDir, { recursive: true });
    const materialized = await gameFiles.ensureLinkedGameFiles(merged, instance.sourceDir, gameDir, onProgress);
    const javaExe = await javaManager.resolveJava(merged, cfg.javaPath, onProgress);
    instances.updateInstance(instanceId, { resolvedVersionId: finalVersionId, installed: true });
    return { merged, materialized, javaExe, gameDir, finalVersionId };
  }

  const finalVersionId = await ensureLoaderInstalled(instance, null, onProgress);
  const merged = await versionResolver.resolveChain(finalVersionId);
  const gameDir = instances.gameDirFor(instance);
  fs.mkdirSync(gameDir, { recursive: true });

  const materialized = await gameFiles.ensureGameFiles(merged, gameDir, onProgress);
  const javaExe = await javaManager.resolveJava(merged, cfg.javaPath, onProgress);

  instances.updateInstance(instanceId, { resolvedVersionId: finalVersionId, installed: true });

  return { merged, materialized, javaExe, gameDir, finalVersionId };
}

function resolveArgTokens(rawArgArray, featureFlags) {
  const out = [];
  for (const entry of rawArgArray || []) {
    if (typeof entry === 'string') { out.push(entry); continue; }
    if (entry && typeof entry === 'object') {
      if (!rulesAllow(entry.rules, featureFlags)) continue;
      if (Array.isArray(entry.value)) out.push(...entry.value);
      else if (typeof entry.value === 'string') out.push(entry.value);
    }
  }
  return out;
}

function substitute(tokens, map) {
  return tokens.map((tok) => tok.replace(/\$\{([a-zA-Z_]+)\}/g, (m, key) => (key in map ? map[key] : m)));
}

function buildLaunchCommand({ instance, merged, materialized, gameDir, account, ramMB, extraJvmArgs, server, resolution }) {
  const classpath = materialized.classpath.join(path.delimiter);
  const fakeAccessToken = crypto.randomBytes(16).toString('hex');

  const res = resolution && (resolution.width || resolution.height || resolution.fullscreen)
    ? {
        width: Math.max(0, Math.round(Number(resolution.width) || 0)),
        height: Math.max(0, Math.round(Number(resolution.height) || 0)),
        fullscreen: !!resolution.fullscreen,
      }
    : null;

  const substitutions = {
    natives_directory: materialized.nativesDir,
    launcher_name: 'Vertal-Launcher',
    launcher_version: '1.0.0',
    classpath,
    library_directory: paths.librariesDir(),
    classpath_separator: path.delimiter,
    auth_player_name: account.username,
    username: account.username,
    version_name: merged.id,
    game_directory: gameDir,
    assets_root: materialized.assetsRoot,
    game_assets: path.join(gameDir, 'resources'),
    assets_index_name: materialized.assetIndexId,
    auth_uuid: account.uuidDashless,
    uuid: account.uuidDashless,
    auth_access_token: fakeAccessToken,
    accessToken: fakeAccessToken,
    auth_xuid: '',
    clientid: '',
    user_type: 'legacy',
    version_type: merged.type || instance.versionType || 'release',
    user_properties: '{}',
    // Custom resolution (rule-gated in the version JSON).
    resolution_width: res ? String(res.width || 0) : '0',
    resolution_height: res ? String(res.height || 0) : '0',
    fullscreen_width: res ? String(res.width || 0) : '0',
    fullscreen_height: res ? String(res.height || 0) : '0',
    // Quick-play (rule-gated in the version JSON).
    server_address: server ? server.address : '',
    server_port: server ? String(server.port) : '25565',
  };

  const featureFlags = buildFeatureFlags({ server, resolution: res });

  const rawJvm = resolveArgTokens(merged.arguments.jvm, featureFlags);
  const rawGame = resolveArgTokens(merged.arguments.game, featureFlags);

  const hasClasspathFlag = rawJvm.some((a) => a.includes('${classpath}'));
  const baselineJvm = [`-Xmx${ramMB}m`, `-Xms${Math.min(ramMB, 2048)}m`];
  const extra = (extraJvmArgs || '').split(/\s+/).filter(Boolean);
  const jvmTokens = hasClasspathFlag
    ? [...baselineJvm, ...extra, ...rawJvm]
    : [...baselineJvm, ...extra, '-Djava.library.path=${natives_directory}', '-cp', '${classpath}', ...rawJvm];

  if (materialized.logArg) jvmTokens.push(materialized.logArg);

  const jvmArgs = substitute(jvmTokens, substitutions);
  const gameArgs = substitute(rawGame, substitutions);

  // Fallbacks for versions whose JSON has no quick-play/resolution rules:
  // older MC (pre-1.16ish) ignores unknown args anyway, and newer ones
  // usually declare them — so these are only appended when missing.
  if (server) {
    const hasServerArg = gameArgs.some((a) => a === '--server');
    if (!hasServerArg) gameArgs.push('--server', server.address, '--port', String(server.port));
  }
  if (res) {
    const hasFullscreen = gameArgs.includes('--fullscreen');
    if (res.fullscreen) {
      if (!hasFullscreen) gameArgs.push('--fullscreen');
      // Avoid emitting a 0x0 windowed size when going fullscreen without an
      // explicit resolution — the game will use the monitor instead.
      for (const flag of ['--width', '--height']) {
        const idx = gameArgs.indexOf(flag);
        if (idx !== -1 && String(gameArgs[idx + 1]) === '0') gameArgs.splice(idx, 2);
      }
    } else if (res.width && res.height) {
      if (!gameArgs.includes('--width')) gameArgs.push('--width', String(res.width));
      if (!gameArgs.includes('--height')) gameArgs.push('--height', String(res.height));
    }
  }

  return { jvmArgs, gameArgs, mainClass: merged.mainClass };
}

const runningProcesses = new Map(); // instanceId -> { proc, startedAt }

function isRunning(instanceId) {
  return runningProcesses.has(instanceId);
}

async function launchInstance(instanceId, { onProgress, onLog, onExit, server } = {}) {
  if (runningProcesses.has(instanceId)) {
    throw new Error('This installation is already running.');
  }
  // Reserve the slot synchronously — the install/merge below is async, so two
  // rapid Play clicks would otherwise both pass the guard and spawn two JVMs.
  const guard = { starting: true, proc: null, startedAt: 0 };
  runningProcesses.set(instanceId, guard);
  let instance;
  try {
    instance = instances.getInstance(instanceId);
  if (!instance) throw new Error('Unknown installation.');
  const account = getActiveAccount();
  if (!account) throw new Error('No offline profile selected. Create one in Settings first.');

  const cfg = getConfig();
  const { merged, materialized, javaExe, gameDir } = await installInstance(instanceId, onProgress);

  const ramMB = instance.ramMBOverride || cfg.ramMB;
  const extraJvmArgs = instance.jvmArgsOverride || cfg.jvmArgs;

  const { jvmArgs, gameArgs, mainClass } = buildLaunchCommand({
    instance, merged, materialized, gameDir, account, ramMB, extraJvmArgs,
    server: server || null,
    resolution: cfg.resolution,
  });
  if (!mainClass) {
    throw new Error('This version has no main class — its JSON may be corrupt.');
  }

  fs.mkdirSync(gameDir, { recursive: true });

  const fullArgs = [...jvmArgs, mainClass, ...gameArgs];
    const proc = spawn(javaExe, fullArgs, {
      cwd: gameDir,
      windowsHide: false,
      // Start the game in its own process group and detach it from the
      // launcher's lifecycle: closing/quitting the launcher must NOT kill a
      // running game. unref() lets the launcher exit cleanly while the game
      // keeps running (stdio is piped, so no extra console window appears).
      detached: true,
    });
    proc.unref();
    const startedAt = Date.now();
    guard.proc = proc;
    guard.startedAt = startedAt;

  instances.updateInstance(instanceId, { lastPlayedAt: startedAt });
  if (server && server.id) {
    try { servers.recordPlayed(server.id); } catch (e) { /* best effort */ }
  }

  proc.stdout.on('data', (d) => onLog && onLog('stdout', d.toString()));
  proc.stderr.on('data', (d) => onLog && onLog('stderr', d.toString()));
  proc.on('error', (err) => {
    runningProcesses.delete(instanceId);
    onExit && onExit({ code: null, error: err.message });
  });
  proc.on('close', (code) => {
    runningProcesses.delete(instanceId);
    const elapsed = Date.now() - startedAt;
    const inst = instances.getInstance(instanceId);
    if (inst) instances.updateInstance(instanceId, { totalPlaytimeMs: (inst.totalPlaytimeMs || 0) + elapsed });
    onExit && onExit({ code, elapsedMs: elapsed });
  });

  return { pid: proc.pid, versionId: merged.id };
  } catch (err) {
    // Install/merge/spawn failed — release the reserved slot so a retry works.
    if (runningProcesses.get(instanceId) === guard) runningProcesses.delete(instanceId);
    throw err;
  }
}

function killInstance(instanceId) {
  const entry = runningProcesses.get(instanceId);
  if (!entry) return false;
  if (entry.proc) entry.proc.kill();
  return true;
}

module.exports = { installInstance, launchInstance, killInstance, isRunning, buildLaunchCommand, buildFeatureFlags };
