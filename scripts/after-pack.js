'use strict';
/**
 * afterPack hook — embeds the custom icon & version info into the app exe.
 *
 * Why: the build must run with -c.win.signAndEditExecutable=false
 * (winCodeSign fails to extract its toolchain on this machine), which also
 * skips electron-builder's rcedit step — leaving the DEFAULT Electron icon
 * and no version metadata on Vertal Launcher.exe. This hook re-applies the
 * icon + version strings right after packaging and BEFORE the NSIS bundle is
 * built, so the installer carries the fixed exe (exe, taskbar, shortcut and
 * window icons all come from appOutDir).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { packager, appOutDir } = context;
  const exeName = `${packager.appInfo.productFilename}.exe`;
  const exe = path.join(appOutDir, exeName);
  if (!fs.existsSync(exe)) {
    console.warn('[after-pack] exe not found:', exe);
    return;
  }

  // rcedit ships inside electron-builder's winCodeSign cache.
  const cacheRoot = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'winCodeSign');
  let rcedit = null;
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot).sort().reverse()) {
      const p = path.join(cacheRoot, dir, 'rcedit-x64.exe');
      if (fs.existsSync(p)) { rcedit = p; break; }
    }
  }
  if (!rcedit) {
    // Branding is a hard requirement for a released build — fail loudly
    // instead of silently shipping a default-Electron-icon exe.
    throw new Error('[after-pack] rcedit-x64.exe not found in winCodeSign cache — cannot embed icon/version');
  }

  const icon = path.join(packager.projectDir, 'build', 'icon.ico');
  if (!fs.existsSync(icon)) {
    console.warn('[after-pack] build/icon.ico not found — icon embedding skipped');
    return;
  }

  const ver = packager.appInfo.version || '1.0.0';
  const args = [
    exe,
    '--set-icon', icon,
    '--set-version-string', 'ProductName', packager.appInfo.productName || 'Vertal Launcher',
    '--set-version-string', 'FileDescription', packager.appInfo.productName || 'Vertal Launcher',
    '--set-version-string', 'InternalName', exeName,
    '--set-version-string', 'OriginalFilename', exeName,
    '--set-version-string', 'ProductVersion', ver,
    '--set-file-version', `${ver}.0`,
    '--set-product-version', `${ver}.0`,
  ];
  console.log(`[after-pack] rcedit: embedding ${path.basename(icon)} + v${ver} into ${exeName}`);
  execFileSync(rcedit, args, { stdio: 'inherit' });
  console.log('[after-pack] done');
};