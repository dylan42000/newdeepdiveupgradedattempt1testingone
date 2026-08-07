# Dylandos Ultimate Credit Repair Suite — Cross-Platform Technical Manifest

**Product:** Dylando Ultimate Credit Repair Suite  
**Version:** 5.1.1  
**App ID:** `com.dylandos.creditrepairsuite`  
**Package:** `dylando-ultimate-credit-repair-suite`  
**Aligned to codebase:** July 21, 2026  
**Audience:** Engineers, auditors, and AI agents who need one reference for the **full Windows (Electron) + Android (Capacitor)** product  

**Companion docs**

| Doc | Role |
|-----|------|
| `DYLANDOS-TECHNICAL-DEEP-DIVE.md` | Longer narrative deep dive (same product) |
| `DYLANDOS-AI-REFERENCE.md` | Short agent change-rules / orientation |
| `docs/credit-report-parser-v5-deep-dive.md` | Parser porting detail |
| `docs/android/android-deep-dive.md` | Android-focused notes (may lag this manifest) |
| `docs/windows/newupdates/orignaldeepdive/windows-deep-dive.md` | Historical Electron notes |

---

## 1. Executive summary

Dylandos is a **privacy-first, on-device** credit dispute operations suite. There is **no first-party backend**. One React 19 + TypeScript + Vite SPA ships to:

| Target | Shell | Native strengths |
|--------|-------|------------------|
| **Windows desktop** | Electron 41 | DPAPI (`safeStorage`) keys/SSN/vault master key, FS vault, chunked AutoPilot scheduler, print-to-PDF, NSIS + Portable EXEs |
| **Android** | Capacitor 8 | Android Keystore vault, EncryptedSharedPreferences AutoPilot state, WorkManager + BootReceiver, Print/Camera plugins, Gist OTA updater |
| **Web (dev)** | Vite only | IndexedDB + in-memory key cache; no DPAPI/Keystore |

### Architectural pillars

1. **Single SPA** — `src/` is shared; platform differences live in `electron/`, `android/`, and `src/services/platform*`.
2. **Services-heavy domain** — ~85 TypeScript services; UI pages are thin orchestration.
3. **AutoPilot V2** — 6-pass dispute campaign engine with holds, FCRA clocks, evidence gates, letter uniqueness.
4. **Golden Ticket parser** — Live PDF/paste path is `creditReportParser/` (heuristic bureau extractors), not the legacy 7-stage AI doc path.
5. **Dual letter pipelines** — Manual UI may use `geminiService`; AutoPilot uses `letterGeneratorV2` (fixes must consider both).

```
┌──────────────────────────── USER DEVICE ────────────────────────────┐
│  React UI (pages/) ──▶ AppContext ──▶ IndexedDB DYLANDOS_DB         │
│         │                  │         + localStorage caches          │
│         ▼                  ▼                                        │
│  Services: Parser │ AI Router │ Letter V2 │ AutoPilot V2 │ Vault    │
│         │                           │                               │
│         ▼                           ▼                               │
│  Groq / Gemini / OpenAI / Cloudflare    electronAPI / Capacitor     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology stack & build graph

| Layer | Choice |
|-------|--------|
| UI | React 19, Tailwind CSS v4, Radix primitives, Lucide, Motion |
| Language | TypeScript ~5.8 (`npm run lint` = `tsc --noEmit`) |
| Bundler | Vite 6 (`BUILD_TARGET=electron` for desktop build) |
| PDF | `pdfjs-dist` (extract), `jspdf` / `html2canvas` / `html2pdf.js` (export) |
| AI | Groq (primary free-tier), Gemini (`@google/genai`), OpenAI, Cloudflare Workers AI |
| Sanitize | `dompurify` (letter HTML preview) |
| Windows | Electron 41, electron-builder 26 → NSIS + Portable + `win-unpacked` |
| Android | Capacitor 8, Gradle, custom Java plugins under `com.dylandos.creditrepairsuite` |

### npm scripts (authoritative)

```
npm run dev              # Vite :3000
npm run electron:dev     # Vite :5173 + Electron
npm run electron:build   # vite BUILD_TARGET=electron + electron-builder
npm run cap:sync         # build web → npx cap sync android
npm run lint             # tsc --noEmit
npm run test:upgrade     # tsx scripts/final-upgrade-regression.ts
```

### Release artifacts (`release/`)

- `Dylando Ultimate Credit Repair Suite Setup 5.1.1.exe`
- `Dylando Ultimate Credit Repair Suite Portable 5.1.1.exe`
- `win-unpacked/Dylando Ultimate Credit Repair Suite.exe`

Signing passwords must come from env / `local.properties` — **never** commit `*.jks` or `DYLANDOS_*_PASSWORD` in `gradle.properties`.

---

## 3. Repository map

```
├── electron/main.cjs, preload.cjs     # Windows main + contextBridge
├── android/app/src/main/java/...      # Capacitor plugins + MainActivity
├── src/
│   ├── main.tsx, App.tsx              # ErrorBoundary + page switch
│   ├── context/AppContext.tsx         # Global state + IDB autosave
│   ├── pages/                         # 16+ screens
│   ├── components/                    # AutoPilotDashboard, LetterReview, …
│   ├── services/                      # Domain engines (~85 modules)
│   │   ├── creditReportParser/        # LIVE parser
│   │   ├── autoPilotEngineV2.ts       # LIVE AutoPilot
│   │   ├── letterGeneratorV2.ts       # LIVE AutoPilot letters
│   │   ├── aiRouter.ts, geminiService.ts
│   │   ├── platform/, platformService.ts
│   │   └── indexedDB.ts, secureKeyService.ts, vaultEncryptionService.ts
│   ├── workers/creditReportParserWorker.ts
│   └── types.ts, types/creditRepair.ts
├── docs/                              # Platform + parser notes
└── technicalmanifestwindowsandroid.md # THIS FILE
```

---

## 4. Application shell & navigation

- **No React Router.** `App.tsx` holds `currentPage: AppPage` and switches components.
- **Layout** — `components/layout/Layout.tsx` (sidebar / mobile more menu, command palette Ctrl/Cmd+K).
- **ErrorBoundary** — root in `main.tsx` + nested around providers / main UI.
- **Debug** — Ctrl+Shift+D toggles `DebugParsePanel`.
- **Android deep links** — `initAndroidNotificationHandler` maps notification actions → Autopilot page.

### Pages

| Page id | File | Role |
|---------|------|------|
| dashboard | Dashboard.tsx | KPIs, digest |
| upload | UploadReport.tsx | PDF/paste → worker → negatives |
| negative-items | NegativeItems.tsx | Item CRUD, merge, confirm |
| dispute-letters | DisputeLetters.tsx | Letters, PDF, mail |
| autopilot | Autopilot.tsx | V2 cycle UI (legacy v1 runner removed) |
| dispute-calendar | DisputeCalendar.tsx | FCRA / SOL calendar |
| vault | Vault.tsx | Evidence + archive browser |
| history | History.tsx | Event log |
| score-tracker | ScoreTracker.tsx | Manual scores |
| address-lookup | AddressLookup.tsx | Furnisher research |
| sol-calculator | SOLCalculator.tsx | State SOL |
| settings | Settings.tsx | Keys, mail, updater, backup |
| profile | Profile.tsx | Personal info / clear |
| gamification | Gamification.tsx | XP |
| tools | Tools.tsx | Utilities |
| credit-builder | CreditBuilder.tsx | Cards / AU / inquiries / boosts |
| more | MoreMenu.tsx | Mobile hub |

**Null-safety:** Always use `(item.disputeStatus ?? "").includes(...)` — missing status previously white-screened Layout/Dashboard/Autopilot.

---

## 5. State management (AppContext)

`AppContext` is the single React source of truth for:

- `reports`, `negativeItems`, `disputeLetters`, `personalInfo`, `contacts`
- `autopilot`, `security`, `gamification`, `campaigns`, `theme`
- Credit Builder: `creditCards`, `hardInquiries`, `auAccounts`, `boostPrograms`
- V4: `profiles`, `activeProfileId`, vault docs / history / scores / autopilot logs

### Boot sequence

1. `openDB()` + `migrateFromLocalStorage()`
2. `loadAppState("main")` → hydrate UI
3. Load vault docs, history, autopilot logs, scores
4. Electron: `vaultGetMasterKey` → `VaultEncryptionService.initWithMasterKey`
5. `syncKeysFromSecureStorage()`
6. Load `dylandos_profiles_v4` from localStorage
7. `isDbReady = true` → autosave arms

### Autosave

Writes `main` appState including Credit Builder fields. Dependency array **includes** `creditCards`, `hardInquiries`, `auAccounts`, `boostPrograms`.

**SSN policy:** Autosave redacts full SSN to last-4 only. Full SSN belongs in Electron `secure:storeSSN` / Android EncryptedSharedPreferences — never plaintext IDB.

### clearData

Clears UI state + IDB stores including `autopilotState`, `holdQueue`, `fcraTimeline`, `cycleAudit`. Does **not** wipe Electron DPAPI files or Android Keystore material.

---

## 6. Persistence architecture

### IndexedDB — `DYLANDOS_DB` (`indexedDB.ts`)

| Store | Purpose |
|-------|---------|
| appState | Key/value blob (`main`) |
| vaultDocs | Evidence metadata (may be encrypted records) |
| historyEvents | Activity log |
| autopilotLogs | Cycle log lines |
| scoreEntries | Score tracker |
| disputeItems | Dispute-domain items |
| generatedLetters / bureauResponses / disputeOutcomes | Letter/response history |
| userProfiles | Profile records |
| autopilotState | Pass maps / engine state (v4) |
| holdQueue | Hold entries with stable `id` |
| fcraTimeline | FCRA deadlines |
| cycleAudit | Per-cycle audit records |

### localStorage caches (fast sync reads)

Examples: `dylandos_autopilot_v2_state`, `dylandos_autopilot_v2_settings`, `dylandos_hold_queue_v1`, `dylandos_fcra_timeline_v1`, `dylandos_item_passes_v2_*`, `dylandos_profiles_v4`.

**Rule:** Mutations write LS **and** IDB (hold queue uses full IDB replace to prevent zombie resurrection).

### Electron userData

```
dylandos-keys.enc          # API keys (DPAPI only — fail closed if unavailable)
vault-master.enc           # AES master key hex (DPAPI only)
vault/                     # FS vault tree
ssn-store.enc              # Per-profile SSN
autopilot/scheduler.json   # { enabled, nextCycleDate, fired? }
logs/
```

### Android

- Vault files under app `files/vault` (canonical path checks — no `..` traversal)
- SSN / AutoPilot state via EncryptedSharedPreferences + Keystore AES-GCM

---

## 7. Security model (current)

### Windows (Electron)

| Control | Behavior |
|---------|----------|
| Isolation | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` |
| Keys/SSN/master | Write refused if `safeStorage` unavailable (no plaintext `.enc`) |
| `read-file-as-base64` | Only paths previously returned by `open-file-dialog` |
| `print-to-pdf` | Renderer `outputPath` ignored — always save dialog |
| `openExternal` | HTTPS only (navigate + IPC) |
| Vault paths | `safeRelativePath` under vault base |

### Android

| Control | Behavior |
|---------|----------|
| Network | Cleartext blocked except localhost/emulator for Capdev |
| Vault FS | Canonical path must stay under vault dir |
| Signing | Passwords via env / local.properties; `*.jks` gitignored |
| BootReceiver | `exported=true` for `BOOT_COMPLETED` |

### Shared SPA

| Control | Behavior |
|---------|----------|
| API keys | SecureKeyService — Electron/Android secure store; **no localStorage fallback** (memory-only if no backend) |
| Letter HTML | DOMPurify in `LetterReviewScreen` |
| AI prompts | SSN last-4 only (not full SSN) |

### Residual risks (still true)

- Wide `electronAPI` surface → any XSS is high impact (DOMPurify reduces letter sink).
- Dual vault / dual profile / dual letter DNA systems still exist.
- Web mode has no DPAPI/Keystore.

---

## 8. Domain model (essentials)

### NegativeItem (core fields)

`id`, `creditorName`, `accountNumber`, `balance`, `typeOfNegative`, `status`,  
`originalDateOfDelinquency` / `dateOfFirstDelinquency` (**real DOFD only — never invented from open date**),  
`dateOpened` / `originalOpeningDate`, `creditBureau[]` (**empty if Unknown — never forced to Experian**),  
`disputeRound` 1–6, `disputeStatus`, `priorityScore`, `parseConfidence`, `dataSource`, Metro2 optional fields.

### Pass ladder (AutoPilot)

| Pass | Intent |
|------|--------|
| 1 | Accuracy challenge (§611) |
| 2 | Method of verification |
| 3 | Procedural / direct furnisher |
| 4 | Formal intent / escalation |
| 5 | Final demand |
| 6 | Legal demand / pre-lit posture |

### Hold days by pass

`60 / 60 / 45 / 30 / 14 / 15` (Pass 6)

### Dispute status examples

`Undisputed`, `RoundN-Pending`, `…-Verified`, `Won`, `Deleted`, Round4–6 legal/CFPB labels.

---

## 9. Credit report parser (live path)

### Entry

`UploadReport.tsx` → `workers/creditReportParserWorker.ts` → `creditReportParser/index.ts` → `parseNegativeItems` in `creditParser.ts`.

### Pipeline

1. Acquire text (PDF via pdfjs / paste / Electron file)
2. Normalize + detect consumer + bureaus
3. TU column normalization when multi-bureau ACR
4. **Union** specialized extractors (TU ACR / portal / TU negative / Equifax) — **no early-exit** that drops EQ/EX
5. Generic block fallback if specialized empty
6. Map to app `NegativeItem` (DOFD only from delinquency fields; `$0` balances kept)

### Important files

`creditParser.ts`, `extractor.ts`, bureau normalizers under `bureauNormalizers/`, `docs/credit-report-parser-v5-deep-dive.md`.

### Not live

Docs describing a mandatory 7-stage AI parser / `extractor.heuristicExtract` as primary — maintainers must not “fix” dead paths thinking they are production.

---

## 10. AI router

`aiRouter.ts` — free-first vs quality-first modes; Groq multi-key cooldown; Gemini model chain; OpenAI; Cloudflare.

Keys via `secureKeyService` (`KEY_NAMES.*`). Settings UI: Groq / Gemini / OpenAI / Cloudflare / mail providers.

Tasks: parse assist, letter gen, strength scoring, address research, CFPB narrative, etc.

---

## 11. Letter generation

### AutoPilot path (authoritative for cycles)

`letterGeneratorV2.ts` + `disputePromptBuilder` + `consumerVoicePolicy` + `bureauCalibrationEngine` + `letterUniquenessService` / anti-spam + `letterValidator` + placeholders (`placeholderService`: `{{DOFD}}` falls back to `dateOfFirstDelinquency`).

### Manual / UI path

`geminiService.ts` and Dispute Letters UI — still used for ad-hoc generation; keep prompts consumer-voice (no attorney persona).

### Export

Electron `print-to-pdf`, Android `pdfGeneratorAndroid` / PrintPlugin, batch `batchExportService`, `mailDeliveryService` (Lob / PostGrid / Stannp / manual).

---

## 12. AutoPilot V2 — cycle anatomy

**Owner:** `autoPilotEngineV2.ts`  
**UI:** `Autopilot.tsx` + `AutoPilotDashboard`  
**Enable toggle:** schedules Electron + Android; listens for `autopilot:trigger` / cycle-overdue.

### High-level cycle steps

1. Single-flight `isRunning`  
2. Profile preflight (name/address FATAL)  
3. Process hold queue; load overdue timelines  
4. Escalations + inertia evaluation  
5. Batch select (fraction, max 8, soft 2/creditor)  
6. Per-item: DOFD/address preflight, frivolous guard, evidence gate  
7. Target plan (bureau ± furnisher)  
8. Generate letters (Pass strategies); uniqueness; archive  
9. Entropy mailing schedule; persist passes; cycle audit  
10. **Deadlines start on send**, not on draft generation  

### Idempotency

- Duplicate letter window **30 days** (same item+pass)  
- Hold replace same item+profile  
- Deadline dedupe on identical keys  

### Response handling

| Outcome | Effect |
|---------|--------|
| deleted | Clear hold/pass |
| verified | Hold by pass days |
| no_response | Bump pass ≤6 |
| frivolous | Challenge / guard hold |
| updated | Partial / watch |

---

## 13. Timing & clocks

| Concern | Value |
|---------|-------|
| Default cycle interval | **32 days** |
| FCRA bureau track | 30 + 5 grace = **35** |
| Furnisher track | 45 + 5 |
| Inertia | 30 nudge / 45 advance / 60 force |
| Escalation tier-2 | 36 days past deadline |
| Inter-letter AI cooldown | 3000 ms |
| Entropy | max 2/bureau/day, +2d gap |

### Windows scheduler (critical)

Electron uses **chunked timers** (≤ ~24.8 days per `setTimeout`) comparing wall clock to target. Multi-week delays must **never** be passed raw to `setTimeout` (overflow → ~1ms fire). On startup, `restoreSchedulerFromDisk()` re-arms from `scheduler.json`.

### Android scheduler

- TS sends `{ intervalHours, state: JSON.stringify(flatState) }`  
- Java parses **`state` string** into JSONObject (not the Capacitor envelope)  
- WorkManager unique periodic work ~12h  
- `patchOnly` updates merge `nextCycleDateMs` without wiping timelines/holds  
- BootReceiver re-registers after reboot (`exported=true`)

---

## 14. Windows platform detail

### Files

- `electron/main.cjs` — window, IPC, vault, scheduler, PDF  
- `electron/preload.cjs` — `window.electronAPI`  
- `electron-builder.json` — NSIS + Portable + dir, `signAndEditExecutable: false` by default  

### IPC groups

1. API keys: store / get / remove  
2. Files: open dialog → allowlist; read base64; save  
3. PDF: print-to-pdf (dialog only)  
4. Vault: base path, read/write/list/delete, audit, export zip, master key  
5. SSN: store / get / clear  
6. AutoPilot: schedule / cancel / status + events  
7. Clipboard / notifications / openExternal / version  

### Build

`npm run electron:build` → `release/*.exe`.

---

## 15. Android platform detail

### Config

`capacitor.config.ts` — `webDir: dist`, `androidScheme: https`, cleartext false, updater plugin hooks.

### Native plugins (`com.dylandos.creditrepairsuite`)

| Class | Role |
|-------|------|
| AutoPilotPlugin | Schedule / update / cancel / status / battery exemption |
| AutoPilotWorker | Notifications: cycle ready, timeline, hold expired |
| AutoPilotDataStore | EncryptedSharedPreferences blob |
| BootReceiver | BOOT_COMPLETED → re-enqueue work |
| SecureVaultPlugin | Keystore crypto, SSN prefs, vault FS |
| PrintPlugin | WebView print → PDF share |
| CameraResponsePlugin | Response letter photo → base64 |
| MainActivity | Plugin registration + notification JS bridge |

### JS bridges

`androidScheduler.ts`, `androidSecurityService.ts`, `androidArchiveService.ts`, `androidNotificationHandler.ts`, `androidUpdateService.ts` (Gist OTA).

### Reality check

Android background limits mean campaigns still need periodic foreground opens; WorkManager notifies — it does not fully replace desktop always-on timers.

---

## 16. End-to-end product flow

```
Upload/Paste → Parser Worker → negativeItems (IDB)
    → Review / Merge / Confirm
    → AutoPilot V2.runCycle → draft letters + archive + entropy dates
    → DisputeLetters: approve / PDF / certified mail
    → Mark Sent → TimelineTracker.addDeadline
    → Bureau response → handleResponse
         ├─ Deleted → clear
         ├─ Verified → HoldQueue
         └─ No response / inertia → Pass++
    → Hold expires / overdue → next cycle
```

---

## 17. Service catalog (navigation)

### Orchestration
`autoPilotEngineV2`, `autopilotEngine` (helpers/legacy), `disputeEngine`, `escalationEngine`, `batchSelector`, `targetPlanner`, `itemScorer`, `holdQueue`, `timelineTracker`, `autopilotMigration`, `cycleAuditService`

### AI & letters
`aiRouter`, `apiQueueManager`, `geminiService`, `letterGeneratorV2`, `letterTemplateService`, `letterValidator`, `letterDNA`, `letterUniquenessService`, `letterGroundingService`, `letterFormatter`, `placeholderService`, `consumerVoicePolicy`, `disputePromptBuilder`, `batchExportService`, `mailDeliveryService`, `printService`, `pdfGeneratorAndroid`

### Parser & accounts
`creditReportParser/*`, `tradelineMerger`, `accountMergeEngine` (threshold ≥2.0; refuse digit conflicts), `accountIdentityService`, `accountHealingEngine`, `sanitizer`

### Intel / legal
`bureauCalibrationEngine`, `metro2*`, `cfpbComplaintGenerator`, `frivolousFlagGuard`, `evidenceGateService`, `entropyDispatchScheduler`, `crossBureauAnalyzer`, `preFlightChecker`, `expirationRadarService`, `disputeClockEngine`

### Persistence / platform
`indexedDB`, `secureKeyService`, `vaultEncryptionService`, `archiveService`, `platformService`, `platform/*`, `androidUpdateService`

---

## 18. Magic numbers (quick table)

| Concern | Value |
|---------|-------|
| Cycle interval | 32 days |
| Hold days | 60/60/45/30/14/15 |
| Duplicate letter window | 30 days |
| Batch | ~33%, max 8, soft 2/creditor |
| Evidence BLOCKED | score &lt;35 without gov ID |
| Letter min length V2 | 200 (furnisher 250) |
| Parser short-text reject | &lt;50 chars |
| Vault caps | 1GB total / 60MB file |
| File read cap (Electron) | 50MB |
| setTimeout max chunk | 2³¹−1 ms |

---

## 19. Dual systems & remaining gotchas

1. **Two letter pipelines** — UI/`geminiService` vs AutoPilot/`letterGeneratorV2`.  
2. **Two vaults** — IndexedDB UI vault vs native FS vault.  
3. **Two profile systems** — LS `CreditProfile` vs IDB `userProfiles`.  
4. **Two DNA helpers** — `letterDNA` ≠ `disputeEngine.generateLetterDNA`.  
5. **Multiple GeneratedLetter types** — check imports.  
6. **Live parser ≠** AI parse-only / dead heuristic-as-primary docs.  
7. **Deadlines start on send**, not generation.  
8. **`letterAutoApprove` unused** in `runCycle` (drafts stay draft).  
9. **Profile switch** does not auto-swap negativeItems inventory.  
10. Treat old README / April deep-dive folders as historical when they conflict with this manifest.

### Fixed recently (Jul 19–21 2026) — do not re-report as open bugs

- Electron timer overflow + schedule restore  
- Android AutoPilot state schema + BootReceiver export + patchOnly merge  
- DOFD fabrication / Unknown→Experian / multi-bureau early-exit  
- Electron arbitrary read/write IPC; DPAPI fail-closed  
- Android vault path traversal  
- SSN out of full IDB / AI prompts; keys no localStorage fallback  
- ErrorBoundary + disputeStatus null-safety  
- Credit Builder autosave deps; clearData Autopilot stores  
- Hold queue stable IDs + IDB replace; DOMPurify letter preview  
- Dead Autopilot v1 UI path removed  

---

## 20. Operational runbooks

### Smoke (Windows)

1. `npm run electron:dev` or install Setup/Portable EXE  
2. Complete Profile (name + mailing address)  
3. Upload/paste report → negatives appear  
4. Settings: add at least one AI key  
5. Dispute Letters or Autopilot: generate draft → PDF  
6. Enable Autopilot → confirm schedule (status / `scheduler.json`)  
7. Mark sent → deadline appears; log response → hold/pass changes  

### Smoke (Android)

1. `npm run cap:sync` → open Android Studio → run device/emulator  
2. Same profile + parse + letter flow  
3. Enable Autopilot → WorkManager scheduled; reboot → BootReceiver path  
4. Notification tap → Autopilot screen  

### “No letters”

Evidence gate / missing gov ID · AI keys · holds · 30-day duplicate · DOFD/address preflight · cycle `errors[]`

### “Parser empty”

Prefer Accounts / Potentially Negative paste · TU normalizer · Debug panel · worker RESULT vs ERROR  

### “Scheduler wrong”

Windows: check chunked timer + `scheduler.json` · Android: inspect stored flat JSON for `nextCycleDateMs` at top level  

---

## 21. Upgrade & contribution contracts

1. Prefer extending existing services over new parallel engines.  
2. Any AutoPilot mutation: LS cache **and** IDB write-through.  
3. Never invent DOFD or bureau.  
4. Never pass multi-week ms to `setTimeout`.  
5. Never trust renderer paths for FS write/read.  
6. Never commit keystores or signing passwords.  
7. Exhaustive `switch` on unions with `never` default (repo rule).  
8. Imports at file top (no inline imports).  
9. After material changes: `npm run lint`; for desktop ship: `npm run electron:build`.  

---

## 22. Appendices

### A. Version stamp

- Manifest version: **5.1.0 / 2026-07-21**  
- Electron: 41.x · Capacitor: 8.x · React: 19 · Vite: 6  

### B. Where to look first

| Question | Start here |
|----------|------------|
| How does Windows secure keys? | `electron/main.cjs` + `secureKeyService.ts` |
| How does Android schedule? | `androidScheduler.ts` + `AutoPilotPlugin.java` |
| How does a cycle work? | `autoPilotEngineV2.ts` §runCycle |
| How does parse work? | `creditReportParser/index.ts` + `creditParser.ts` |
| How does UI state persist? | `AppContext.tsx` + `indexedDB.ts` |
| How do letters get unique? | `letterUniquenessService` / anti-spam + DNA |

### C. Document ownership

Update **this file** when cross-platform architecture, security contracts, AutoPilot scheduling, or parser truth changes. Keep under **1500 lines**. Deeper single-topic detail may live in companion docs listed in the header.

### D. V5.1 world-class pipeline upgrade

- Parser output now passes through masked-account reconstruction and six-factor cross-bureau similarity scoring. Scores ≥85 merge automatically; 65–84 surface as suggested; 45–64 require review. Conflicting visible last-four digits never auto-merge.
- TransUnion normalization runs only when TransUnion is detected. Unknown bureau remains unknown. Parser success is based on pre-merge detection count.
- Letter Engine V3 uses 12-dimension, profile/bureau/cycle-aware DNA; bureau citation rotation; verified fact blocks; and inline boilerplate, account-token, creditor, and pass-3+ citation gates.
- AutoPilot V3 adds opt-in auto-approval with a default uniqueness floor of 70 and pass ceiling of 4. Placeholder, factual-anchor, and recent frivolous flags remain hard blockers. Auto-mail remains opt-in and disabled by default.
- Duplicate prevention is bureau-adaptive (`max(25, expected response days + 5)`; escalation passes use 20 days). Frivolous hold APIs support bureau/pass adaptive 7–21 day cooldowns and weighted risk scoring.
- The AutoPilot dashboard now reports an A–F health grade, overdue/approaching FCRA clocks, holds, evidence readiness, and stale-cycle warnings (35-day default).
