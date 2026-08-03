# Dylandos Ultimate Credit Repair Suite — Windows (Electron) Technical Deep Dive

Version: 3.0.0
Date: 2026-04-06

This document explains the Windows (Electron) variant of the Dylandos Ultimate Credit Repair Suite. It covers architecture, packaging, runtime details, security guidance, and practical build instructions tailored for Windows desktop distribution.

---

## Table of contents

- Overview
- Key files and package scripts
- Electron main process and runtime choices
- Vite + bundle considerations for Electron
- Packaging with electron-builder (NSIS + portable)
- Release artifacts and layout
- Data persistence and IndexedDB in Electron
- AI & networking behavior on Windows
- Security hardening and recommended steps
- Developer commands and build steps
- Appendix & references

---

## Overview

- The Windows variant is an Electron shell that loads the same Vite-built React SPA used for Android (the `dist` folder).
- Electron glue code is lightweight and intentionally disables Node integration in the renderer to minimize risk; the app executes primarily as a standard web app inside a Chromium-based BrowserWindow.
- Packaging produces an installer (NSIS) and a portable build using `electron-builder`.

---

## Key files and package scripts

Primary entrypoints and scripts in `package.json`:

- `main`: `electron/main.cjs` — Electron entrypoint for Windows (and other desktop targets).
- `electron:dev`: runs a Vite dev server and launches Electron with `ELECTRON_IS_DEV=true`:

```bash
npm run electron:dev
# runs: concurrently --kill-others "vite --port=5173" "cross-env ELECTRON_IS_DEV=true electron electron/main.cjs"
```

- `build:electron` / `electron:build`: builds the web bundle with `BUILD_TARGET=electron` and then runs `electron-builder` with `electron-builder.json`:

```bash
npm run build:electron
npm run electron:build
# or one-liner: npm run electron:build (runs build:electron then electron-builder)
```

- `electron:debug`: builds and then launches electron with `ELECTRON_IS_DEV=true` for a build-with-devtools experience.

Dev dependency versions (notable):
- `electron` — v41.1.0
- `electron-builder` — v26.8.1

These versions are present in `package.json` `devDependencies` and should be kept in sync with your CI environment.

---

## Electron main process and runtime choices

File: `electron/main.cjs`

Important runtime choices and their impact:

- Hardware acceleration is disabled: `app.disableHardwareAcceleration()` — useful for avoiding GPU driver issues on certain Windows machines.
- BrowserWindow options:
  - `title` set to product name
  - `width: 1400`, `height: 900`, `minWidth`, `minHeight` — desktop-first sizing
  - `icon` points at `electron/icon.ico`
  - `backgroundColor` set to `#0a0a0a` to match the app theme
  - `show: false` and `win.once('ready-to-show', () => win.show())` — avoids white flash during load
  - `webPreferences`: `nodeIntegration: false`, `contextIsolation: true`, `webSecurity: true`, `sandbox: true` — strong renderer isolation defaults

- Security stance:
  - The app disables Node in the renderer, which significantly reduces the attack surface.
  - `contextIsolation: true` ensures `window` objects between preload and renderer are isolated.
  - `sandbox: true` further restricts renderer runtime rights where supported.

- External links:
  - `win.webContents.setWindowOpenHandler(...)` opens `http(s)` links in the system default browser (via `shell.openExternal`) and denies creating new windows within Electron. This avoids exposing remote content inside the app.

- Developer ergonomics:
  - `isDev` toggles `win.webContents.openDevTools({ mode: 'detach' })` in development builds.

Observations:
- There is no preload script and no explicit IPC channels visible in the main process; the app uses standard browser APIs for all features.
- Since Node integration is disabled, any features that require native access must be implemented as Capacitor/Electron native modules or via a preload/IPC shim if needed in the future.

---

## Vite + bundle considerations for Electron

- The app sets `BUILD_TARGET=electron` before building the web bundle for electron packaging. `vite.config.ts` toggles the `base` to `./` when `BUILD_TARGET==='electron'` to make asset references file:// friendly.
- Environment variables are injected at build time via the `define` option (e.g., `process.env.GEMINI_API_KEY` and `import.meta.env.VITE_GEMINI_API_KEY`). In Electron builds, this means any keys injected at build time will live inside the app bundle and can be extracted if the app is unpacked.

Recommendations:
- Avoid embedding sensitive runtime secrets at build-time. Prefer runtime secrets stored in OS-level secure stores or obtained from a server.
- Ensure `webSecurity: true` is left enabled (it is by default in this codebase) when loading local files to preserve CSP and same-origin protections.

---

## Packaging with electron-builder (NSIS + portable)

File: `electron-builder.json`

Key settings:

- `appId`: `com.dylandos.creditrepairsuite`
- `productName`: `Dylandos Ultimate Credit Repair Ultimate`
- `directories.output`: `release`
- `directories.buildResources`: `electron` (resources folder)
- `files`: `dist/**/*` and `electron/**/*` — includes the web bundle and the electron main script resources

Targets for `win`:
- `nsis` (installer) — arch `x64`
- `portable` — arch `x64`

NSIS configuration:
- `oneClick: false` — interactive installer
- `perMachine: false` — user-local install
- `allowToChangeInstallationDirectory: true`
- `createDesktopShortcut` and `createStartMenuShortcut` enabled
- `deleteAppDataOnUninstall: false` — preserves user data by default

Icon & execution level:
- `icon`: `electron/icon.ico` and `requestedExecutionLevel: 'asInvoker'`

Signing:
- `signAndEditExecutable: false` is set — not an active signing configuration
- For production builds, you should configure code signing (certificate / `cscLink` or `cscKeyPassword` env vars) to avoid Windows SmartScreen warnings and to enable automatic update code signing.

---

## Release artifacts and layout

By default the `release` directory will contain the built installer and unpacked app (when electron-builder completes). Typical outputs (from a completed build) include:

- `release/Dylandos Ultimate Credit Repair Ultimate Setup 3.0.0.exe` — NSIS installer (if built)
- `release/*.exe.blockmap` — blockmap used by differential update services
- `release/win-unpacked/` — the unpacked application directory (useful for debugging or test runs)
- `release/builder-effective-config.yaml` — effective electron-builder configuration used for the packaging run

Note: artifacts in `release/` can be large due to bundled Chromium resources.

---

## Data persistence and IndexedDB in Electron

- The renderer runs inside Chromium and uses the same IndexedDB APIs as the web variant.
- Database: `DYLANDOS_DB` (same schema as other platforms). Data persists inside the user profile folder for the app (typical path: `%LOCALAPPDATA%\Programs\<AppName>\user-data` or equivalent, managed by Electron/Chromium profile storage).
- Vault binary storage (ArrayBuffer) and app state are available locally in the electron bundle; encryption at rest is not implemented by default — consider encrypting Vault entries with a passphrase.

Backup and migration:
- `AppContext` exports `exportAllData()` and `importAllData()` to allow manual backup/restore workflows.

---

## AI & networking behavior on Windows

- The AI router (`src/services/aiRouter.ts`) uses `fetch()` to contact external providers (Groq, Gemini, OpenRouter). Requests originate from the renderer process and therefore use the device's network stack.

Implications on Windows:
- Embedding API keys into the build or storing them in `localStorage` on the desktop is insecure — a user or malware can extract them from the app bundle or from the rendered storage.
- If you want centralized billing, rate-limiting, or usage controls, consider routing AI requests through a server-side proxy that you control.

CORS/Network:
- Electron's renderer is not hindered by the browser extension ecosystem; however network calls still use HTTPS to provider endpoints.
- `win.webContents.setWindowOpenHandler` ensures external links open in the system browser, reducing exposed attack vectors inside the renderer.

---

## Security hardening and recommended steps (Windows)

1. Enable code signing for all release builds — obtain a code-signing certificate and configure `electron-builder` with `cscLink` or the CI-secured certificate path.
2. Add automatic update infrastructure (Squirrel/NuGet, or a hosted update server) if you want to support auto-updates. Configure signed update artifacts and a trusted update feed.
3. Move sensitive runtime secrets to a secure store. On Windows, consider using DPAPI-backed storage or the Windows Credential Manager accessible via native modules or preloads.
4. If adding native capabilities that require Node access, introduce a minimal `preload.js` and expose only carefully reviewed IPC channels to the renderer. Do not enable `nodeIntegration` in the renderer.
5. Consider packaging the PDF parsing worker and heavy AI orchestration behind a privileged process if you plan to store long-term secrets or want to sandbox network credentials from renderer code.

---

## Developer commands and build steps (Windows)

Local development (fast iteration):

```bash
# Start Vite dev server and Electron together (hot dev)
npm run electron:dev
```

Production build & package (produces `release/` artifacts):

```bash
# Build optimized web bundle for Electron
npm run build:electron
# Run electron-builder to produce installers
npm run electron:build
```

Debugging a production build with devtools open:

```bash
npm run electron:debug
```

Testing unpacked app (quick test):

```bash
# After electron-builder, run the unpacked app
release/win-unpacked/<app-exe>
```

CI notes:
- Build agents must have `electron` build prerequisites. On Windows runners, ensure `python`, `7zip`, and other dependency toolchain elements required by `electron-builder` are present.

---

## Appendix & references

- Electron main: [electron/main.cjs](electron/main.cjs#L1)
- Packaging config: [electron-builder.json](electron-builder.json#L1)
- Vite config (electron base handling + env injection): [vite.config.ts](vite.config.ts#L1)
- Index DB and app state: [src/services/indexedDB.ts](src/services/indexedDB.ts#L1)
- AI router & provider endpoints: [src/services/aiRouter.ts](src/services/aiRouter.ts#L1)
- Release artifacts directory: `release/` (populated by electron-builder)

---

End of Windows deep-dive.
