# Dylandos Ultimate Credit Repair Suite — Android Technical Deep Dive

Version: 3.0.0
Date: 2026-04-06

This document is a technical deep dive into the Android variant of the Dylandos Ultimate Credit Repair Suite application. It is intended for engineers, release managers, and security reviewers who need an in-depth understanding of the architecture, build pipeline, runtime behavior, storage model, AI integration points, and Android-specific packaging and configuration details.

---

## Table of contents

- Overview
- Repository & build entry points
- Frontend architecture (React + Vite)
- Capacitor integration and config
- Android Gradle configuration and signing
- Runtime architecture on Android (WebView / Capacitor)
- Data storage and IndexedDB design
- AI integration and request routing
- PDF extraction and parsing flow
- Autopilot / batch engine overview
- Security and secret management notes
- Developer workflows and commands
- Recommendations and next steps

---

## Overview

- The app is a single-page React + TypeScript application bundled by Vite and styled with Tailwind.
- The web bundle is produced into the `dist` directory and then deployed into platform containers (Android via Capacitor, Windows via Electron).
- Core features include credit report upload & parsing, dispute letter generation (AI-driven), an autopilot campaign engine, vault storage for documents, and gamification/score tracking.
- The app contains both in-browser UI logic and client-side AI orchestration; there is no dedicated backend server in this repository.

---

## Repository & build entry points

Key repo files and scripts:

- `package.json` — contains scripts and dependencies used for development, Android build integration, and Electron packaging.
  - `dev`: Vite dev server
  - `build`: `vite build` (produces `dist`)
  - `build:electron`: `cross-env BUILD_TARGET=electron vite build`
  - `cap:sync`: `npm run build && npx cap sync android` — builds web assets and syncs with the Android project
  - `cap:open`: `npx cap open android`

- `vite.config.ts` — Vite configuration (React plugin, Tailwind plugin, aliasing, environment defines). Important bits:
  - `outDir` is `dist`
  - `base` is set to `./` when `BUILD_TARGET=electron` to support file:// URIs; default is `/` for web
  - Environment injection: `process.env.GEMINI_API_KEY` and `import.meta.env.VITE_GEMINI_API_KEY` are defined for runtime use by the AI services.

- `capacitor.config.ts` — Capacitor configuration used by Capacitor CLI when building the Android project.
  - `appId`: `com.dylandos.creditrepairsuite`
  - `appName`: `Credit Repair Suite`
  - `webDir`: `dist` (Vite output)
  - `server.androidScheme`: `https` and `server.cleartext: false` (enforces secure scheme usage for the embedded WebView)

Files referenced in this document are present at the repository root (e.g., [package.json](package.json#L1)).

---

## Frontend architecture (React + Vite)

- The UI is written in React (React 19) with TypeScript. Entry point is `src/main.tsx` which mounts `src/App.tsx`.
- Global providers:
  - `AppProvider` (`src/context/AppContext.tsx`) — central app state, persistence hooks, migration helpers, and the primary API surface for the UI.
  - `ToastProvider` (`src/context/ToastContext.tsx`) — transient toast UX.
- Routing/navigation is implemented as an internal page state (`AppPage` union) and a `Layout` wrapper. The app is a classic SPA (no React Router detected in the codebase).
- The UI uses Tailwind (+ `tailwind-merge`) and `lucide-react` icons.

Component and page examples (non-exhaustive):
- `src/pages/UploadReport.tsx` — upload & AI parsing flow (PDF/text/CSV)
- `src/pages/DisputeLetters.tsx` — letter history / previews
- `src/pages/Autopilot.tsx` — autopilot campaign manager
- `src/components/layout/Layout` — UI frame and navigation


---

## Capacitor integration and config

- Web assets are produced into `dist` and Capacitor maps that into the Android WebView folder at sync time.
- `capacitor.config.ts`:
  - `webDir: 'dist'` — build output consumed by Capacitor
  - `server.androidScheme: 'https'` — prefer secure scheme, `cleartext: false`
  - `android.buildOptions` contains placeholders for keystore values (note: the Gradle file actually holds a signing config — see Android section).
- Typical Android build workflow used by the repo:

```bash
# build web assets and sync to Android project
npm run build
npx cap sync android
# open in Android Studio and build signed APK/AAB
npx cap open android
```

- `package.json` exposes `cap:sync` and `cap:open` convenience scripts: `npm run cap:sync` / `npm run cap:open`.

---

## Android Gradle configuration and signing

Location: `android/app/build.gradle`

- The Gradle file sets `namespace` and references `rootProject.ext.compileSdkVersion` / `minSdkVersion` / `targetSdkVersion` — these are defined in the top-level `android`/`gradle` files.
- `applicationId`: `com.dylandos.creditrepairsuite`
- `versionCode` and `versionName` are present and configurable.

Signing config (important security note):

- `signingConfigs.release` in `android/app/build.gradle` points to a keystore file and includes cleartext credentials:
  - `storeFile file('dylandos-release.jks')`
  - `storePassword 'DylandOs2026!'`
  - `keyAlias 'dylandos'`
  - `keyPassword 'DylandOs2026!'`

This indicates the repository (or at least the build scripts) currently reference a keystore and hard-coded passwords. This is a security risk in source control. Recommended corrections:
- Move keystore passwords into `gradle.properties` or CI secrets (never commit them into repo)
- Use environment variables and Gradle property expansion to keep credentials out of VCS
- Consider using a signing service (CI store) and ephemeral signing in the build pipeline

Build types:
- `release` uses the `signingConfig` above, `minifyEnabled false`, and default ProGuard files.
- The Gradle build includes `apply from: 'capacitor.build.gradle'` to integrate Capacitor runtime steps.

Plugins & dependencies:
- `implementation project(':capacitor-android')`
- `implementation project(':capacitor-cordova-android-plugins')` and a `flatDir` repository pointing to `../capacitor-cordova-android-plugins/src/main/libs` for plugin jars.

Google services:
- There's optional logic to apply the `com.google.gms.google-services` plugin if `google-services.json` is present; otherwise a console note says push notifications won't work.

---

## Runtime architecture on Android (WebView / Capacitor)

- The Android app is a Capacitor shell that runs the Vite-built SPA inside the system WebView.
- Important runtime constraints and behaviors:
  - The app runs fully client-side (the web code is the runtime), so all AI orchestration, parsing, and autopilot decisions are executed in the UI process (the WebView JavaScript environment).
  - There is **no Node runtime** inside the Android WebView. Native plugins (Capacitor) can be used for platform features (camera, storage, push), but the current codebase demonstrates no custom native plugins beyond the included Cordova/Capacitor plugin gradle project.
  - `capacitor.config.ts` `server` settings indicate the app expects HTTPS scheme and disallows cleartext by default.

WebView + security:
- The Capacitor WebView inherits the Android system WebView security model.
- The SPA intentionally keeps all network calls scoped to fetch()/browser-friendly endpoints.

---

## Data storage and IndexedDB design

Primary persistence: `IndexedDB` (see `src/services/indexedDB.ts`)

- Database: `DYLANDOS_DB` (version 2)
- Object stores:
  - `appState` — main app key/value store (replaces legacy localStorage usage)
  - `vaultDocs` — vault file metadata + binary (ArrayBuffer) storage for user documents
  - `historyEvents` — append-only event log
  - `autopilotLogs` — autopilot engine logs
  - `scoreEntries` — tracked credit score history

Vault details:
- `VaultDocRecord` supports `data` as `ArrayBuffer | string` to store binary content client-side.
- App-level constants in `AppContext.tsx`:
  - `VAULT_MAX_SIZE_BYTES = 1024 * 1024 * 1024` (1 GB)
  - `VAULT_MAX_FILE_BYTES = 60 * 1024 * 1024` (60 MB)
- Utility functions exposed in `src/services/indexedDB.ts`: `addVaultDocRecord`, `getAllVaultDocs`, `removeVaultDocRecord`, `getTotalVaultSize`.

App state migration and backup:
- `migrateFromLocalStorage()` exists to import old `localStorage` backups into IndexedDB.
- `AppContext` offers `exportAllData()` and `importAllData()` facilities which generate JSON backups and rehydrate state.

Implications for Android:
- IndexedDB persists inside the WebView data store for the app and will survive across app launches; encryption at rest is subject to Android WebView storage model.
- Large binary data in Vault is stored inside IndexedDB (ArrayBuffer), so app size and storage quota usage should be considered during QA.

---

## AI integration and request routing

The app integrates with multiple AI providers using a cascading failover router in `src/services/aiRouter.ts` and higher-level wrappers in `src/services/geminiService.ts`.

Providers and routing order:
- Groq — low-latency primary for generation tasks (if configured)
- Gemini — primary for parsing tasks and large-context requests
- OpenRouter — fallback provider

Key details:
- API keys can come from environment variables (`import.meta.env.VITE_GROQ_API_KEY`, `VITE_GEMINI_API_KEY`) or from `localStorage` keys (`gemini_api_key`, `groq_api_key`, `openrouter_api_key`).
- `routeAIRequest()` enforces provider selection rules:
  - `taskType === 'parse'` → Gemini first, then OpenRouter (explicitly avoids Groq for parsing)
  - `taskType === 'letter'|'analyze'` → Groq → Gemini → OpenRouter
- Provider health tracking: `aiRouter` tracks rate-limited states and consecutive failure counts, and automatically fails over when a provider is rate-limited or failing.

Environment injection:
- `vite.config.ts` defines `process.env.GEMINI_API_KEY` and `import.meta.env.VITE_GEMINI_API_KEY` so builds can embed a key at build time (dangerous if misused — see security notes).

Runtime behavior on Android:
- AI requests are made from the client WebView process using `fetch()` to provider endpoints.
- This design means that API keys (if used from env at build-time) are potentially embedded in the build; keys stored in `localStorage` are retrievable by anyone with access to the device. Use secure storage on Android for production keys, or prefer a server-side proxy for sensitive keys.

---

## PDF extraction and parsing flow

Implemented in `src/pages/UploadReport.tsx` and `src/services/geminiService.ts`.

Client-side PDF text extraction:
- Uses `pdfjs-dist` to extract text from PDF pages inside the browser environment (works in both Electron and Capacitor WebView).
- Worker path is configured via `pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).href;` ensuring the worker bundles correctly with Vite and Electron/Capacitor.
- The code extracts per-page text and concatenates it. There's an explicit guard against scanned-image PDFs: if extracted text is empty, the flow returns a helpful error encouraging the user to upload a text-based PDF or paste text.

AI parsing:
- `parseCreditReport()` lives in `src/services/geminiService.ts`.
- The function chunks long text, sends it to the AI router with `taskType='parse'`, and then performs aggressive JSON sanitization and merge/deduplication of results.
- There is an explicit comment in the code: "This runs entirely client-side — no base64 is ever sent to the AI." The app sends the extracted text to AI providers (text content) but does not transmit raw binary PDFs.

Post-parse processing:
- The parser applies heuristics to compute `autoRemovalDate` (7 years from DOFD), infer `fullAccountNumber`, normalize account numbers, and deduplicate cross-bureau items.
- Parsed items are normalized into `NegativeItem` objects and returned to the UI for user confirmation/import.

Privacy implications on Android:
- The extracted text (PII) is transmitted to external AI providers (Gemini/Groq/OpenRouter) over HTTPS from the device. Ensure users have consent and privacy policies reflect this transmission.

---

## Autopilot / batch engine overview (Android runtime)

Autopilot is a client-side campaign engine implemented in `src/services/autopilotEngine.ts`.

Capabilities:
- 6-round escalation ladder mirroring legal workflow (609 → 611 → 611(a)(7) → furnisher → CFPB+StateAG → pre-litigation)
- Batch sizing heuristics (1/4 to 1/3 by default), bureau staggering offsets, certificate/mailed flags
- Smart features: dual-dispute generation, SOL pause guard, Pay-For-Delete / Goodwill detection heuristics
- Letter generation uses AI (`generateDisputeLetter`) and the letter-variation module for anti-frivolous variations
- Batches and generated letters are returned as in-memory objects and persisted via IndexedDB if the UI chooses to save them

Implications:
- Because Autopilot runs client-side, long-running campaigns and AI usage occur in the user's device and use their configured API keys.
- All logging (autopilot logs, history events) is persisted locally (IndexedDB) for auditing.

---

## Security and secret management notes (Android-specific)

Findings from the codebase that require immediate attention:

1. Keystore credentials are present in `android/app/build.gradle` as plaintext. This is a critical risk.
   - Action: Remove credentials from VCS. Use `gradle.properties`, environment variables, or CI signing pipelines.

2. API keys are read from `localStorage` or injected at build-time (`vite.config.ts`). Storing sensitive API keys on device `localStorage` is insecure.
   - Action: Consider using Android Keystore-backed secure storage (Capacitor Secure Storage plugin) or a server-side proxy to avoid exposing keys to the client.

3. The app transmits extracted credit report text (PII) to third-party AI providers using fetch(). Ensure user-facing privacy policy and consent workflows are explicit and mandatory.

4. The app uses `IndexedDB` to store large amounts of personal data (vault). Consider encrypting vault data at rest using a user passphrase / key derivation and store only wrappers in IndexedDB.

5. Verify that `server.cleartext: false` and `androidScheme: 'https'` match runtime network endpoints (no accidental cleartext fallback allowed in production builds).

---

## Developer workflows and commands (Android)

Build the web assets, sync to Android project, open Android Studio, build.

```bash
# produce web bundle
npm run build
# sync to Capacitor Android project
npx cap sync android
# open Android Studio
npx cap open android
```

Alternative one-liners (scripts already in `package.json`):

```bash
npm run cap:sync
npm run cap:open
```

Testing notes:
- Use Vite `dev` for iterative UI development (but remember the WebView runtime can differ from desktop browsers).
- For device testing, deploy the Capacitor project from Android Studio to a device/emulator.

---

## Recommendations and next steps

- Remove keystore credentials from VCS and move to secure storage (CI secrets or environment variables).
- Move AI API keys off `localStorage`. On Android, use secure storage (Capacitor Secure Storage plugin or platform-keystore-backed wrappers).
- Introduce optional server-side AI proxy if you need central rate-limiting, billing control, or key management; this removes the need to ship API keys to end-user devices.
- Add encryption-at-rest for Vault documents (optional) — helps compliance and reduces risk in case of device compromise.
- Instrument telemetry/error reporting (Sentry/Crashlytics) behind an opt-in/opt-out privacy model.

---

## Appendix: quick code refs

- App entry: [src/main.tsx](src/main.tsx#L1)
- Central state + persistence: [src/context/AppContext.tsx](src/context/AppContext.tsx#L1)
- IndexedDB implementation: [src/services/indexedDB.ts](src/services/indexedDB.ts#L1)
- AI router: [src/services/aiRouter.ts](src/services/aiRouter.ts#L1)
- Parser & generator: [src/services/geminiService.ts](src/services/geminiService.ts#L1)
- Upload & PDF flow: [src/pages/UploadReport.tsx](src/pages/UploadReport.tsx#L1)
- Capacitor config: [capacitor.config.ts](capacitor.config.ts#L1)
- Android Gradle: [android/app/build.gradle](android/app/build.gradle#L1)


---

End of Android deep-dive.
