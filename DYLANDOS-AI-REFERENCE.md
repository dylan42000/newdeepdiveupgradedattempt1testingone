# DylandOs Ultimate Credit Repair Suite — Full AI / Developer Reference

**Version:** 5.6.3\
**Product:** Dylando Ultimate Credit Repair Suite (`dylando-ultimate-credit-repair-suite`)\
**App ID:** `com.dylandos.creditrepairsuite`\
**Purpose of this file:** Single deep-dive reference for other AIs and developers doing upgrades, fixes, refactors, or feature work. Prefer this document over skim-reading the whole tree.

**Last aligned to codebase:** August 2026

**For the full world-class technical bible** (cycle step-by-step, thresholds, dual-systems, platform IPC, runbooks), use:

→ `DYLANDOS-TECHNICAL-DEEP-DIVE.md`

This file is the shorter orientation + change-rules companion.

---

## Table of contents

 1. [What this app is](#1-what-this-app-is)
 2. [Tech stack & platforms](#2-tech-stack--platforms)
 3. [Repository layout](#3-repository-layout)
 4. [Runtime architecture](#4-runtime-architecture)
 5. [Pages, navigation & UI](#5-pages-navigation--ui)
 6. [Core data models](#6-core-data-models)
 7. [Persistence (IndexedDB + localStorage)](#7-persistence-indexeddb--localstorage)
 8. [Credit report parser (live v5)](#8-credit-report-parser-live-v5)
 9. [AI router & letter generation](#9-ai-router--letter-generation)
10. [AutoPilot engine (v2)](#10-autopilot-engine-v2)
11. [Vault, security & keys](#11-vault-security--keys)
12. [Supporting engines & tools](#12-supporting-engines--tools)
13. [Electron (Windows) platform](#13-electron-windows-platform)
14. [Android (Capacitor) platform](#14-android-capacitor-platform)
15. [Service catalog (quick map)](#15-service-catalog-quick-map)
16. [Build, run, test, release](#16-build-run-test-release)
17. [Rules for AI agents changing this codebase](#17-rules-for-ai-agents-changing-this-codebase)
18. [Common failure modes & fix pointers](#18-common-failure-modes--fix-pointers)
19. [Legal / compliance context (product logic)](#19-legal--compliance-context-product-logic)
20. [Related docs in this repo](#20-related-docs-in-this-repo)

---

## 1. What this app is

Privacy-first, on-device credit dispute workflow app for:

- Parsing multi-bureau credit reports into structured **negative items**
- Generating legally grounded **dispute letters** (AI + templates + validation)
- Running multi-pass **AutoPilot** campaigns (hold queues, FCRA timers, escalation)
- Storing PII/evidence in a local **Vault**
- Tracking scores, SOL, Metro 2 issues, CFPB packs, credit-builder tools
- Exporting print-ready / batch PDF letters (certified-mail cover sheets)

**Design goals**

- Maximize deletion / correction probability while reducing re-aging risk
- Keep API keys and PII on-device (Electron secure store / Android secure vault / encrypted IndexedDB)
- Idempotent AutoPilot cycles (no duplicate letters on re-run)
- Bureau-aware strategies (Equifax / Experian / TransUnion differ)

**Not a cloud SaaS.** Web/Electron/Android share one React UI. Persistence is local. AI providers are called only for parse/letter/analysis tasks with user-configured keys.

---

## 2. Tech stack & platforms

| Layer | Choice |
| --- | --- |
| UI | React 19, TypeScript \~5.8 |
| Build | Vite 6, Tailwind CSS 4 (`@tailwindcss/vite`) |
| Desktop | Electron 41 + electron-builder → Windows NSIS + Portable |
| Mobile | Capacitor 8 → Android (`com.dylandos.creditrepairsuite`) |
| PDF parse | `pdfjs-dist` (+ custom Y-coordinate line extraction) |
| PDF export | `jspdf`, `html2pdf.js`, `html2canvas`, Android-specific PDF helpers |
| AI | Groq → Gemini → Cloudflare → OpenAI failover via `aiRouter.ts` |
| State | `AppContext` (React) + IndexedDB `DYLANDOS_DB` v4 |
| Icons / motion | `lucide-react`, `motion` |
| UI primitives | Radix (`checkbox`, `label`, `slot`) + local `src/components/ui/*` |

**Version constant:** `APP_VERSION = "5.0.0"` in `src/context/AppContext.tsx`.

---

## 3. Repository layout

```
/
├── src/                          # Main application
│   ├── App.tsx                   # Page router + AutoPilot migration on boot
│   ├── main.tsx                  # React entry
│   ├── types.ts                  # Primary shared domain types
│   ├── types/creditRepair.ts     # AutoPilot v2 / profile / letter v2 types
│   ├── context/
│   │   ├── AppContext.tsx        # SINGLE SOURCE OF TRUTH for app state
│   │   └── ToastContext.tsx
│   ├── pages/                    # Top-level screens
│   ├── components/               # Feature UI + layout + ui primitives
│   ├── services/                 # ~85 business services (engines)
│   │   ├── creditReportParser/   # Live heuristic parser (v5)
│   │   └── platform/             # Android-specific helpers
│   ├── workers/
│   │   └── creditReportParserWorker.ts
│   ├── config/disputeTimingConfig.ts
│   ├── data/                     # SOL DB, state AG addresses, etc.
│   └── lib/utils.ts
├── electron/
│   ├── main.cjs                  # Main process (IPC, vault FS, scheduler)
│   ├── preload.cjs               # window.electronAPI bridge
│   └── icon*.png / icon.ico
├── android/                      # Capacitor native project + plugins
├── docs/                         # Deep dives (parser, autopilot, platforms)
├── scripts/                      # Regression / cadence checks
├── Testparsercreated/            # Standalone parser playground (not prod)
├── release/                      # Built Windows artifacts
├── public/                       # Static assets + pdf.worker.mjs
├── capacitor.config.ts
├── electron-builder.json
├── vite.config.ts
├── package.json
└── README.md                     # User + AutoPilot walkthrough (also useful)
```

**Ignore for production behavior unless explicitly tasked:**

- `Testparsercreated/` — experimental parser UI
- `scripts/` — may have type mismatches; excluded from prod bundle
- Duplicate / older narrative blocks at the bottom of `README.md` (v4 leftovers)

---

## 4. Runtime architecture

```
┌─────────────────────────────────────────────────────────────┐
│  React UI (pages + components)                              │
│  Layout + CommandPalette + DebugParsePanel (Ctrl+Shift+D)   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  AppContext (AppProvider)                                   │
│  reports, negativeItems, disputeLetters, vault, campaigns,  │
│  profiles, scores, autopilot settings, history, themes…     │
│  Persists via indexedDB.ts + selective localStorage cache   │
└───────────────┬─────────────────────────────┬───────────────┘
                │                             │
                ▼                             ▼
┌───────────────────────────┐   ┌─────────────────────────────┐
│ Services / Engines        │   │ Platform bridges            │
│ parser, aiRouter,         │   │ window.electronAPI          │
│ AutoPilotEngineV2,        │   │ Capacitor plugins           │
│ letterGeneratorV2, vault… │   │ SecureKeyService            │
└───────────────────────────┘   └─────────────────────────────┘
```

**Boot sequence of note (**`App.tsx`**):**

1. `runAutopilotMigration(profileIds)` — one-time localStorage → IndexedDB (BUG-08)
2. `restoreFromIDB(profileIds)` — warm sync cache for sync engine reads
3. Optional Android update check (Gist manifest, every 12h if enabled)

**Hard architectural rules**

1. `AppContext` **is the single source of truth** for UI-facing state mutations.
2. **All AI calls go through** `src/services/aiRouter.ts` — do not call Groq/Gemini/OpenAI SDKs directly from pages.
3. **Live credit report parsing** uses `src/services/creditReportParser/` (heuristic). Do not assume the old AI-chunk parser pipeline in legacy docs is live.
4. **AutoPilot production path** is `autoPilotEngineV2.ts` (+ supporting GAP services). `autopilotEngine.ts` is legacy v1.

---

## 5. Pages, navigation & UI

Defined in `src/App.tsx` as `AppPage`. Nav list in `src/components/layout/Layout.tsx`.

| Page id | Screen file | Role |
| --- | --- | --- |
| `dashboard` | `pages/Dashboard.tsx` | Overview / KPIs |
| `upload` | `pages/UploadReport.tsx` | PDF/text ingest → parser |
| `negative-items` | `pages/NegativeItems.tsx` | Edit/review tradelines |
| `dispute-letters` | `pages/DisputeLetters.tsx` | Letters, send, outcomes |
| `autopilot` | `pages/Autopilot.tsx` | Campaign / cycle UI |
| `dispute-calendar` | `pages/DisputeCalendar.tsx` | Schedule / deadlines |
| `credit-builder` | `pages/CreditBuilder.tsx` | Cards, AU, boosts, inquiries |
| `vault` | `pages/Vault.tsx` | Evidence documents |
| `score-tracker` | `pages/ScoreTracker.tsx` | Score history |
| `history` | `pages/History.tsx` | Audit event log |
| `address-lookup` | `pages/AddressLookup.tsx` | Creditor / bureau addresses |
| `sol-calculator` | `pages/SOLCalculator.tsx` | Statute of limitations |
| `tools` | `pages/Tools.tsx` | Misc tools hub |
| `gamification` | `pages/Gamification.tsx` | XP / achievements |
| `profile` | `pages/Profile.tsx` | Consumer profile / multi-profile |
| `settings` | `pages/Settings.tsx` | AI keys, themes, updater |
| `more` | `pages/MoreMenu.tsx` | Mobile overflow menu |
| `cases` | `pages/Cases.tsx` | Case management |
| `fraud-alerts` | `pages/FraudAlerts.tsx` | Fraud detection & alerts |
| `goodwill` | `pages/GoodwillCampaign.tsx` | Goodwill letter campaigns |
| `inquiry-audit` | `pages/InquiryAudit.tsx` | Hard inquiry auditing |
| `kpi-cockpit` | `pages/KPICockpit.tsx` | Executive KPI dashboard |
| `consumer-statement` | `pages/ConsumerStatement.tsx` | Consumer statement filing |

**Important feature components**

- `AutoPilotDashboard.tsx` — SLA chips, evidence meter, cycle history
- `HoldQueuePanel.tsx`, `TimelinePanel.tsx`, `DisputeTimeline.tsx`
- `LetterReviewScreen.tsx`, `ValidationModal.tsx`
- `CrossBureauMatrix.tsx`, `MergedAccountCard.tsx`
- `CFPBComplaintView.tsx`, `DebugParsePanel.tsx`
- `CommandPalette.tsx` — keyboard navigation

**Themes:** `"cyber" | "stealth" | "inferno" | "venom" | "arctic"` (`AppTheme`).

**Vault limits:** max vault 1GB; max file 60MB (`VAULT_MAX_*` in AppContext).

---

## 6. Core data models

Primary file: `src/types.ts`. AutoPilot-rich types: `src/types/creditRepair.ts`.

### NegativeItem (tradeline)

Key fields:

- Identity: `id`, `creditorName`, `accountNumber`, `fullAccountNumber?`, `furnisher?`
- Money / status: `balance`, `status`, `typeOfNegative`, `accountStatus?` (Metro 2)
- Dates: `originalDateOfDelinquency` / `dateOfFirstDelinquency`, `autoRemovalDate`, opened/closed
- Bureaus: `creditBureau: string[]`, `crossBureauGroupId?`
- Dispute: `disputeRound` (1–6), `disputeStatus`, `lastDisputeDate`, `disputeDeadline`, `priorityScore`
- Strategy flags: `forceStrategy?`, `goodwillEligible?`, `p4dEligible?`, `doubleVerified?`, `isMedicalDebt?`, `solPaused?`
- Parser meta: `parseConfidence?`, `dataSource?`, `accuracyConfirmedByUser?`

### DisputeLetter

- `content`, optional `htmlContent` / `bodyContent`
- `bureau`, `round`, `templateType`, `status: Draft | Sent | Resolved`
- Mail: `certifiedMail`, `trackingNumber`, `mailedAt`, mail-delivery provider fields
- Quality: `disputeStrengthScore`, `uniquenessFingerprint`, `selectedDisputeAngle`, `aiProviderUsed`

### LetterTemplateType

```
609-Identity | 609-Disclosure | 611-Reinvestigation | 623-Furnisher |
611a7-MethodOfInvestigation | Goodwill | PayForDelete | CeaseAndDesist |
DualDispute-BureauFurnisher | CFPBComplaint | CFPBComplaintStateAG |
PreLitigation | AggressiveDual | ReInsertionViolation
```

### AutoPilotSettings (UI / AppContext)

Notable toggles: `dualDispute`, `aggressivePlus`, `certifiedMailDefault`, `autoAdvanceRounds`, `solPauseGuard`, `smartLetterMode`, `smartFollowUp`, `cfpbAutoEscalate`, mail delivery provider, Android update feed settings.

### AutoPilotSettingsV2 (engine defaults)

From `DEFAULT_SETTINGS_V2` in `autoPilotEngineV2.ts`:

```ts
{
  enabled: false,
  batchFraction: 0.33,
  maxItemsPerBatch: 8,
  dualTargetMode: true,
  holdDaysByPass: { 1: 60, 2: 60, 3: 45, 4: 30, 5: 14, 6: 15 },
  cycleIntervalDays: 32,
  letterAutoApprove: false,
  aiModel: 'groq',
  noResponseThresholdDays: 35,
  autoGenerateCFPBOnPass5: true,
  autoGenerateStateAGOnPass5: false,
  backupBeforeCycle: true,
}
```

### PassNumber

`1 | 2 | 3 | 4 | 5 | 6` — Pass 6 is pre-litigation statutory demand (`PASS_6_STRATEGY`).

### Multi-profile

`CreditProfile` in `types/creditRepair.ts` + `userProfiles` IndexedDB store. Active profile drives AutoPilot pass maps and vault scoping.

---

## 7. Persistence (IndexedDB + localStorage)

**Database:** `DYLANDOS_DB` version **4** — `src/services/indexedDB.ts`

| Store | Purpose |
| --- | --- |
| `appState` | Serialized main app state (key-value) |
| `vaultDocs` | Evidence files (binary / encrypted path) |
| `historyEvents` | Append-only audit log |
| `autopilotLogs` | Cycle / engine log stream |
| `scoreEntries` | Score tracker |
| `disputeItems` | Engine-level dispute items |
| `disputeLettersV2` | Richer letter records |
| `generatedLetters` | DNA-hash letter records |
| `bureauResponses` | Logged bureau outcomes |
| `disputeOutcomes` | Outcome learning dataset |
| `userProfiles` | Multi-profile |
| `autopilotState` | Pass numbers per profile (`passes_{profileId}`) |
| `holdQueue` | Hold entries + expiry |
| `fcraTimeline` | FCRA deadline tracking |
| `cycleAudit` | Full cycle audit records |

Many records support `LocalDataEncryption` wrap/unwrap via `secureKeyService`.

**localStorage keys still relevant (cache / migration):**

- `dylandos_autopilot_v2_state`
- `dylandos_item_passes_v2_*`
- `dylandos_hold_queue_v1`
- `dylandos_fcra_timeline_v1`
- `dylandos_dispute_history_v2`
- `dylandos_profiles_v4` / `dylandos_active_profile_v4`
- `dylandos_archive_reports_v1`
- streak / last-login keys

Migration: `src/services/autopilotMigration.ts` (`runAutopilotMigration`, `restoreFromIDB`, `idbSavePassNumbers`, …).

---

## 8. Credit report parser (live v5)

**Source of truth:** `docs/credit-report-parser-v5-deep-dive.md` + code under `src/services/creditReportParser/`.

### Live file map

```
src/services/creditReportParser/
├── index.ts                 # Orchestrator: parseCreditReport(options)
├── creditParser.ts          # Golden negative-item detection
├── extractor.ts             # PDF extract, normalize, consumer info, bureau detect
└── bureauNormalizers/
    └── transunionNormalizer.ts
src/workers/creditReportParserWorker.ts
```

### Pipeline

1. Acquire text (`pdf_buffer` | `paste` | `file_path`) — reject if &lt; 50 chars
2. `normalizeText` (NFKC, ligatures, hyphen-NL; preserve PDF tabs)
3. `extractConsumerInfo` + `detectBureaus`
4. If TU / multi-bureau → TransUnion preprocess + normalize
5. `parseNegativeItems` (golden engine)
6. Map → app `NegativeItem` (`needsReview` if confidence &lt; 55)

**Production orchestrator reports** `parseMethod: 'heuristic_only'`**.** There is **no live AI enhancer** in `index.ts`. Legacy AI parse helpers may still exist in `geminiService.parseCreditReport` for alternate flows — prefer the creditReportParser path for parity with Upload UI.

### Design principles

- Negative-only detection (charge-off, collection, past due, etc.)
- Bureau-first specialized extractors before generic block scan
- PDF extraction preserves line structure via Y-coordinate grouping
- TransUnion multi-column linearization repaired before detection

### Upload entry

`src/pages/UploadReport.tsx` → worker / `parseCreditReport` → `AppContext.addNegativeItems`.

Debug: **Ctrl+Shift+D** opens `DebugParsePanel` with `lastParseDebugLog`.

Standalone twin: `Testparsercreated/src/utils/creditParser.ts` (playground only).

---

## 9. AI router & letter generation

### AI Router — `src/services/aiRouter.ts`

**Cascade (typical):** Groq (speed) → Gemini (capacity) → Cloudflare (free) → OpenAI (quality fallback).

**Public API**

- `routeAIRequest(messages, options)`
- `aiComplete(system, user, taskType?)`
- `routeAIRequestFast(...)`
- `aiStream(...)`
- `checkProviderHealth()`, `getProviderStatus()`
- Key setters/getters: Groq (×2), Gemini, OpenAI, Cloudflare (+ account id)
- `syncKeysFromSecureStorage()`

**Task types** affect provider order + temperature:

`parse | classify | letter | analyze | metro2_audit | variation | cfpb_narrative | legal_demand | score_impact | goodwill | cross_bureau_diff`

- Letter / legal / variation temps \~0.80–0.85 (anti e-OSCAR pattern matching)
- Parse / classify \~0.15 (near-deterministic JSON)

**Models (constants in file):** e.g. `GROQ_PRIMARY_MODEL = "llama-3.3-70b-versatile"`, Gemini model chain array.

**Concurrency:** `apiQueueManager.ts` caps parallel calls to reduce Groq 429s.

### Letter engines

| Path | File | Use |
| --- | --- | --- |
| AutoPilot v2 letters | `letterGeneratorV2.ts` | Primary cycle generation |
| Gemini service helpers | `geminiService.ts` | Manual / smart / CFPB / furnisher helpers |
| Templates | `letterTemplateService.ts` | Structured templates |
| Formatting | `letterFormatter.ts`, `deterministicLetterRenderer.ts` | HTML blocks |
| Validation | `letterValidator.ts` | Boilerplate / citation / token checks |
| Uniqueness | `letterUniquenessService.ts`, `letterDNA.ts`, `antiSpamDisputeEngine.ts`, `entropyLetterMixer.ts`, `letterVariation.ts` | Anti-spam / DNA / variation |
| Grounding | `letterGroundingService.ts`, `placeholderService.ts` | Facts + unfilled-token scan |
| Batch export | `batchExportService.ts` | Multi-letter PDF + certified cover |
| Print | `printService.ts`, `pdfGeneratorAndroid.ts`, `pdfCanvasService.ts` | Platform print/PDF |

### geminiService exports (still used by UI tools)

- `parseCreditReport` (legacy/alternate)
- `generateDisputeLetter`, `generateSmartDisputeLetter`
- `estimateScoreImpact`, `lookupDisputeAddress`
- `analyzeBureauDiscrepancies`, `analyzeDisputeStrength`
- `generateCFPBComplaint`, `generateFurnisherBypassLetter`
- `generateCampaignSuccessReport`, `generateTemplatePreview`

---

## 10. AutoPilot engine (v2)

**Orchestrator:** `src/services/autoPilotEngineV2.ts` → export `AutoPilotEngineV2`.

### Cycle responsibilities (high level)

 1. Load pass map + hold queue (IDB-backed)
 2. Apply **inertia escalation** (30 nudge / 45 advance / 60 force) — `inertiaEscalationService`
 3. Apply **FCRA no-response escalations** — `escalationEngine` (BUG-09)
 4. **Evidence gate** — skip/block weak packets — `evidenceGateService`
 5. **Batch select** — `batchSelector` + `itemScorer`
 6. **Target plan** — bureau / furnisher / dual — `targetPlanner`
 7. Per item: bureau calibration, strategy rotation, pre-flight, Metro 2, uniqueness, letter gen
 8. Validate (boilerplate, tokens, citations)
 9. **Entropy dispatch schedule** — max 2 letters/bureau/day + cool-downs — `entropyDispatchScheduler`
10. Persist letters, pass numbers, **cycle audit** — `cycleAuditService`

### Pass ladder (product logic)

| Pass | Intent | Typical legal hooks |
| --- | --- | --- |
| 1 | Initial investigation | FCRA §611(a)(1) |
| 2 | Failure to investigate / docs | §611, §616, §617 |
| 3 | Furnisher + Metro 2 | §623(a)(8), Metro 2 |
| 4 | Pre-litigation / CFPB notice | §616/617, FDCPA as applicable |
| 5 | Regulatory escalation | CFPB / State AG packs |
| 6 | Pre-litigation statutory demand | §616/617 after Pass 5 + CFPB |

Hold days default by pass: see `DEFAULT_SETTINGS_V2.holdDaysByPass`.

### Gap / intelligence modules wired into V2

| Gap | Service | Role |
| --- | --- | --- |
| GAP-A | `inertiaEscalationService.ts` | Stall tiers 30/45/60 |
| GAP-B | `evidenceGateService.ts` | Evidence readiness score / block |
| GAP-D | `strategyRotationEngine.ts` | Anti-repetition + re-aging detect |
| GAP-G | `frivolousResponseService.ts` / `frivolousFlagGuard.ts` | Frivolous protocol |
| GAP-I | `bureauCalibrationEngine.ts` | Equifax/Experian/TU tone |
| GAP-J | `entropyDispatchScheduler.ts` | Organic mail stagger |
| GAP-H | `cycleAuditService.ts` | Cycle history persistence |

Also used in-cycle: `crossBureauAnalyzer`, `preFlightChecker`, `metro2AuditService` / `metro2AuditEngine`, `expirationRadarService`, `deletionOutcomeEngine`, `directFurnisherEngine`, `goodwillLetterEngine`, `furnisherChainOfCustodyService`, `scoreImpactProjector`, `disputeClockEngine`, `accountHealingEngine`.

### Outcomes when logging bureau responses

| Outcome | Engine effect |
| --- | --- |
| Deleted | Resolve; remove from future batches |
| Updated | Partial win / watch |
| Verified | Next pass + hold |
| No Response | Escalate; cite window expiry |
| Frivolous | Pass +1, short hold, §611(a)(3)(B) challenge plan |

### UI surfaces

- `pages/Autopilot.tsx` + `AutoPilotDashboard.tsx`
- Hold queue / timeline panels
- Dispute letters page for mail tracking + outcome logging

### Legacy

`autopilotEngine.ts` — older engine; prefer V2 for all new work.

---

## 11. Vault, security & keys

| Concern | Service / bridge |
| --- | --- |
| Vault docs in IDB | `indexedDB.ts` + `AppContext` vault APIs |
| Encryption | `vaultEncryptionService.ts`, `LocalDataEncryption` in `secureKeyService.ts` |
| API keys | `secureKeyService.ts` (+ Electron IPC / Android secure storage) |
| Electron vault FS | `electronAPI.vault*` / `vault:*` IPC |
| Android vault | `SecureVaultPlugin.java` + `platform/androidSecurityService.ts` |
| SSN secure store | `electronAPI.secureStoreSSN` / Android equivalents |

**Evidence readiness tiers (product):** BLOCKED (&lt;35) → BASIC → STRONG → AUDIT-PROOF (85+). Government ID is the unlock for letter generation in gated flows.

**Never** upload vault contents to external servers. AI prompts should only include necessary letter/parse fields.

---

## 12. Supporting engines & tools

Non-exhaustive but important:

| Domain | Services |
| --- | --- |
| Dispute history / genealogy | `disputeHistoryService`, `disputeGenealogyService`, `disputeOutcomeTracker` |
| Response ingest | `bureauResponseParser`, `responseScanner` |
| Metro 2 | `metro2Auditor`, `metro2AuditEngine`, `metro2AuditService` |
| SOL / expiration | `expirationRadarService`, `data/solDatabase.ts`, SOL Calculator page |
| Addresses | `bureauAddressService`, `addressResearchAgent`, `data/stateAGAddresses.ts` |
| CFPB | `cfpbComplaintGenerator`, `CFPBComplaintView` |
| Medical debt | `medicalDebtHandler` |
| Re-insertion | `reInsertionMonitor` |
| Learning | `outcomeBasedLearning`, `intelligenceDigestService` |
| Mail APIs | `mailDeliveryService` (lob/postgrid/stannp/manual) |
| Archive | `archiveService`, `ArchiveBrowser` |
| Personas / angles | `personaMatrix`, `disputeAngleRotator`, `consumerVoicePolicy` |
| Account merge | `accountMergeEngine`, `tradelineMerger`, `accountIdentityService` |
| Android update | `androidUpdateService` + Gist manifest (see docs) |
| Notifications | `disputeNotifications`, Android notification handler |

---

## 13. Electron (Windows) platform

**Entry:** `electron/main.cjs`\
**Preload bridge:** `electron/preload.cjs` → `window.electronAPI`

### Exposed capabilities

- API key store/get/remove
- File dialogs, save, read as base64
- `printToPDF`
- Notifications, app version, `openExternal`
- Clipboard (multi-fallback `pasteText`)
- Vault filesystem + audit log + export package + master key
- Secure SSN store
- AutoPilot schedule / cancel / status + `autopilot:trigger` / `autopilot:cycle-overdue` events
- Deadline alert events

**Build**

```bash
npm run electron:dev      # Vite :5173 + Electron
npm run electron:build    # build:electron + electron-builder
```

Outputs under `release/`: Setup EXE, Portable EXE, `win-unpacked/`.

**Vite note:** `BUILD_TARGET=electron` sets `base: './'` for `file://` assets.

Config: `electron-builder.json` (NSIS + portable + dir, x64, icon `electron/icon.ico`).

---

## 14. Android (Capacitor) platform

**Config:** `capacitor.config.ts`

- `appId`: `com.dylandos.creditrepairsuite`
- `webDir`: `dist`
- `androidScheme`: `https`, no cleartext
- Plugins: LocalNotifications, SecureStoragePlugin, DylandosUpdater (manifest URL/channel)

**Native Java plugins** (`android/app/src/main/java/com/dylandos/creditrepairsuite/`):

| Class | Role |
| --- | --- |
| `MainActivity.java` | Entry |
| `AutoPilotPlugin.java` | Bridge to JS AutoPilot |
| `AutoPilotWorker.java` | Background work |
| `AutoPilotDataStore.java` | Native persistence helper |
| `BootReceiver.java` | Boot reschedule |
| `CameraResponsePlugin.java` | Capture bureau response photos |
| `PrintPlugin.java` | Print |
| `SecureVaultPlugin.java` | Secure vault |

**JS helpers:** `src/services/platform/*`, `pdfGeneratorAndroid.ts`, `androidUpdateService.ts`.

```bash
npm run cap:sync   # build web + cap sync android
npm run cap:open   # Android Studio
```

Release signing via env: `DYLANDOS_STORE_FILE`, `DYLANDOS_STORE_PASSWORD`, `DYLANDOS_KEY_ALIAS`, `DYLANDOS_KEY_PASSWORD`.

See `docs/android/*` for release checklist and Gist updater setup.

---

## 15. Service catalog (quick map)

\~85 files under `src/services/`. Grouped by job:

**Core orchestration**

- `autoPilotEngineV2.ts`, `autopilotEngine.ts` (legacy)
- `disputeEngine.ts`, `escalationEngine.ts`
- `batchSelector.ts`, `targetPlanner.ts`, `itemScorer.ts`

**AI / letters**

- `aiRouter.ts`, `apiQueueManager.ts`, `geminiService.ts`
- `letterGeneratorV2.ts`, `letterTemplateService.ts`, `letterValidator.ts`, …
- `deterministicLetterRenderer.ts`, `disclosurePromptBuilder.ts`, `disputePromptBuilder.ts`

**Parser**

- `creditReportParser/*`, worker, `sanitizer.ts`, `currencyNormalizer.ts`

**Persistence / security**

- `indexedDB.ts`, `secureKeyService.ts`, `vaultEncryptionService.ts`
- `autopilotMigration.ts`, `userProfileService.ts`, `archiveService.ts`

**Bureau / legal intel**

- `bureauCalibrationEngine.ts`, `strategyRotationEngine.ts`, `bureauAddressService.ts`
- `metro2*`, `cfpbComplaintGenerator.ts`, `citationEquivalenceMap.ts`
- `frivolous*`, `inertiaEscalationService.ts`, `evidenceGateService.ts`
- `entropyDispatchScheduler.ts`, `cycleAuditService.ts`, `holdQueue.ts`, `timelineTracker.ts`

**Credit builder / scoring**

- `scoreImpactProjector.ts`, `deletionProbabilityEngine.ts`, `deletionOutcomeEngine.ts`

**Platform**

- `platformService.ts`, `platform/android*.ts`, `androidUpdateService.ts`, `printService.ts`

When adding a feature: place logic in `services/`, wire UI through `AppContext` or page → service, never bypass `aiRouter` for AI.

---

## 16. Build, run, test, release

```bash
npm ci
npm run dev              # Vite http://localhost:3000
npm run lint             # tsc --noEmit
npm run build            # web dist/
npm run electron:dev
npm run electron:build
npm run cap:sync
npm run cap:open
npm run test:upgrade     # tsx scripts/final-upgrade-regression.ts
```

**Node:** LTS ≥ 18. **Android:** JDK 17+, SDK API 35 target / 24 min.

**Env keys Vite can inject** (`vite.config.ts`): `GEMINI_API_KEY`, `VITE_GEMINI_API_KEY`, `VITE_GROQ_API_KEY(_1/_2)`, `VITE_OPENROUTER_API_KEY`. Prefer in-app Settings + SecureKeyService for real use.

---

## 17. Rules for AI agents changing this codebase

 1. **Read this file + the specific module** before rewriting architecture.
 2. **Do not invent a new state store** — extend `AppContext` + IndexedDB stores if needed (bump DB version carefully with `onupgradeneeded`).
 3. **Do not call AI providers directly** — use `aiRouter`.
 4. **Parser changes:** preserve live orchestrator path; keep rejection/debug logging; update `docs/credit-report-parser-v5-deep-dive.md` if behavior changes.
 5. **AutoPilot changes:** prefer extending V2 + GAP services; keep cycles **idempotent**; persist passes/holds/audits to IDB (not localStorage-only).
 6. **Letter safety:** run validators; scan placeholders; no fabricated statutes (use approved citation maps).
 7. **Exhaustive switches** on unions/enums with `never` default (repo TypeScript rule).
 8. **Imports at top of file** — no inline imports unless circular-dep documented.
 9. **Scope discipline:** change only files required for the task; no drive-by refactors or unsolicited markdown unless asked.
10. **Secrets:** never commit `.env`, keystores, or real API keys. `android/app/dylandos-release.jks` exists in tree — treat as sensitive.
11. **Commits / PRs:** only when the user asks; use Conventional Commits `type(scope): imperative summary`.
12. **Tests:** prefer `npm run lint` and targeted regression scripts after engine/parser changes.

---

## 18. Common failure modes & fix pointers

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| No letters generated | Evidence gate blocked; no AI keys; all items on hold | `evidenceGateService`, Settings keys, HoldQueue |
| Duplicate letters on re-run | Cycle not idempotent / pass map not saved | `autoPilotEngineV2`, `autopilotMigration` IDB saves |
| Pass stuck forever | Hold never expires / inertia not applied | `holdQueue`, `inertiaEscalationService`, `escalationEngine` |
| Parser empty / garbage | PDF column smash (TU), wrong section pasted | `extractor.ts`, `transunionNormalizer`, Debug panel |
| Groq 429 storms | Unbounded parallel AI | `apiQueueManager`, router cooldowns |
| Electron blank assets | Absolute base path | `vite.config.ts` `base: './'` for electron |
| Android background cycles die | OS background limits | `AutoPilotWorker`, BootReceiver; document foreground expectation |
| Typecheck noise | `scripts/`, `Testparsercreated/` | Exclude from prod concerns; don't “fix” unless tasked |
| Letter placeholders shipped | Tokens not scanned | `placeholderService.scanForUnfilledTokens`, `letterValidator` |

---

## 19. Legal / compliance context (product logic)

The app **implements product logic inspired by** consumer-credit statutes; it is not a substitute for legal advice. Engines cite and structure around:

| Authority | Sections commonly used in prompts/templates |
| --- | --- |
| FCRA | §609, §611(a)(1), §611(a)(3)(B), §612, §613, §616, §617, §623(a)(8), §1681c auto-removal |
| FDCPA | §806–809 (collector paths) |
| FACTA | Identity theft / free report hooks |
| Metro 2 | Field accuracy / status codes |
| CROA | Disclosure awareness for repair orgs |
| CFPB | Complaint / bulletin references in Pass 4–5 |

**Bureau mail addresses (product defaults):**

- Equifax: P.O. Box 740256, Atlanta, GA 30374-0256
- Experian: P.O. Box 4500, Allen, TX 75013
- TransUnion: P.O. Box 2000, Chester, PA 19016

---

## 20. Related docs in this repo

| Doc | When to use |
| --- | --- |
| `README.md` | End-user AutoPilot walkthrough + quick start |
| `docs/credit-report-parser-v5-deep-dive.md` | Porting / fixing parser (authoritative for live path) |
| `docs/autopilot/autopilot-world-class-upgrade-plan.md` | Upgrade priorities / compliance roadmap |
| `docs/windows/newupdates/orignaldeepdive/windows-deep-dive.md` | Windows/Electron deep dive |
| `docs/android/android-deep-dive.md` | Android architecture |
| `docs/android/android-release-readiness-checklist.md` | Ship checklist |
| `docs/android/gist-updater-setup.md` | OTA manifest via Gist |
| `finalfix.md` / `lunafinalupgrade.md` | Historical upgrade notes (verify against code) |

---

## Appendix A — Electron API sketch

```ts
window.electronAPI = {
  storeApiKey, getApiKey, removeApiKey,
  openFileDialog, saveFile, readFileAsBase64,
  printToPDF, showNotification, getAppVersion, getPlatform, openExternal,
  pasteText, readClipboard,
  // vault*
  getVaultPath, writeVaultFile, readVaultFile, listVaultDirectory, deleteVaultFile,
  appendAuditLog, createExportPackage, getVaultMasterKey,
  // secure SSN
  storeSSN, getSSN, clearSSN,
  // autopilot scheduler
  scheduleAutoPilot, cancelAutoPilot, getSchedulerStatus,
  onAutopilotTrigger, onAutoPilotCycleOverdue, onDeadlineAlert,
}
```

## Appendix B — Suggested investigation order for bugs

1. Reproduce on which platform (web / Electron / Android)?
2. Is state in AppContext, IDB, or localStorage cache stale?
3. Parser vs letter vs AutoPilot vs vault?
4. Open the owning service from §15; check validators/gates.
5. Confirm AI router provider health if generation fails.
6. Check cycle audit / history events for the timeline of what already ran.

## Appendix C — Safe upgrade checklist

- [ ] Identify target subsystem (parser / AutoPilot / letters / vault / platform)

- [ ] Read this reference + the module’s nearest `docs/*` deep dive

- [ ] Preserve IDB schema or bump version with migration

- [ ] Keep `aiRouter` as sole AI entry

- [ ] Keep AutoPilot cycles idempotent

- [ ] Run `npm run lint`

- [ ] Manually smoke: upload → negatives → one letter → preview AutoPilot cycle

- [ ] Update this file if architecture or contracts change

---

*DylandOs Ultimate Credit Repair Suite v5.0.0 — AI/developer reference. Keep in sync when major engines, stores, or platform bridges change.*