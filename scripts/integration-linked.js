// Integration test for the "link existing Minecraft folder" feature.
// Runs under real Electron (npx electron scripts/integration-linked.js).
// Uses the user's REAL installation — no network, no downloads.
'use strict';
const { app } = require('electron');

app.whenReady().then(async () => {
  try {
    const localScan = require('../src/main/local-scan');
    const versionResolver = require('../src/main/version-resolver');
    const gameFiles = require('../src/main/game-files');

    const GAME_DIR = 'D:/minecraft 26.1.2-edisi-liburan-sekolah-2026-6-17';
    const MC_ROOT = 'C:/Users/craftkal/AppData/Roaming/.minecraft';

    // 1) Scan the user's game folder (the exact example they gave)
    const scan = localScan.scanFolder(GAME_DIR);
    console.log('[1] scan gameDir:', JSON.stringify({
      ok: scan.ok, kind: scan.kind, root: scan.root, gameDir: scan.gameDir, name: scan.name,
      preferred: scan.preferred && { id: scan.preferred.id, base: scan.preferred.baseVersion, loader: scan.preferred.loader, ver: scan.preferred.loaderVersion },
      versionCount: scan.versions ? scan.versions.length : 0,
    }));

    // 2) Scan the install root directly
    const scan2 = localScan.scanFolder(MC_ROOT);
    console.log('[2] scan root:', JSON.stringify({
      ok: scan2.ok, kind: scan2.kind, preferred: scan2.preferred && scan2.preferred.id,
      versionCount: scan2.versions ? scan2.versions.length : 0,
      profileCount: scan2.profiles ? scan2.profiles.length : 0,
    }));

    // 3) Scan a bogus folder → must fail gracefully
    const scan3 = localScan.scanFolder('C:/Windows/System32');
    console.log('[3] scan bogus:', JSON.stringify({ ok: scan3.ok, message: scan3.message }));

    if (!scan.ok || !scan.root) { console.log('SKIP 4-5: no valid scan'); app.exit(1); return; }

    // 4) Resolve the full chain from the LINKED folder (no mojang fetch)
    const merged = await versionResolver.resolveChain('fabric-loader-0.19.3-26.1.2', { sourceDir: scan.root });
    console.log('[4] merged:', JSON.stringify({
      id: merged.id, mainClass: merged.mainClass,
      libs: (merged.libraries || []).length,
      client: merged.downloads && merged.downloads.client && merged.downloads.client.path,
      assetIndex: merged.assetIndex && merged.assetIndex.id,
    }));

    // 5) Materialize from the linked folder (verify, no download — except the
    //    client jar, which this install does not have and Mojang is down for)
    try {
      const mat = await gameFiles.ensureLinkedGameFiles(merged, scan.root, scan.gameDir, (s) => console.log('  ..progress:', s.phase, s.pct));
      console.log('[5] materialized:', JSON.stringify({
        classpathN: mat.classpath.length,
        clientJar: mat.clientJarPath,
        clientExists: require('fs').existsSync(mat.clientJarPath),
        assetsRoot: mat.assetsRoot,
        index: mat.assetIndexId,
        logArg: mat.logArg ? 'set' : 'null',
        firstCp: mat.classpath[0],
      }));
    } catch (e) {
      console.log('[5] materialize EXPECTED-FAIL:', JSON.stringify({ message: e.message }));
    }

    // 5b) planLibraries must NOT crash on the new format (no artifact.path)
    const { planLibraries, mavenNameToPath } = require('../src/main/game-files');
    const plan = planLibraries(merged, { librariesDir: require('path').join(scan.root, 'libraries') });
    console.log('[5b] planLibraries:', JSON.stringify({ cp: plan.classpathTasks.length, nat: plan.nativeTasks.length, first: plan.classpathTasks[0] && plan.classpathTasks[0].dest }));

    // 6) Negative: linked folder that is NOT used by any profile
    const scanBad = localScan.scanFolder('C:/Windows');
    console.log('[6] scan junk:', JSON.stringify({ ok: scanBad.ok, message: scanBad.message }));

    app.exit(0);
  } catch (e) {
    console.error('TEST FAIL:', e.message);
    console.error(e.stack);
    app.exit(1);
  }
});