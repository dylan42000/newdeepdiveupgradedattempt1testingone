---
title: "World-Class Final Upgrade Plan — Dylando Ultimate Credit Repair Suite 5.0/5.1"
date: 2026-07-21
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
status: ready-for-review
supersedes: docs/autopilot/autopilot-world-class-upgrade-plan.md
companion_canvas: canvases/world-class-final-upgrade-plan.canvas.tsx
product: Dylando Ultimate Credit Repair Suite
platforms: [Windows Electron, Android Capacitor]
ai_policy: "Primary = Groq key1 + Groq key2 + Gemini; Backups = OpenAI + Cloudflare (+ existing)"
---

# World-Class Final Upgrade Plan

## Goal Capsule

Make Dylando the most powerful **on-device** credit dispute ops suite in this architecture by (1) turning Autopilot into a **per-item individualized strategist** with response-adaptive learning and explainability, (2) hardening account merge so **true matches merge and dissimilar accounts never do**, and (3) locking AI routing to **Groq×2 + Gemini primary** with OpenAI/Cloudflare as backups only — while preserving privacy, Windows+Android parity, and the existing V2/V3 Autopilot spine.

**Success North Star:** higher deletion/correction rate per cycle, lower frivolous/spam risk, near-zero false merges, every Autopilot action explainable to the user, zero first-party backend.

---

## Product Contract

### In scope

- Autopilot intelligence overhaul on `autoPilotEngineV2` + supporting engines (not a greenfield rewrite).
- Account merge unification + safety (false-positive reduction critical; true-match recall improvement).
- AI provider strategy, failover, Settings UX aligned to Groq1 / Groq2 / Gemini primary.
- Parser → dispute handoff quality (identity fidelity into letters).
- Evidence gates, letter review UX, cycle audit / explainability.
- Windows Electron + Android Capacitor deltas for scheduling, notifications, key storage, letter persistence.

### Out of scope (do not build)

See [Out of Scope / Do Not Build](#out-of-scope--do-not-build). Hard constraints:

- No first-party cloud backend / no off-device PII warehouse.
- No auto-mail enabled by default.
- No new primary AI vendors (Claude, etc.) this wave.
- No inventing DOFD from open date.
- No attorney-persona letter voice.
- Do not rip out V2 cycle anatomy or dual-write IDB contracts.

### Requirements traceability

| ID | Requirement | Origin |
|----|-------------|--------|
| R1 | Per-item individualized Autopilot strategy (bureau, Metro2, DOFD/SOL, evidence, frivolous, pass history, cross-bureau) | User brief A |
| R2 | Smarter batching with diversity + uniqueness + entropy (not identical templates) | User brief A |
| R3 | Response-adaptive learning loop (verified / deleted / updated / no-response) | User brief A |
| R4 | Pass ladder sophistication without spam/frivolous flags | User brief A |
| R5 | Preflight blocks dumb letters; enables smart enrichment | User brief A |
| R6 | Timeline / hold / inertia intelligence | User brief A |
| R7 | Letter voice/grounding uniqueness per account | User brief A |
| R8 | UI surfaces explaining WHY Autopilot chose each action | User brief A |
| R9 | Merge similarity redesign + hard refuse + soft confirm queue | User brief B |
| R10 | Cross-bureau **link** vs true **merge** distinction | User brief B |
| R11 | Merge metrics + golden fixtures | User brief B |
| R12 | AI primary = Groq1, Groq2, Gemini; backups = OpenAI, Cloudflare | User brief C |
| R13 | Windows + Android covered for platform-impacting work | User brief |
| R14 | Elevate power/functionality within on-device architecture | User brief D |

### Non-negotiable product principles (already in codebase)

From `technicalmanifestwindowsandroid.md` / `DYLANDOS-TECHNICAL-DEEP-DIVE.md`:

1. Local-first PII; AI receives only prompt-necessary fields.
2. Single AI gateway: `src/services/aiRouter.ts`.
3. Autopilot V2 is generate-and-queue; FCRA clocks start on **send**, not draft generation.
4. Heuristic parser is live path (`creditReportParser/`); do not resurrect dead 7-stage AI parser as primary.
5. Dual letter pipelines exist — Autopilot = `letterGeneratorV2`; UI may still use `geminiService`. Fixes must consider both when shared.

---

## Current-State Grounding (evidence)

### What is already world-class (build on — do not duplicate)

| Capability | Evidence | Plan stance |
|------------|----------|-------------|
| 6-pass ladder + holds + dual-target | `autoPilotEngineV2.ts` `DEFAULT_SETTINGS_V2` (~L101–114); deep dive §13 | Keep; enrich per-item |
| V3 auto-approve gates | `DEFAULT_SETTINGS_V3` (~L115–127); auto-approve block ~L774–788 | Keep defaults opt-in |
| Health grade A–F dashboard | `AutoPilotDashboard.tsx` ~L117–156 | Extend with Why panels |
| Letter DNA12 + entropy mixer | `letterDNA.ts` `buildLetterDNA12`; `letterGeneratorV2.ts` ~L521–570 | Keep; fix prior-letter uniqueness hole |
| Bureau calibration matrix | `bureauCalibrationEngine.ts` (deep dive §14) | Feed Strategy Cards |
| Evidence gate tiers | `evidenceGateService.ts` | Keep; enrich remediation |
| Pass-1 disclosure pivot on incomplete account | `autoPilotEngineV2.ts` ~L621–650 | Keep; extend identity fidelity |
| Parser → `runAutoMerge` | `creditReportParser/index.ts` imports orchestrator | Unify with tradeline path |
| Tradeline hard refuse (digit conflict, same bureau) | `tradelineMerger.ts` ~L212–228 | Promote to single authority |
| Dual Groq keys + Gemini in Settings | `Settings.tsx` ~L656–735; `KEY_NAMES` via `secureKeyService` | Clarify Primary vs Backup UX |
| Android WorkManager + BootReceiver; Electron chunked timers | manifest §13–15 | Parity polish only |

### Critical gaps (why this overhaul)

1. **Triple merge systems** disagree:
   - `accountMergeEngine.ts` `isSameAccount` threshold **≥2.0** (name/balance/suffix) — L226–228
   - `accountMergeEngine/mergeSimilarityEngine.ts` six-factor **≥85 / ≥65 / ≥45** — L22–23
   - `tradelineMerger.ts` **0.78 auto / 0.68 review** with stronger hard refuses — L3–6, L228
   - Parser uses orchestrator; UI/AppContext uses tradelineMerger → inconsistent merges.

2. **Uniqueness prior letters empty:** `evaluateDisputeUniqueness(..., [], passNumber)` in `autoPilotEngineV2.ts` ~L753–756 — anti-spam cannot compare to real prior content.

3. **`quality-first` prefers OpenAI for letters** (`aiRouter.ts` ~L558–559) — conflicts with product policy “Groq×2 + Gemini primary.”

4. **Outcome learning fragmented:** `handleResponse`, `deletionOutcomeEngine`, in-memory `disputeOutcomeTracker` — not fully driving next-cycle angle/batch/pass decisions.

5. **Batching is score-sorted fraction**, not individualized diversity (`batchSelector.ts` L72–79; max 2/creditor soft cap). Same-pass strategies still largely matrix-driven (`PASS_STRATEGY_MATRIX` in `letterGeneratorV2.ts`).

6. **Explainability thin:** health grade + progress strings exist; no durable per-item “decision card” surfaced as first-class UI.

7. **Prior April 2026 plan** (`docs/autopilot/autopilot-world-class-upgrade-plan.md`) correctly named SLA/evidence/diversification/KPIs — this document **supersedes** it with implementation-ready waves that incorporate V5.1 shipped work.

### Recent GPT 5.6 Sol / in-progress changes — do not fight

Treat as **already landed or mid-flight**; plan around them:

| Change | Implication |
|--------|-------------|
| Parser v5 path live; `goldenParser.ts` / `textAcquisition.ts` deleted | Do not restore; extend `creditParser` / `extractor` / reconstructors |
| `accountNumberReconstructor` + masked stitch | Autopilot must keep using `resolvePostProcessedAccountNumber` / healed account |
| Pass-1 disclosure pivot + Metro2 audit in cycle | Do not re-add duplicate disclosure engines |
| Letter Engine V3 DNA12 + citation rotation + fact blocks | Extend uniqueness priors; don’t replace DNA |
| Autopilot V3 settings (auto-approve floor 70, max pass 4, adaptive duplicate/frivolous) | Tune; don’t rename/replace settings schema casually |
| Dashboard health grade | Add Why/Strategy layers beside it |
| Dual Groq + Gemini Settings copy | Update routing so UX matches reality; fix `quality-first` |
| `tradelineMerger` identity gates | Prefer this as merge authority when unifying |

---

## Architecture Decisions

### AD-1 — Autopilot spine stays V2/V3; add Strategy Layer

**Decision:** Keep `AutoPilotEngineV2.runCycle` ordered steps. Insert a new **ItemStrategyPlanner** between batch selection and letter generation that emits durable `ItemStrategyCard` objects.

**Rationale:** Cycle idempotency, holds, timelines, and audit already work. Rewrite risk is high. Individualization fails today because strategy is mostly pass-matrix + bureau directive, not a fused per-item plan.

**Directional shape (not implementation code):**

```
ItemStrategyCard {
  itemId, pass, bureauTargets[], furnisherTarget?
  primaryAngle, metro2Hooks[], legalAnchors[]
  evidenceTier, frivolousRisk, solDaysRemaining
  crossBureauConflicts[], priorOutcomes[]
  batchDiversityTags[], explainWhy: string[]
  blockReasons[], enrichmentActions[]
}
```

### AD-2 — One merge authority; deprecate dual paths

**Decision:** Make `tradelineMerger`-class scoring the **single** cross-bureau merge authority for UI + parser post-process. Fold useful bits from `mergeSimilarityEngine` (factor transparency, account reconstruction) into it. Keep `accountMergeEngine.mergeAccountNumbers` as digit reconstruction only. Demote `isSameAccount` threshold-2.0 matching to compatibility wrapper or delete after migration.

**Tiers:**

| Decision | Meaning |
|----------|---------|
| AUTO_MERGE | True same account; combine into one NegativeItem / UnifiedTradeline |
| LINK_ONLY | Same consumer debt story across bureaus but keep separate rows; share campaign identity |
| SUGGEST / MANUAL_REVIEW | Soft confirm queue in Negative Items |
| NO_MERGE / HARD_REFUSE | Never auto; never suggest |

### AD-3 — AI routing policy rewrite

**Decision:** Provider modes become:

| Mode | Letter / legal cascade | Notes |
|------|------------------------|-------|
| `primary-stack` (new default) | Groq key1 ↔ key2 RR → Gemini → Cloudflare → OpenAI | Product default |
| `gemini-heavy` | Gemini → Groq×2 → CF → OpenAI | Parse / long CFPB |
| `backup-quality` (renamed quality-first) | Gemini → Groq×2 → OpenAI → CF | OpenAI never first for Autopilot letters unless user explicitly opts into `experimental-openai-first` (hidden/advanced) |

**Rationale:** Settings already tell users letters use Groq then Gemini; `quality-first` currently lies by putting OpenAI first.

### AD-4 — Response-adaptive closed loop

**Decision:** Persist outcomes into DisputeHistory + deletionOutcome store; feed ItemScorer, disputeAngleRotator, and Strategy Cards on next cycle. Auto-detect from new report upload via `deletionOutcomeEngine` should call the same sink as manual `handleResponse`.

### AD-5 — Platform parity contract

Any Autopilot scheduling / notification / key / vault change ships with:

- Windows: Electron IPC + chunked scheduler restore
- Android: `AutoPilotPlugin` / Worker / BootReceiver + `patchOnly` state merge
- Shared TS: no platform-only Autopilot truth in UI

---

## Planning Contract

### Priority bands

| Band | Meaning |
|------|---------|
| **P0** | Safety / correctness / false-merge / AI policy / letter identity |
| **P1** | Individualization power (strategy cards, learning, batching, Why UI) |
| **P2** | Polish, KPIs, advanced ladder, review UX, parity niceties |

### Wave overview

| Wave | Focus | Effort (eng-days, 1 senior) | Depends |
|------|-------|-----------------------------|---------|
| **Wave 1** | Merge unify + AI routing + uniqueness priors + Strategy Card MVP + Why strip | 8–12 | None |
| **Wave 2** | Response learning + smart batch diversity + preflight enrichment + pass ladder rules | 10–14 | Wave 1 Strategy Cards |
| **Wave 3** | KPI cockpit + letter review UX + Windows/Android parity hardening + golden regression pack | 8–12 | Wave 1–2 |

---

## A. Autopilot Intelligence Overhaul

### A1. Per-item Strategy Cards (P0→P1)

**Build:** `src/services/itemStrategyPlanner.ts` (new) consumed by `autoPilotEngineV2.ts` after `BatchSelector` / before letter loop.

**Inputs fused per item:**

| Signal | Source today |
|--------|--------------|
| Bureau personality | `bureauCalibrationEngine` |
| Pass posture | `PASS_STRATEGY_MATRIX` / targetPlanner |
| Metro2 flags | `auditMetro2` already in cycle ~L652–668 |
| DOFD / SOL | item fields + `expirationRadarService` / SOL skip in batchSelector |
| Evidence strength | `evidenceGateService` |
| Frivolous risk | `frivolousFlagGuard` + history |
| Pass / hold / inertia | pass map, HoldQueue, inertiaEscalationService |
| Cross-bureau conflicts | `crossBureauAnalyzer` |
| Prior outcomes | DisputeHistory + deletionOutcomeEngine (wire) |

**Acceptance:**

- Every generated letter has a persisted `strategyCardId` in cycle audit / letter metadata.
- Autopilot UI shows ≥3 human-readable `explainWhy` bullets per selected item before generate (preview) and after.
- Two items same pass+bureau can receive different angles when Metro2 / evidence / outcomes differ.

### A2. Smarter batching (P1)

**Extend** `batchSelector.ts` + `itemScorer.ts`:

- Keep deletability×urgency base.
- Add **diversity constraints**: max N same primaryAngle; max 1 “high frivolous risk Experian” per batch; prefer mix of pass numbers; prefer items with strong evidence first when dualTarget on.
- Emit `batchRationale` that lists diversity decisions (already has string — make structured).

**Acceptance:** Consecutive cycles on same portfolio do not produce near-identical letter DNA clusters (uniqueness score vs prior cycle letters ≥ floor).

### A3. Response-adaptive learning (P1)

**Wire:**

1. Upload/compare → `deletionOutcomeEngine` → same outcome sink as `handleResponse`.
2. Outcome → adjust next Strategy Card: verified → force angle rotation + MOV/furnisher bias; deleted → clear; no_response → inertia-aware bump; frivolous → weighted hold already present — keep adaptive 7–21d.
3. Creditor/bureau deletion rates from `disputeOutcomeTracker` must persist (today in-memory — promote to IDB).

**Acceptance:** After 2× verified same legal basis, Strategy Card refuses identical basis (frivolous guard already holds — strategy must rotate *before* generate).

### A4. Pass ladder without spam (P1)

- Keep 6-pass intent table from manifest.
- Enforce: uniqueness vs prior content; citation rotation; concentration throttle per creditor/bureau (from April plan Priority 3 — still valid).
- Pass 5–6 remain gated by evidence + history; auto-approve max pass stays ≤4 by default.

### A5. Preflight: block dumb, enable smart (P0/P1)

**Block (hard):** missing profile identity; unresolved placeholders; incomplete account on passes that claim specific account facts without disclosure pivot; evidence gate fail; high frivolous + no rotation; boilerplate assert fail.

**Enrich (soft):** AddressResearchAgent / vault attach (`autoAttachVaultDocsByType` already V3); stitch account number; Metro2 hooks into prompt fact block.

### A6. Timeline / hold / inertia (P1)

- Surface SLA cards (April plan Priority 1) on dashboard: due date, breach, next legal action.
- Inertia 30/45/60 already exists — Strategy Card must cite which tier fired.
- Hold reasons must be user-visible (FrivolousGuard, verified hold days, evidence remediation).

### A7. Letter uniqueness / voice (P0)

- **Fix** prior-letter fetch for `evaluateDisputeUniqueness` (empty `[]` is a defect).
- Keep consumerVoicePolicy + DNA12 + entropy.
- Grounding: fact block must include reconstructed account suffix when available (heal path already started).

### A8. Explainability UI (P1)

**Surfaces:**

1. Autopilot pre-cycle “Proposed Actions” list with Why.
2. Per-letter review chip: angle, risk, uniqueness, evidence tier.
3. Cycle audit export includes strategy cards (CSV/JSON).

Files: `AutoPilotDashboard.tsx`, `Autopilot.tsx`, `LetterReviewScreen.tsx`, `cycleAuditService.ts`.

---

## B. Account Merge Overhaul

### B1. Similarity scoring redesign (P0)

**Authoritative factors** (weights directional — calibrate on golden set):

| Factor | Role |
|--------|------|
| Account digit agreement (positional) | Strongest identity |
| Creditor alias-normalized name | Strong |
| Balance compatibility | Corroborator |
| Date opened / DOFD proximity | Corroborator |
| Account / negative type compatibility | Soft |
| Prefix agreement | Soft boost |
| Shared bureau | **Hard refuse auto-merge** (link or keep separate) |

Promote `tradelineMerger.scoreMergeCandidate` logic; import reconstruction from `mergeAccountNumbers` / `accountNumberReconstructor`.

### B2. Hard refuse rules (P0)

Never AUTO_MERGE / never SUGGEST when:

- Positional digit conflict on known chars
- Different visible last-4 (both present and unequal)
- Incompatible types (e.g., mortgage vs revolving) unless strong digit proof
- Same bureau already represented in group
- Weak name + no digit corroboration (stop-root collisions: AMERICAN/NATIONAL/…)

Conflicting last-4 → score capped below review floor (align with `mergeSimilarityEngine` min(score,44) spirit).

### B3. Soft confirm / review queue (P0)

- Negative Items review UX already has pending merge prompt — make it the only queue.
- Show factor breakdown (reuse MergeFactor / reasons[]).
- Parser path must enqueue SUGGEST/MANUAL into same AppContext queue, not silent dual behavior.

### B4. Link vs merge (P1)

- **Merge:** one consumer-facing tradeline, stitched account number, unified dispute campaign.
- **Link:** `campaignGroupId` shared across bureau rows without collapsing (for Autopilot cross-bureau deletion detection without false identity).

### B5. Metrics targets (P1)

| Metric | Target |
|--------|--------|
| False merge rate (golden adversarial set) | **≤ 1%** auto-merge FP |
| Missed true merge (recall on golden true pairs) | **≥ 90%** at SUGGEST+ tier; **≥ 75%** AUTO |
| User override reject rate on auto-merges | Monitor; alert if >5% in telemetry-less local audit samples |

### B6. Golden fixtures (P0)

Add `src/services/__fixtures__/merge/` (or `scripts/merge-golden/`):

- True 3-bureau mask stitch (EQ ****1234 / EX …1234 / TU 123456****1234)
- False: Cap One vs Cap One Auto different last-4
- False: AMERICAN EXPRESS vs AMERICAN HONDA shared root
- Borderline: name+balance no digits → MANUAL only
- Same bureau duplicates → NO_MERGE

Wire into `npm run test:upgrade` or dedicated `test:merge`.

---

## C. AI Provider Strategy

### C1. Primary / backup policy (P0)

| Rank | Provider | Role |
|------|----------|------|
| 1–2 | Groq key 1, Groq key 2 | Round-robin primary for letters/analyze/metro2/variation |
| 3 | Gemini | Primary for parse / long CFPB / legal_demand; failover for letters |
| 4 | Cloudflare | Backup free capacity |
| 5 | OpenAI | Backup quality / repair — **not** Autopilot default first hop |

Preserve: 429 → 60s cooldown; dual-key 401 failover; `apiQueueManager` + 3000ms Autopilot inter-letter delay.

### C2. Task-type routing (P0)

| Task | Cascade |
|------|---------|
| `letter`, `variation`, `goodwill`, `analyze`, `metro2_audit`, `score_impact`, `cross_bureau_diff`, `classify` | Groq×2 → Gemini → CF → OpenAI |
| `parse`, `cfpb_narrative`, `legal_demand` | Gemini → Groq×2 → CF → OpenAI |
| Autopilot letter scope | Prefer `providerScope: 'groq-gemini-only'` wait-on-cooldown behavior already present — keep |

### C3. Modes aligned to Autopilot (P0)

- Rename/remap Settings options to match reality (see AD-3).
- Cost/latency/quality: Autopilot default `primary-stack`; “Max quality backups” enables OpenAI earlier but **after** Gemini.

### C4. Settings UX (P1)

- Section headers: **Primary AI** (Groq1, Groq2, Gemini) vs **Backup AI** (OpenAI, Cloudflare).
- Status pills: configured / cooldown / last success provider.
- Keep DPAPI (Windows) / Keystore (Android) via `secureKeyService` — no keys in plaintext docs.

---

## D. Cross-Cutting World-Class Upgrades

| Theme | Action | Priority |
|-------|--------|----------|
| Parser→dispute handoff | Always prefer stitched/`fullAccountNumber`/healed token in letters, print, NegativeItems | P0 |
| Evidence vault gates | Remediation checklist UI when blocked; auto-attach by type (V3 flag) | P1 |
| Letter review | Side-by-side strategy Why + uniqueness + citations + approve/block | P1 |
| Dual letter pipelines | Shared validators/placeholders; don’t let UI `geminiService` regress Autopilot rules | P1 |
| Windows scheduler | Keep chunked timers; verify restoreSchedulerFromDisk after Strategy Card persistence | P1 |
| Android scheduler | Preserve `state` string contract + patchOnly; notifications deep-link Why summary | P1 |
| Security/privacy | No new network exfil; vault paths canonicalized; DOMPurify letter HTML | P0 |
| Observability | Cycle audit + strategy cards + merge decisions + provider used | P1 |
| Debug | Ctrl+Shift+D panel: show strategy card + merge score for selected item | P2 |

---

## Implementation Units (by wave)

### Wave 1 — Foundation & Safety (P0)

#### U1. Unify merge authority

- **Files:** `src/services/tradelineMerger.ts`, `src/services/accountMergeEngine/mergeSimilarityEngine.ts`, `src/services/accountMergeEngine/autoMergeOrchestrator.ts`, `src/services/accountMergeEngine.ts`, `src/services/creditReportParser/index.ts`, `src/context/AppContext.tsx`, `src/pages/NegativeItems.tsx`
- **Tests:** golden fixtures; FP/FN cases listed in B6
- **Done when:** one scorer; parser + UI same decisions; hard refuses covered

#### U2. AI routing + Settings truth

- **Files:** `src/services/aiRouter.ts`, `src/pages/Settings.tsx`
- **Done when:** default cascade matches Groq×2→Gemini; OpenAI not first for letters; Settings labels Primary/Backup

#### U3. Uniqueness prior-letter wiring

- **Files:** `src/services/autoPilotEngineV2.ts`, archive/history readers, `letterUniquenessService` / anti-spam
- **Done when:** uniqueness uses real prior bodies for same item/bureau; HIGH_RISK can block or force remix

#### U4. Strategy Card MVP + Why strip

- **Files:** new `itemStrategyPlanner.ts`; `autoPilotEngineV2.ts`; `cycleAuditService.ts`; `AutoPilotDashboard.tsx`
- **Done when:** cards persisted; dashboard lists Why for batch

#### U5. Identity fidelity regression guard

- **Files:** letter gen path, `resolvePostProcessedAccountNumber` consumers
- **Done when:** no fake `1234` fallback in hot paths; incomplete → disclosure pivot or as-reported token only

### Wave 2 — Intelligence (P1)

#### U6. Outcome learning loop

- Persist outcome tracker; connect upload detection → handleResponse sink; feed scorer/rotator

#### U7. Diversity-aware batch selector

- Structured batch rationale; concentration throttles

#### U8. Preflight enrichment UX

- Action-required queue with one-click vault attach / address research

#### U9. SLA / hold / inertia explainability

- Deadline cards; hold reason chips; inertia tier in Strategy Card

#### U10. LINK_ONLY campaign groups

- Cross-bureau Autopilot without unsafe collapse

### Wave 3 — Power Surface (P1/P2)

#### U11. KPI cockpit

- First/second pass deletion rates by bureau/creditor/reason; batch confidence trend (April Priority 5)

#### U12. Letter review experience upgrade

- Strategy + uniqueness + evidence + approve gates in one screen

#### U13. Windows/Android parity hardening

- Notification copy, scheduler edge cases, letter persistence when Electron vault N/A on Android

#### U14. Full golden regression pack

- Merge + Autopilot dry fixtures in `scripts/final-upgrade-regression.ts` expansion

---

## Verification Contract

### Per-wave gates

| Gate | Command / action |
|------|------------------|
| Typecheck | `npm run lint` (`tsc --noEmit`) |
| Upgrade regression | `npm run test:upgrade` (+ new merge tests) |
| Windows smoke | Enable Autopilot → run cycle → draft letters → scheduler restore after restart |
| Android smoke | `cap:sync` → schedule → BootReceiver re-enqueue → notification opens Autopilot |
| Merge golden | All fixtures pass; FP set never AUTO_MERGE |
| AI policy | With only Groq+Gemini keys, letters succeed; with Groq rate-limited, Gemini serves; OpenAI unused unless backup needed |
| Privacy | No new endpoints; keys remain in secure storage |

### Test scenarios (must be explicit for implementers)

1. **Merge FP:** AMEX vs American Honda → NO_MERGE / HARD_REFUSE.
2. **Merge TP:** 3-bureau masks same last-4 + compatible balance → AUTO_MERGE + stitch.
3. **Merge borderline:** strong name + balance, no digits → MANUAL_REVIEW only.
4. **Uniqueness:** second pass letter vs archived pass-1 body → score drops if near-duplicate; remix or block.
5. **Strategy:** Experian + prior frivolous → not same legal basis; hold or rotate.
6. **Learning:** upload shows account deleted → pass cleared, item not rebatched.
7. **AI:** Groq 429 → cooldown → Gemini letter; no OpenAI if Gemini healthy in primary-stack.
8. **Platform:** Android `patchOnly` updates nextCycleDateMs without wiping holds.
9. **Disclosure:** masked account Pass 1 → disclosure pivot; Pass 2+ normal ladder.
10. **Auto-approve:** uniqueness <70 or frivolous flag → stays draft.

### Regression risks

| Risk | Mitigation |
|------|------------|
| Merge unify changes user portfolios | Migration: re-score pending only; don’t auto-split historical merges without confirm |
| AI mode rename confuses users | Settings migration map `quality-first` → `backup-quality` with banner |
| Strategy Card slows cycles | Cap LLM calls — cards are deterministic rules first; AI only for optional enrichment |
| Dual letter pipelines drift | Shared validator module for both |
| Android state wipe | Never change Java `state` string contract without plugin + TS paired PR |

---

## Definition of Done — “World-Class”

The suite is world-class for this architecture when:

1. Autopilot argues **this account on this bureau** with a visible Why, not a batch of clones.
2. False merges are rarer than missed merges; users trust auto-merge.
3. Groq×2 + Gemini are the true primary path; backups are honest backups.
4. Outcomes from new reports change next-cycle strategy without manual babysitting.
5. Frivolous/spam risk is gated before send; uniqueness uses real history.
6. Windows and Android Autopilot cadence/notifications remain reliable after reboot.
7. An auditor can export cycle + strategy + merge decisions for any profile.

---

## Out of Scope / Do Not Build

1. First-party backend, accounts, cloud sync of credit reports.
2. Auto-mail / Lob dispatch **on by default** (keep opt-in, default off).
3. New primary AI vendors this program.
4. Greenfield Autopilot V4 rewrite replacing `runCycle` anatomy.
5. Restoring deleted `goldenParser` / AI-mandatory parse pipeline as production primary.
6. Inventing DOFD from open date / fabricating account digits.
7. Attorney or law-firm persona letters; UPL risk.
8. Silent merge of same-bureau duplicates into one row.
9. Putting OpenAI first in default letter routing.
10. Replacing DNA12 / V3 auto-approve / health grade with alternate parallel systems.
11. Weakening evidence gate to “ship more letters.”
12. Storing API keys in git, gist updater payloads, or unencrypted shared prefs beyond existing Keystore/DPAPI patterns.

---

## Conflicts With Recent GPT 5.6 Sol Work

| Topic | Conflict? | Resolution |
|-------|-----------|------------|
| DNA12 / letter V3 | No | Extend uniqueness priors only |
| V3 auto-approve settings | No | Keep defaults; Strategy Card feeds gates |
| Pass-1 disclosure pivot | No | Keep as identity path |
| Parser deletes (goldenParser) | No | Do not revive |
| Dual merge engines | **Yes** | Unify toward tradelineMerger + reconstruction; retire conflicting auto paths |
| `quality-first` OpenAI-first | **Yes** | Remap per AD-3; Settings copy already implies Groq→Gemini |
| Health dashboard | No | Add Why/Strategy beside grade |
| HealedAccount in cycle | No | Continue identity fidelity work |

---

## Relationship to Prior Autopilot Plan

`docs/autopilot/autopilot-world-class-upgrade-plan.md` (April 2026) remains useful as compliance intent (SLA cards, evidence scoring, diversification, KPIs). **This document supersedes it for sequencing and implementation.** Carry forward Priority 1–5 as Wave 2–3 units; do not re-implement features already present in V5.1 appendix (manifest §D).

---

## Appendix — Key file map

| Area | Paths |
|------|-------|
| Autopilot core | `src/services/autoPilotEngineV2.ts`, `src/pages/Autopilot.tsx`, `src/components/AutoPilotDashboard.tsx` |
| Batch / score / targets | `src/services/batchSelector.ts`, `itemScorer.ts`, `targetPlanner.ts` |
| Letters | `src/services/letterGeneratorV2.ts`, `letterDNA.ts`, `entropyLetterMixer.ts`, `consumerVoicePolicy.ts` |
| Guards | `evidenceGateService.ts`, `frivolousFlagGuard.ts`, `preFlightChecker.ts`, `letterUniquenessService` / anti-spam |
| Clocks | `holdQueue.ts`, `timelineTracker.ts`, `inertiaEscalationService.ts`, `escalationEngine.ts` |
| Merge | `tradelineMerger.ts`, `accountMergeEngine.ts`, `accountMergeEngine/*`, `accountIdentityService.ts`, `accountHealingEngine.ts` |
| AI | `aiRouter.ts`, `secureKeyService.ts`, `src/pages/Settings.tsx` |
| Platforms | `electron/main.cjs`, `src/services/androidScheduler.ts`, Android `AutoPilotPlugin.java` / `AutoPilotWorker.java` |
| Docs | `technicalmanifestwindowsandroid.md`, `DYLANDOS-TECHNICAL-DEEP-DIVE.md` |

---

## Recommended implementation order (executive)

1. **Merge unify + hard refuses + goldens** (stops silent portfolio damage)
2. **AI routing truth** (Groq×2 → Gemini primary)
3. **Uniqueness prior letters + identity fidelity guards**
4. **Strategy Card MVP + Why UI**
5. **Outcome learning persistence + feed-forward**
6. **Diversity batching + concentration throttles**
7. **SLA/hold explainability + LINK_ONLY**
8. **KPI cockpit + letter review + platform parity polish**

---

*Plan status: implementation-ready for review. No code was implemented in this planning pass.*
