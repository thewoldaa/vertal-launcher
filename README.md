# Vertal Launcher

An offline-first Minecraft launcher built with Electron. No Microsoft/Mojang
account, no sign-in screen — pick a username and play. Supports **Vanilla**,
**Fabric**, **Quilt**, **Forge** and **NeoForge**, with multiple named
installations, a mods manager, and a from-scratch download/launch engine
(no CurseForge/MultiMC/PrismLauncher dependency — this app talks to Mojang's
own servers directly).

Built for **CraftKal**.

---

## 1. What it does

- **Offline profiles** — a local username + deterministic UUID (the same
  algorithm Bukkit/Spigot/Paper use for `OfflinePlayer:<name>`), no account
  needed. Works for singleplayer, LAN, and offline-mode servers.
- **Installations** (instances) — each is a named Minecraft version + loader
  combo (e.g. "1.21.1 Fabric"), optionally with its own separate
  saves/mods/config folder.
- **Vanilla** — downloads client jar, libraries, natives, assets and the
  correct Java runtime straight from Mojang's public Piston Meta CDN (the
  same one the official launcher uses).
- **Fabric / Quilt** — resolved via their official meta APIs
  (`meta.fabricmc.net`, `meta.quiltmc.org`), which hand back a ready-to-use
  launch profile.
- **Forge / NeoForge** — installed by downloading the *official* installer
  jar and running it headlessly (`--installClient`). This is the same
  approach several other lightweight launchers use, since Forge's own
  install pipeline (binary-patching the client jar) is not something worth
  reimplementing from scratch. See **Known limitations** below.
- **Mods manager** — enable/disable/remove `.jar` files per installation,
  or drop new ones in via a file picker.
- **Server Manager (quick-play)** — save servers and jump straight in. Vertal
  appends `--server/--port` to the launch command (rule-gated for modern
  versions, with a fallback for legacy ones), so offline-mode servers work
  exactly like SKLauncher's server list — no Microsoft account required.
- **Display & Launch** — custom window resolution with a fullscreen toggle,
  and an option to close the launcher automatically once the game starts
  (`closeOnLaunch`).
- **Per-installation tuning** — each installation can override the RAM
  allocation and extra JVM args; leave them empty to inherit the global
  Settings values.
- **Settings** — RAM allocation, custom Java path (auto-downloads one if you
  don't set one), extra JVM args, window resolution/fullscreen,
  close-on-launch, light/dark theme.
- **First-run wizard** — language, a short EULA/terms screen, offline
  profile creation, and where game files should live on disk.

## 2. Requirements

- **Node.js 18+** (20 LTS recommended) and npm, to build/run the app itself.
- **Internet access** — the app itself doesn't ship Java or Minecraft; it
  downloads both on demand, the same way the official launcher does.
- You do **not** need Java pre-installed — Vertal downloads the correct
  Mojang-provided runtime automatically the first time you install a
  version, unless you point it at your own Java in Settings.

## 3. Running it

```bash
npm install
npm start
```

That's it — `npm start` boots the app in dev mode straight from source.

## 4. Building an installer

```bash
npm run pack   # unpacked build in dist/ — fastest way to smoke-test a real build
npm run dist   # full installer (NSIS on Windows by default — see package.json "build")
```

`package.json`'s `build` block targets Windows (NSIS) by default, with
Linux (AppImage) and macOS (dmg) also configured. Adjust
`build.win` / `build.linux` / `build.mac` in `package.json` if you want a
different target, and run `electron-builder` for the platform you're
packaging for (cross-compiling Windows installers from Linux/macOS needs
Wine — see the [electron-builder docs](https://www.electron.build/multi-platform-build)).

## 5. Project structure

```
main.js                 Electron entry point
preload.js               contextBridge — the only thing the renderer can call into main with

src/main/                 Main process (Node.js side)
  paths.js                 Where every file on disk lives (supports a user-chosen data root)
  store.js / config.js      Tiny JSON-file settings/accounts/instances store
  offline-auth.js           Offline profile + UUID generation
  instances.js               CRUD for named installations
  mods.js                    Per-instance mods folder management
  downloader.js              Concurrent download queue w/ sha1 verification + progress
  mojang-api.js               Piston Meta manifest / version JSON / Java runtime manifest
  java-manager.js             Resolves or auto-downloads a working `java`
  rules.js                    Shared Mojang {os, features} rule evaluator
  game-files.js                Downloads client jar + libraries + natives + assets for a resolved version
  loader-fabric.js             Fabric & Quilt profile resolution
  loader-forge.js              Forge & NeoForge version discovery + headless installer runner
  version-resolver.js           Merges a loader's `inheritsFrom` chain into one launchable version JSON
  launcher.js                    Builds the JVM/game launch command and spawns Minecraft
  servers.js                     Server list store (quick-play targets)
  window.js / ipc.js              Frameless window + all IPC channel handlers

scripts/
  unit-test-launch-command.js     Plain-Node unit tests for buildLaunchCommand (quick-play, resolution, logArg)
  cdp-eval.js / cdp-screenshot.js  Dev helpers: drive the running renderer over the DevTools protocol

app/                       Renderer (what you see)
  index.html                 Single-page shell — titlebar, sidebar, all views, wizard, modals
  css/                        tokens.css (design system), base.css, titlebar.css, layout.css, screens.css
  js/
    state.js, format.js, toast.js, router.js, play.js, installOverlay.js
    components/titlebar.js
    views/{home,versions,mods,settings,wizard,instanceModal,servers}.js
  assets/                    App icon + decorative background/block art
```

Everything on the renderer side is **plain ES modules — no bundler, no
framework**. `app/js/main.js` is the entry point loaded by `index.html`.

## 6. Where files are stored

By default, everything lives under Electron's per-OS `userData` directory
(`%APPDATA%/Vertal Launcher` on Windows, `~/Library/Application
Support/Vertal Launcher` on macOS, `~/.config/Vertal Launcher` on
Linux). During the first-run wizard you can point the **data folder**
(versions/libraries/assets/instances — the big stuff) at a different drive;
your settings/accounts/instances list always stays in the fixed OS location
so the app can find itself no matter what.

## 7. Known limitations / honest scope notes

- **Forge/NeoForge support is best-effort.** It shells out to the official
  installer jar rather than reimplementing Forge's install-processor
  pipeline. This works for the vast majority of versions but installer CLI
  flags have shifted slightly over Forge's lifetime (`--installClient` vs
  `--install-client`) — the code tries both. If an install fails, the raw
  installer log is surfaced in the error message.
- **Two fully-translated languages**: English and Bahasa Indonesia. The
  wizard only offers languages that are actually wired up end-to-end,
  rather than listing options that don't do anything.
- **Quick-play only works with offline-mode servers** (the same ones
  SKLauncher's server list targets). Servers that enforce Mojang/Microsoft
  session authentication will reject the offline profile — that's a
  server-side choice, not something a launcher can bypass.
- **No resource pack / shader pack manager yet** — drop them in the
  instance's `resourcepacks`/`shaderpacks` folder manually for now (`Open
  Folder` in Mods works for `mods/`; the same instance directory holds the
  others).
- **Linux arm64** has no Mojang-provided JRE — set a custom Java path in
  Settings on that platform.

## 8. Legal note

Vertal Launcher is an independent, unofficial tool — not produced or
endorsed by Mojang Studios or Microsoft. "Minecraft" is a trademark of
Mojang Synergies AB. The app only ever downloads publicly-served files from
Mojang's/Fabric's/Forge's own official servers (the same ones the official
launcher uses) and does not bypass any purchase requirement or copy
protection. Use of Minecraft through this launcher is still subject to
[Mojang's EULA](https://www.minecraft.net/en-us/eula) — see the in-app
terms screen shown on first run.
