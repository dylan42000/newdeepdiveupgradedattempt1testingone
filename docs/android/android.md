## Android Deep Dive — Dylandos Credit Repair Suite (Android variant)

This document captures in-depth technical details for the Android variant of Dylandos Credit Repair Suite.
It is intended for engineers and for automated AI-assisted upgrades, debugging, and targeted repairs.
Coverage: build configuration, native/web bridge, storage, AI integration, debugging, known failure modes,
and remediation steps (including paste/AI issues described by users).

---

## 1. Build identity and compatibility matrix

- App ID: `com.dylandos.creditrepairsuite`
- Current version: `4.0.0` (versionCode 400)
- Minimum supported Android: API 26 (Android 8.0 Oreo)
- Target/Compile SDK: API 36 (Android 16 runtime)
- AGP (Android Gradle Plugin): `com.android.tools.build:gradle:8.13.0`
- Gradle wrapper recommended: 8.x matching AGP requirements
- Capacitor: `@capacitor/core@^8.3.0`, `@capacitor/android@^8.3.0`
- Vite (web build): `vite@6.x` producing `dist/` as `webDir`

Compatibility notes:
- API 26 devices have limited WebView feature parity; test CSS features and large memory workloads.
- Ensure `android:usesCleartextTraffic` is not enabled; server endpoints must be HTTPS.

---

## 2. High-level architecture

- Hybrid mobile app using Capacitor as native shell.
- Web layer: React 19 + TypeScript 5.8, Vite 6 production bundle in `dist/`.
- Native layer: minimal Java/Kotlin glue for plugin initialization, WorkManager schedules,
  and EncryptedSharedPreferences for secure key storage.
- Communication: Capacitor JS bridge (bridge calls <-> native plugin methods).

Components:
- Web renderer (Renderer): UI, AI orchestration, user workflows, IndexedDB persistence.
- Native host (Android): plugin lifecycle, background scheduling, secure storage, notifications.

Important constraints:
- Background AI calls from WorkManager are fragile if the engine relies on WebView contexts.
  Implementing native HTTP client for background AI tasks is recommended for reliability.

---

## 3. Android native project layout (critical files)

- `android/app/build.gradle` — signing, compile options, proguard rules, dependencies.
- `android/variables.gradle` — shared dependency versions and SDK constants.
- `capacitor.config.ts` — WebView and plugin configuration; `webDir` must point to the Vite output.
- `src/services/*` — platform-agnostic services in TypeScript; key ones:
  - `aiRouter.ts` — provider cascade and rate-limiter
  - `geminiService.ts` — report parsing and heavy parsing heuristics
  - `pdfGeneratorAndroid.ts` — native PDF fallback
  - `secureKeyService.ts` — cross-platform secure key abstraction

Files that frequently require edits for Android fixes:
- `android/app/proguard-rules.pro` — R8 rules for any native or JS-to-native reflection
- `android/local.properties` — local SDK path (machine-specific, gitignored)

---

## 4. Build and CI pipeline

Local debug build:
1. `npm run build` — produce `dist/` from Vite (production bundle)
2. `npx cap sync android` — copy built files into Android assets and update plugin manifests
3. `cd android` and `./gradlew assembleDebug` — produces debug APK

Release build (recommended script):
1. Secure keystore and credentials via environment variables or CI secrets
2. `npm run build && npx cap sync android && cd android && ./gradlew assembleRelease`

CI considerations:
- Use hermetic Node and JDK images; ensure Android SDK and emulator images installed.
- Cache Gradle, NPM/Yarn, and Vite build artifacts for speed.

---

## 5. Dependencies and critical runtime libraries

- `androidx.work:work-runtime:2.9.0` — background job scheduling; use Worker constraints conservatively
- `androidx.security:security-crypto` — EncryptedSharedPreferences wrapper; current alpha version requires monitoring
- `androidx.biometric:biometric` — biometric authentication
- Capacitor native bridge — ensure plugin versions are compatible with Capacitor core

Dependency upgrade guidance:
- Upgrade one major subsystem at a time (Capacitor, AGP, AndroidX). Run full integration test after each.

---

## 6. AI integration specifics (Android considerations)

AI providers are orchestrated by `src/services/aiRouter.ts` with provider failover and quota management.

Provider roles:
- Groq: high-throughput tasks (classification, short outputs)
- Gemini: large-context parsing (file parsing, long credit-report contexts)
- OpenRouter: resilience and fallback

Android-specific constraints:
- Long-running AI calls from WorkManager should be done via native HTTP (OkHttp) if WebView is not guaranteed alive.
- Attach retry/backoff semantics in native worker to avoid silent failures when WebView is suspended.

---

## 7. Data persistence and vault model

Primary web storage:
- IndexedDB for main app state and vault metadata
- localStorage for small flags and autopilot pass markers

Native-secured secrets:
- EncryptedSharedPreferences stores API keys and short secrets.
- Vault files stored in app-private storage and optionally mirrored to external storage only when exported.

Design notes:
- Avoid storing large binary files in IndexedDB; keep large PDF blobs on the native side and reference via ID.

---

## 8. Known failure modes and targeted fixes (Android)

Issue: "AI returned no items. Try pasting a cleaner copy of your report."
Symptoms:
- When users paste credit report text into the upload area, the AI parsing step responds with the message above.
- Sometimes pasting appears to do nothing (no text visible in the input area) — paste is accepted but UI not updated.

Root-cause analysis (likely causes):
1. Sanitization filter strips pasted characters because of unescaped control or zero-width characters.
2. Rich-text paste handler tries to interpret HTML and clears content when encountering malformed markup.
3. Frontend paste handler uses `preventDefault()` then fails to insert clipboard text into controlled React input state.
4. The AI parsing pipeline rejects input because of excessive whitespace or invisible characters and returns no recognized items.

Reproduction steps:
1. Open app on Android emulator or device.
2. Navigate to Credit Report import/paste view.
3. Paste a report containing varied whitespace, pdf-extracted line-breaks, or Unicode control characters.
4. Observe: text not shown in UI or AI response: "AI returned no items..."

Diagnostics to add:
- Capture raw clipboard contents before sanitization (log length, hex sample of first 256 bytes).
- Add a dev-mode toggle to bypass sanitization and display raw paste text in debug overlay.
- Add telemetry for parse pipeline: send sanitized payload sizes and first 512 characters (mask PII) to dev logs.

Fix patterns:
1. Adjust paste handler to use `navigator.clipboard.readText()` fallback and assign to React state explicitly.
2. Normalize Unicode: run NFKC normalization and strip zero-width, control, and BOM characters.
3. Collapse excessive newline runs and convert common PDF line-break patterns into paragraphs.
4. If AI parser returns empty results, run a local heuristic scanner that looks for known credit-report anchors
   (e.g., "Equifax", "TransUnion", "Experian", "Account Number", dates with MM/DD/YYYY) to decide if input
   is likely a credit report; if heuristic fails, show an actionable UI hint to the user.

Example sanitizer (TypeScript):
```ts
function sanitizePaste(raw: string): string {
  // Normalize and remove non-printing characters
  let s = raw.normalize('NFKC');
  // Remove zero-width and control characters except line feed and tab
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFEFF\u200B-\u200F]/g, '');
  // Collapse multiple newlines into paragraph breaks
  s = s.replace(/(\r\n|\r|\n){3,}/g, '\n\n');
  // Trim and return
  return s.trim();
}
```

UI-side change:
- For controlled components: ensure paste updates both DOM and React state. Example pattern:
```tsx
const onPaste = async (e) => {
  e.preventDefault();
  const text = (await navigator.clipboard.readText()).toString();
  const cleaned = sanitizePaste(text);
  setInputValue(cleaned);
};
```

Server-side / AI pipeline mitigation:
- If AI returns zero items, return a structured error that includes a short example snippet of the sanitized input
  (first 256 chars, PII masked) in logs so the developer can triage parsing heuristics.
- Add a secondary lightweight parser (regex-based) as a fallback to extract accounts, creditors, and dates.

---

## 9. Troubleshooting workflow when paste shows no text

Step 1 — Local reproduce
- Try paste into a plain Android text input (external app) to ensure clipboard content exists.
- Use Android ADB to read clipboard: `adb shell am broadcast -a clipper.get` or platform-specific tools.

Step 2 — Browser/WebView boundaries
- If the input works in other apps but not in our WebView, inspect WebView `shouldOverrideUrlLoading` and JS console logs.
- Enable WebContents debugging in `capacitor.config.ts` during local debug builds: `webContentsDebuggingEnabled: true`.

Step 3 — Debugging controlled React inputs
- Confirm `onPaste` handler is not calling `e.preventDefault()` without inserting text into state.
- Add temporary overlay to show DOM `innerText` and React `state` side-by-side to find mismatches.

Step 4 — Data sanitation interfering
- Log raw bytes of clipboard (mask PII) to determine if invisible characters were present.

Step 5 — Fix and ship
- Apply sanitizer and controlled component fixes, run integration tests on API 26 and API 36 emulators.

---

## 10. Observability and logs

Add the following telemetry points for future issues:
- Paste event: timestamp, sanitized length, first 64 chars hash, device memory class
- AI parse result: provider used, token usage estimate, parse result count, error code
- Worker tasks: start/end timestamps, HTTP response codes, throttling events

Logging policy:
- Mask PII before sending logs off-device.
- Keep local debug logs verbose; production logs should be opt-in.

---

## 11. Performance and memory

Large credit reports require chunked processing:
- Split document into 8KB chunks and run parse on overlapping windows to maintain context.
- Use streaming/partial-output approach when calling AI provider to reduce peak memory.

WebView memory tips:
- Explicitly release large blobs after PDF generation: `URL.revokeObjectURL()` and `delete` references.
- Use `requestIdleCallback` to schedule heavy post-processing when main thread is idle.

---

## 12. Testing checklist (actionable items)

- [ ] Add unit tests for `sanitizePaste()` and common paste edge cases.
- [ ] Add integration test that pastes a PDF-extracted string into the paste input and asserts visible state.
- [ ] Add E2E test to run `npm run build && npx cap sync android && ./gradlew assembleDebug` and smoke test main flows.
- [ ] Add telemetry unit to capture failed parse samples (PII masked) for offline triage.

---

## 13. Recommended short-term fixes (priority order)

1. Implement `navigator.clipboard.readText()` paste fallback with explicit React state update.
2. Add `sanitizePaste()` normalization pass (NFKC, remove zero-width/control chars).
3. Add small regex-based fallback parser before returning "no items" to users.
4. Surface actionable UI hints when paste parse fails (e.g., "Try exporting a cleaned .txt from your PDF reader").

---

## 14. Long-term improvements

- Implement native background AI client for WorkManager tasks to avoid WebView dependency.
- Move heavy parsing to a server-side worker or native library to reduce client CPU and memory usage.
- Add schema validation for AI outputs to avoid silent empty responses.

---

## 15. Quick references and files to edit

- See `capacitor.config.ts` for WebView options and debug toggle.
- Fix paste handling in `src/components/UploadReport.tsx` (or equivalent paste input component).
- Improve parser in `src/services/geminiService.ts` and fallback regex in `src/services/aiRouter.ts`.
- Add sanitizer tests next to `src/services/__tests__/sanitize.test.ts`.

---

End of Android deep dive. Use this as a living document; update when library versions change or when new platform constraints appear.
