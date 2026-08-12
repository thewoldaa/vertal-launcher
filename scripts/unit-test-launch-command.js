'use strict';
/**
 * Unit test for buildLaunchCommand / buildFeatureFlags in src/main/launcher.js.
 *
 * Runs in plain Node (no Electron): we stub the `electron` module (only
 * paths.js touches it, via app.getPath('userData')). Uses a mock merged
 * version JSON shaped like a modern release (rule-gated quick-play and
 * custom-resolution args), plus assertions for the fallback paths on
 * "old-style" version JSONs.
 *
 * Run: node scripts/unit-test-launch-command.js
 */
const path = require('path');
const os = require('os');
const fs = require('fs');

// ---- Stub electron before anything else is required ----
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vertal-test-'));
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => (name === 'userData' ? testRoot : path.join(testRoot, name)),
        getName: () => 'Vertal Launcher',
      },
    };
  }
  return origLoad.apply(this, arguments);
};

const { buildLaunchCommand, buildFeatureFlags } = require('../src/main/launcher.js');
const paths = require('../src/main/paths.js');
paths.setDataRootOverride(path.join(testRoot, 'data'));

// ---- Mock fixtures ----
const account = {
  username: 'CraftKal',
  uuid: '23b5f0f1-6a95-41dc-b5a1-23c8e42cfc61',
  uuidDashless: '23b5f0f16a9541dcb5a123c8e42cfc61',
};

const materialized = {
  classpath: ['C:\\libs\\a.jar', 'C:\\libs\\b.jar'],
  nativesDir: 'C:\\natives\\1.21',
  assetsRoot: 'C:\\assets',
  assetIndexId: '12',
  logArg: '-Dlog4j2.formatMsgNoLookups=true', // already substituted variant
};

const modernVersion = {
  id: '1.21',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  arguments: {
    game: [
      '--username', '${auth_player_name}', '--version', '${version_name}',
      '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}',
      '--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}',
      '--accessToken', '${auth_access_token}', '--userType', '${user_type}',
      '--versionType', '${version_type}',
      {
        rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
        value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
      },
      {
        rules: [{ action: 'allow', features: { has_quick_plays_support: true, is_quick_play_multiplayer: true } }],
        value: ['--server', '${server_address}', '--port', '${server_port}'],
      },
    ],
    jvm: [
      '-Djava.library.path=${natives_directory}', '-cp', '${classpath}',
      { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: ['-Ddemo=true'] },
      { rules: [{ action: 'allow', os: { name: 'windows' } }], value: ['-XX:+UseG1GC'] },
      { rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] },
    ],
  },
};

// Old-style version (1.12-ish): no rules, quick-play/resolution args absent.
const legacyVersion = {
  id: '1.12.2',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  arguments: {
    game: ['--username', '${auth_player_name}', '--version', '${version_name}'],
    jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
  },
};

const instance = { id: 'i1', name: 'Test', mcVersion: '1.21', loader: 'vanilla', versionType: 'release' };

function base(overrides = {}) {
  return { instance, merged: modernVersion, materialized, gameDir: 'C:\\gamedir', account, ramMB: 4096, extraJvmArgs: '', ...overrides };
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        → ' + detail : ''}`); }
}
function hasArg(args, token) { return args.some((a) => a === token); }

// ---- 1. Feature flags ----
console.log('\n[1] buildFeatureFlags');
{
  const none = buildFeatureFlags({ server: null, resolution: null });
  check('no server/res → all false', !none.has_quick_plays_support && !none.has_custom_resolution && !none.is_quick_play_multiplayer);
  const quick = buildFeatureFlags({ server: { id: 's1', address: 'mc.example.com', port: 25565 }, resolution: null });
  check('server → quick play flags on', quick.has_quick_plays_support && quick.is_quick_play_multiplayer);
  const res = buildFeatureFlags({ server: null, resolution: { width: 1280, height: 720, fullscreen: false } });
  check('resolution → has_custom_resolution on', res.has_custom_resolution);
}

// ---- 2. Plain launch, modern version ----
console.log('\n[2] modern version, no server / no resolution');
{
  const { jvmArgs, gameArgs, mainClass } = buildLaunchCommand(base());
  check('mainClass passed through', mainClass === 'net.minecraft.client.main.Main');
  check('ram flags present', jvmArgs.includes('-Xmx4096m'));
  check('no -Ddemo (is_demo_user=false)', !jvmArgs.includes('-Ddemo=true'));
  check('windows-only -XX:+UseG1GC present', jvmArgs.includes('-XX:+UseG1GC'));
  check('no -XstartOnFirstThread (osx rule)', !jvmArgs.includes('-XstartOnFirstThread'));
  check('logArg kept verbatim', jvmArgs.includes('-Dlog4j2.formatMsgNoLookups=true'));
  check('no --server', !hasArg(gameArgs, '--server'));
  check('no --width', !hasArg(gameArgs, '--width'));
  check('no --fullscreen', !hasArg(gameArgs, '--fullscreen'));
  check('no quick-play residue', !gameArgs.some((a) => a.includes('play.example')));
  check('uuid substituted', gameArgs.includes('23b5f0f16a9541dcb5a123c8e42cfc61'));
}

// ---- 3. Quick-play server (modern rules) ----
console.log('\n[3] server quick-play (modern rule-gated)');
{
  const { gameArgs } = buildLaunchCommand(base({ server: { id: 's1', address: 'play.example.com', port: 25565 } }));
  const iServer = gameArgs.indexOf('--server');
  check('--server present', iServer !== -1);
  check('address substituted', iServer !== -1 && gameArgs[iServer + 1] === 'play.example.com');
  const iPort = gameArgs.indexOf('--port');
  check('--port present + 25565', iPort !== -1 && gameArgs[iPort + 1] === '25565');
}

// ---- 4. Fallback quick-play (legacy version) ----
console.log('\n[4] server quick-play fallback (legacy version, no rules)');
{
  const { gameArgs } = buildLaunchCommand(base({ merged: legacyVersion, server: { id: 's1', address: '192.168.1.10', port: 25566 } }));
  const iServer = gameArgs.indexOf('--server');
  check('--server appended', iServer !== -1 && gameArgs[iServer + 1] === '192.168.1.10');
  const iPort = gameArgs.indexOf('--port');
  check('--port 25566', iPort !== -1 && gameArgs[iPort + 1] === '25566');
}

// ---- 5. Resolution windowed (modern rules) ----
console.log('\n[5] resolution 1280x720 (modern rule-gated)');
{
  const { gameArgs } = buildLaunchCommand(base({ resolution: { width: 1280, height: 720, fullscreen: false } }));
  const iW = gameArgs.indexOf('--width');
  check('--width present', iW !== -1 && gameArgs[iW + 1] === '1280');
  const iH = gameArgs.indexOf('--height');
  check('--height present', iH !== -1 && gameArgs[iH + 1] === '720');
  check('no --fullscreen', !hasArg(gameArgs, '--fullscreen'));
}

// ---- 6. Fullscreen (modern rules) ----
console.log('\n[6] fullscreen (modern rule-gated)');
{
  const { gameArgs } = buildLaunchCommand(base({ resolution: { width: 0, height: 0, fullscreen: true } }));
  check('--fullscreen present', hasArg(gameArgs, '--fullscreen'));
  check('no --width when fullscreen', !hasArg(gameArgs, '--width'));
  check('no 0x0 residue', !gameArgs.some((a, i) => (a === '--width' || a === '--height') && gameArgs[i + 1] === '0'));
}

// ---- 7. Fallback resolution (legacy version) ----
console.log('\n[7] resolution fallback (legacy version)');
{
  const { gameArgs } = buildLaunchCommand(base({ merged: legacyVersion, resolution: { width: 1024, height: 768, fullscreen: false } }));
  const iW = gameArgs.indexOf('--width');
  check('--width 1024 appended', iW !== -1 && gameArgs[iW + 1] === '1024');
  const iH = gameArgs.indexOf('--height');
  check('--height 768 appended', iH !== -1 && gameArgs[iH + 1] === '768');
}

// ---- 8. Server + resolution together ----
console.log('\n[8] server + resolution combined');
{
  const { gameArgs } = buildLaunchCommand(base({
    server: { id: 's1', address: 'mc.example.com', port: 25565 },
    resolution: { width: 1920, height: 1080, fullscreen: false },
  }));
  check('both --server and --width present', hasArg(gameArgs, '--server') && hasArg(gameArgs, '--width'));
  check('fullscreen absent', !hasArg(gameArgs, '--fullscreen'));
}

// ---- 9. Resolution null / 0 values do nothing ----
console.log('\n[9] zero/empty resolution is ignored');
{
  const { gameArgs } = buildLaunchCommand(base({ resolution: { width: 0, height: 0, fullscreen: false } }));
  check('no --width for 0x0', !hasArg(gameArgs, '--width'));
  check('no --fullscreen', !hasArg(gameArgs, '--fullscreen'));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES: ' + fail} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);