# Windows Deep Dive — Dylandos Credit Repair Suite (Windows / Electron variant)

This document provides a comprehensive technical deep dive for the Windows/Electron variant of the
Dylandos Credit Repair Suite. It covers architecture, IPC, data encryption, build/packaging, AI
integration specifics, known failure modes (including paste/AI parsing problems), and recommended
fixes and tests for engineers to apply or automate.

---

## 1. Product identity and build stack

- Product name: "Dylandos Ultimate Credit Repair Ultimate"
- App ID: `com.dylandos.creditrepairsuite`
- Version: `4.0.0`
- Electron: `^41.1.0` (Chromium 131+ runtime)
- Build system: `electron-builder ^26.8.1`
- Frontend: React 19 + TypeScript 5.8 + Vite 6
- Installer: NSIS installer and portable executable bundles

Notes:
- Electron 41 is a modern runtime with good Web API support, but verify native module compatibility
  when upgrading Node/Electron versions.

---

## 2. High-level architecture

- Main process (`electron/main.cjs`): Node context, DPAPI access, file system, IPC handlers.
- Preload (`electron/preload.cjs`): `contextBridge` exposes minimal, vetted IPC surface to renderer.
- Renderer (Web UI): React SPA, IndexedDB, localStorage, calls to `window.electronAPI` for privileged ops.

Security pillars:
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` to limit attack surface
- Minimal IPC surface; every channel must validate inputs and sanitize file paths.

---

## 3. IPC contract and channels (canonical list)

API key management:
- `store-api-key(name, value)` — DPAPI-encrypted store (main) — validate `name` length and chars.
- `get-api-key(name)` — returns decrypted key or null.
- `remove-api-key(name)` — remove entry from the key store.

File operations:
- `open-file-dialog()` — return selected file paths, validate extensions.
- `read-file-as-base64(path)` — read and return base64; always verify `safeRelativePath()`.
- `save-file(options)` — accept UTF-8 or base64 payload; ensure target folder sanitized.

Vault operations:
- `vault:writeFile(name, data)` — write AES-256-encrypted file under vault.
- `vault:readFile(name)` — decrypt and return contents.
- `vault:listDirectory()` — return normalized listing.

Utility and notifications:
- `show-notification(title, body)` — Windows toast integration via `electron.Notification`.

All IPC handlers MUST:
1. Validate input types and lengths.
2. Normalize and sanitize paths via `safeRelativePath()`.
3. Restrict operations to app-owned directories only.

---

## 4. Data encryption and storage

Primary encryption mechanisms:
- DPAPI (`safeStorage` or `crypto` wrappers) to protect API keys and master secrets.
- AES-256 (app-managed master key) used to encrypt vault files; master key itself encrypted with DPAPI.

Storage paths (typical):
- App data: `%APPDATA%/dylandos-ultimate-credit-repair-ultimate/`
- Keys: `%APPDATA%/.../dylandos-keys.enc`
- Vault: `%APPDATA%/.../vault/`

Key handling notes:
- DPAPI availability can vary on headless/Server editions; implement a secure fallback and a clear
  warning in the UI if DPAPI is unavailable.

---

## 5. Build and packaging pipeline

Dev workflow:
- `npm run electron:dev` — runs Vite dev server and launches Electron connecting to it.

Production build steps (high-level):
1. `npm run build:electron` — Vite builds renderer for file:// consumption
2. `electron-builder` packs app into NSIS installer and portable executable

CI notes:
- Use code signing certificates if distributing widely; configure `win.signing` in `electron-builder.json`.
- Test installer on clean VM running Windows 10/11 for installer behavior and path privileges.

---

## 6. AI integration (Windows specifics)

AI providers are orchestrated by `src/services/aiRouter.ts`. Windows specifics:
- Desktop environment can run heavier local parsing (e.g., `pdfjs-dist`) before calling AI.
- Use `read-file-as-base64` to load user-uploaded PDFs in the main process then pass sanitized text to AI.

Provider roles and best practices:
- Use Gemini for largest-context parsing; pass reporter-split tokens rather than raw full-file when possible.
- Always mask PII before telemetry; only heuristics and hashes should be transmitted to external dev logs.

---

## 7. Known Windows-specific failure modes (including paste/AI parse issues)

Symptom 1: "AI returned no items. Try pasting a cleaner copy of your report."
- This indicates the parsing pipeline could not extract recognized structures from the provided text.

Symptom 2: Pasting text into the renderer UI results in no visible content.

Likely root causes:
1. Preload-to-renderer paste flow blocked or not exposed properly; clipboard APIs differ between
   `navigator.clipboard` and OS-level clipboard; tests should cover both.
2. Renderer sanitization removes input during controlled-component state update.
3. File-reading path uses `readFileAsBase64` then truncates or fails to convert to UTF-8 properly.

Reproduction checklist:
- Test paste into a simple text area in renderer; compare `document.execCommand('paste')` and `navigator.clipboard.readText()`.
- Read failing reports via `%APPDATA%` path and verify base64 -> UTF-8 decode roundtrip in main process.

Mitigations:
1. Implement a consistent paste handler in preload that tries both `navigator.clipboard.readText()` and
   a fallback IPC call to the main process that reads clipboard via native Win32 APIs.
2. Normalize text using NFKC and strip control characters before passing into AI parser.
3. Add a local fallback parser that runs simple regex detection for account lines, dates, and creditor names.

---

## 8. Example fixes (preload + renderer)

Preload (recommendation): expose secure `pasteText()` API that attempts multiple fallbacks.

Renderer: call `window.electronAPI.pasteText()` and set component state with returned sanitized text.

This reduces cross-platform paste discrepancies and centralizes sanitization.

---

## 9. PDF and text extraction best practices

- Use `pdfjs-dist` in main process or worker to extract text reliably from PDF attachments.
- Normalize extracted text: remove ligatures, fix hyphenation across line breaks, unify whitespace.
- Provide a preview pane showing the sanitized text before triggering AI parse so users can confirm.

---

## 10. Vault and file-system hygiene

Vault write pattern:
1. Encrypt file with AES-256 (master key)
2. Write to temporary file in vault folder
3. Atomically rename to final name to avoid partial-read corruption

Audit log design:
- Append-only `vault/audit.log` with timestamps, operation type, and actor ID hash (PII masked).

---

## 11. Performance and memory considerations

- Hidden BrowserWindow `printToPDF` race conditions: ensure `await page.waitForFunction()` on a selector
  signaling DOM ready before printing.
- For large imports, stream text to AI provider in chunks instead of a single massive prompt.

---

## 12. Testing checklist (Windows)

- [ ] Installer runs and app starts without admin privileges (asInvoker)
- [ ] Portable exe runs on second machine from USB
- [ ] DPAPI-encrypted keys persist across restarts
- [ ] PDF extraction -> sanitized text -> AI parse yields expected fields for sample reports
- [ ] Paste from common PDF readers (Adobe, Edge, Chrome) works and populates the paste input
- [ ] Print-to-PDF produces valid output on slow machines (use explicit render ready checks)
- [ ] Vault export and import produce byte-identical results after encryption/decryption

---

## 13. Quick triage steps for the user's reported paste/AI issues

1. Reproduce on a local dev build with developer tools open to observe console errors in renderer.
2. Run `navigator.clipboard.readText()` in the console to inspect raw clipboard contents.
3. Call `window.electronAPI.readFileAsBase64(path)` from the renderer console to validate file reading.
4. Add a temporary diagnostic endpoint to `main.cjs` that returns the `safeStorage.isEncryptionAvailable()` state.

---

## 14. Recommended patches (priority)

1. Add `paste` fallback API in preload to handle native clipboard reads.
2. Add `sanitizePaste()` normalization in a cross-platform helper module.
3. Add a small fallback parser (regex-based) that runs when the AI parser yields zero items.
4. Add unit and integration tests for paste, PDF-extract normalization, and AI failover logic.

---

## 15. Files to inspect and update when fixing paste/AI issues

- `electron/preload.cjs` — add `pasteText()` API
- `electron/main.cjs` — clipboard native fallback and safeStorage checks
- `src/services/geminiService.ts` — parsing heuristics and fallback regex
- `src/services/aiRouter.ts` — map empty results to fallback parsing flow and provide better error codes
- `src/components/UploadReport.tsx` — ensure paste handler updates React state and shows preview

---

End of Windows deep dive. Keep this file updated as the Electron or Node versions change and when
platform-specific bugs are fixed or new patterns are adopted.
Key storage on Windows:
- Primary: Electron `safeStorage` (DPAPI encryption)
- Fallback: localStorage (unencrypted, warned in UI)
- Keys queried via `SecureKeyService` → IPC → main process

## KNOWN WINDOWS-SPECIFIC ISSUES

1. **Hardware Acceleration**: Disabled globally (`app.disableHardwareAcceleration()`) due to GPU compatibility issues on some Windows machines. May reduce animation smoothness.
2. **DPAPI Availability**: `safeStorage.isEncryptionAvailable()` returns false on some Windows Server editions. Keys fall back to plaintext JSON files.
3. **PDF Generation**: Uses hidden BrowserWindow technique — occasional race condition on slow machines where content doesn't render before `printToPDF()` fires.
4. **File Path Encoding**: Windows paths with non-ASCII characters may break vault operations. `safeRelativePath()` normalizes but doesn't handle Unicode edge cases.
5. **Installer Size**: NSIS installer includes full Chromium (~120MB). Consider using delta updates for future releases.
6. **Auto-Update**: Not yet implemented. No `electron-updater` integrated. Users must manually download new releases.

## TESTING CHECKLIST

- [ ] NSIS installer runs without admin (asInvoker)
- [ ] Portable EXE runs from USB drive
- [ ] Credit report upload + AI parsing works
- [ ] DPAPI key storage persists across restarts
- [ ] Vault file encryption/decryption roundtrips
- [ ] PDF export generates valid letters
- [ ] AutoPilot V4 engine tab renders correctly
- [ ] Tray notifications fire on deadline alerts
- [ ] File dialog opens native Windows picker
- [ ] Export package creates valid ZIP
- [ ] App handles missing API keys gracefully
- [ ] No console errors on startup (production build)
- [ ] Memory usage under 400MB with 50+ items

## UPGRADE PATH

### To upgrade Electron:
```bash
npm install electron@latest
npm install electron-builder@latest
# Test: npm run electron:debug
# Build: npm run electron:build
```

### Vite/React upgrades:
```bash
npm install vite@latest @vitejs/plugin-react@latest react@latest react-dom@latest
# Rebuild: npm run build:electron
```

### Adding auto-update:
1. `npm install electron-updater`
2. Add update check in `main.cjs` after `app.whenReady()`
3. Configure `publish` in `electron-builder.json` (GitHub Releases recommended)
4. Add IPC channel for update progress UI

## CRITICAL FILES FOR WINDOWS FIXES

| File | Purpose |
|---|---|
| `electron/main.cjs` | Main process: all IPC, DPAPI, vault, window |
| `electron/preload.cjs` | Renderer API bridge (contextBridge) |
| `electron-builder.json` | Build config: NSIS, targets, signing |
| `vite.config.ts` | Build pipeline, base path, env injection |
| `package.json` | Scripts: electron:dev, electron:build, electron:debug |
| `src/services/secureKeyService.ts` | Cross-platform key abstraction |
| `src/services/aiRouter.ts` | AI cascade with provider failover |
| `src/services/geminiService.ts` | Credit report parser + letter gen |
| `src/services/vaultEncryptionService.ts` | AES-256 vault encryption (Web Crypto API) |
| `src/services/archiveService.ts` | Vault file archival (reports, letters) |
| `src/services/printService.ts` | PDF print orchestration |
| `src/context/AppContext.tsx` | Global state (IndexedDB + vault init) |
| `src/pages/Autopilot.tsx` | AutoPilot page (V1 + V2 engine bridge) |
| `src/components/AutoPilotDashboard.tsx` | V2 5-pass engine dashboard |
| `src/services/autoPilotEngineV2.ts` | 5-pass dispute engine core |

## NPM SCRIPTS REFERENCE

| Script | Command | Purpose |
|---|---|---|
| `dev` | `vite --port=3000 --host=0.0.0.0` | Web-only dev server |
| `build` | `vite build` | Web production build |
| `build:electron` | `cross-env BUILD_TARGET=electron vite build` | Electron production build |
| `electron:dev` | `concurrently vite + electron` | Dev mode with HMR |
| `electron:debug` | `build:electron + electron (dev flag)` | Test production bundle |
| `electron:build` | `build:electron + electron-builder` | Full release build |
| `preview` | `vite preview` | Preview production build |
| `lint` | `tsc --noEmit` | TypeScript check |

## DEPENDENCY INVENTORY (WINDOWS-RELEVANT)

| Package | Version | Purpose |
|---|---|---|
| `electron` | ^41.1.0 | Desktop shell (Chromium + Node.js) |
| `electron-builder` | ^26.8.1 | Build NSIS installer + portable |
| `adm-zip` | ^0.5.17 | Vault export ZIP creation |
| `cross-env` | ^10.1.0 | Cross-platform env vars in scripts |
| `concurrently` | ^9.2.1 | Parallel dev server + Electron |
| `dotenv` | ^17.2.3 | Environment variable loading |
| `pdfjs-dist` | ^5.6.205 | PDF text extraction for parser |
| `html2pdf.js` | ^0.14.0 | HTML → PDF in renderer |
| `express` | ^4.21.2 | (Unused in Electron — web-only) |
