# Vertal Launcher

An offline-first Minecraft launcher for Windows. Link an existing Minecraft folder and play right away — no re-downloading, no Microsoft account, no ads, no telemetry. Everything runs locally on your machine.

![License](https://img.shields.io/badge/license-GPL--3.0-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d6)
![Built with](https://img.shields.io/badge/built%20with-Electron-9cf)

## Why Vertal Launcher

Most launchers force you to re-download gigabytes of game files or log in with a Microsoft account. Vertal Launcher takes the opposite approach:

- **Link, don't download.** Point the launcher at an existing Minecraft installation folder (official launcher, SKLauncher, or any compatible layout) and it resolves everything locally — versions, libraries, assets, and the client jar. Zero downloads, even when Mojang's servers are down.
- **Private by design.** Offline accounts (no Microsoft login), no ads, no analytics, no tracking. Your data never leaves your computer.
- **Loader support.** Vanilla, Fabric and Quilt (500+ merged versions), plus Forge / NeoForge latest auto-detect.
- **Clean custom UI.** Dark, minimal, borderless design with per-instance custom icons — including your own icon on the Windows taskbar and installer.

## Features

| Feature | Description |
|---|---|
| Offline launch | Client jar resolved from your existing folder; system Java auto-detected (`JAVA_HOME` → `PATH`) with version verification before any download is attempted |
| Link existing folder | Use any compatible Minecraft directory as-is; game files are never copied or modified |
| Download & install | Classic flow to download a fresh instance when Mojang services are reachable |
| Merged versions | Fabric & Quilt version lists merged and deduplicated into one picker |
| Forge / NeoForge | "Latest (auto-detect)" support |
| RAM control | Per-instance or global RAM (default 4 GB, 256 MB steps); smart heap sizing (`-Xms`) so the game starts with the memory you set |
| Mod-friendly | Loads your existing mods folder as-is (tested with Sodium, Iris, Lithium, JEI, Xaero's) |
| Offline accounts | Multiple local profiles, no Microsoft auth required |
| Custom icons | Per-instance icon, taskbar app icon, and installer icon |
| One-flow installer | NSIS installer with a single setup page: data folder + profile name (optional), written to `setup.ini` and imported on first launch |
| Scrollable dialogs | Long forms and edit modals stay usable on small windows |

## Requirements

- Windows 10 / 11 (64-bit)
- Java 17+ recommended. If Java is missing, the launcher falls back to a detected system JVM (`JAVA_HOME` → `PATH`) and only attempts a runtime download when nothing is available and Mojang's services are reachable.
- An existing Minecraft installation (optional) — used by the link existing folder flow. Without one, use Download & install.

## Installation

1. Download `Vertal Launcher Setup 1.0.2.exe` from the [Releases](https://github.com/thewoldaa/vertal-launcher/releases) page
2. Run the installer (no administrator rights required)
3. On the setup page you can optionally set your data folder and profile name — the launcher will prefill them for you
4. Launch Vertal Launcher and create your first instance

The installer is fully offline: it does not contact any server during installation.

## Getting Started

### 1. Link an existing folder (recommended)

1. Instances → New Instance
2. Choose "Use existing folder" and pick your Minecraft directory (e.g. one created by the official launcher or SKLauncher)
3. The launcher auto-detects the game version and loader profile (e.g. Minecraft 26.1.2 + Fabric 0.19.3)
4. Set the memory you want (or leave Global) and click Launch

### 2. Download & install

1. Instances → New Instance → "Download & install"
2. Pick a version and loader from the pickers
3. The launcher downloads the version metadata, libraries and the client jar (requires Mojang services to be reachable)

### 3. Profiles & RAM

- Create multiple offline profiles (no Microsoft account needed)
- Set per-instance RAM or leave it on Global (managed in Settings — default 4 GB). The readout shows "Global (X GB from Settings)" so you always know what will be used

## Building from Source

### Prerequisites

- [Node.js](https://nodejs.org) 18+
- npm

### Commands

```bash
npm install          # install dependencies
npm start            # run the app in development mode
npm run pack         # build an unpacked Windows app (dist/win-unpacked)
npm run dist         # build the NSIS installer (dist/Vertal Launcher Setup <ver>.exe)
```

Note: on machines where the electron-builder `winCodeSign` cache fails without administrator rights, build with:

```bash
npx electron-builder --win -c.win.signAndEditExecutable=false
```

Custom icon embedding is handled automatically by `scripts/after-pack.js` (rcedit).

### Tests

```bash
node scripts/unit-test-launch-command.js   # unit tests for the launch command builder
npx electron scripts/integration-linked.js # integration test for the "link existing folder" flow
```

### Dev tools

- `scripts/cdp-eval.js <expression> [port]` — evaluate JavaScript in the running app via the Chrome DevTools Protocol (`--remote-debugging-port`)
- `scripts/cdp-screenshot.js <outfile.png>` — capture a screenshot of the running app

## Project Structure

```
vertal-launcher/
├── app/                    # Renderer: UI, views, styles
│   ├── index.html
│   ├── css/
│   └── js/                 # Views & modal logic
├── src/main/               # Main process modules
│   ├── launcher.js         # Launch command builder (RAM, Xms/Xmx, args)
│   ├── java-manager.js     # Java detection & verification (system fallback)
│   ├── game-files.js       # Version/library/assets resolution (offline-first)
│   ├── local-scan.js       # "Link existing folder" scanner
│   ├── version-resolver.js # Fabric/Quilt version merging & Forge auto-detect
│   ├── loader-fabric.js    # Fabric/Quilt loader handling
│   ├── loader-forge.js     # Forge latest auto-detect
│   ├── offline-auth.js     # Local offline profiles
│   └── ...                 # instances, mods, servers, downloader, mojang-api
├── build/installer.nsh     # NSIS installer custom page (data folder + profile)
├── scripts/                # Build hooks, tests, dev tools
└── package.json
```

## Technology

- [Electron](https://www.electronjs.org/) — desktop shell
- Vanilla HTML / CSS / JS — no frontend framework, small footprint
- [electron-builder](https://www.electronjs.org/docs/latest/tutorial/electron-builder) + NSIS — installer

## Supporting the Project

Vertal Launcher is free, open source, and ad-free. If it saves you time or bandwidth, consider supporting its development:

- Star the repository so others can find it
- Sponsor via GitHub using the Sponsor button on this repository's page
- Report bugs, suggest features, or open a pull request — all contributions are welcome

## Contributors

- CraftKal — creator & maintainer · [github.com/craftkal](https://github.com/craftkal)
- thewoldaa — maintainer · [github.com/thewoldaa](https://github.com/thewoldaa)

Contributions are welcome — open an [issue](https://github.com/thewoldaa/vertal-launcher/issues) or a pull request.

## License

[GNU General Public License v3.0](LICENSE) © 2026 CraftKal

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but without any warranty; see the `LICENSE` file for the full text.

---

Vertal Launcher is an independent project and is not affiliated with Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Synergies AB.
