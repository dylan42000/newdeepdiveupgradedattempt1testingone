# DylandOs — Ultimate Credit Repair Suite
Version 5.0.0 — Comprehensive Guide & Developer Reference

---

Welcome to DylandOs Ultimate Credit Repair Suite — a developer-grade, privacy-first, AI-assisted application for automating credit dispute workflows, multi-round escalation campaigns, and secure document management on desktop (Windows/Electron) and Android (Capacitor).

This README is a single-source master guide covering:
- Quick start (basic user)
- AutoPilot Engine — complete in-depth guide
- Parser, Letter Generation, and Vault
- Platform-specific guidance (Windows & Android)
- Developer API references and integration examples
- Build, test, and release steps
- Troubleshooting and best practices

---

## 1. Overview

DylandOs is an end-to-end credit dispute platform that combines:
- A strict, bureau-aware credit report parser
- An AI-backed letter generation engine with cascading provider failover (Groq → Gemini → OpenRouter)
- A multi-pass AutoPilot dispute engine (v1 stable, v2 adaptive with intelligence layer)
- Secure local Vault storage for PII and documents
- Exportable, print-ready dispute letters and batch PDF export with certified mail cover sheets

Goals:
- Maximize deletion probability while minimizing risk of re-aging
- Provide clear audit trails for every dispute action
- Keep sensitive keys and PII secure on-device

---

## 2. What's New in v5.0.0

### Sprint 3 — Full Autonomy
- **BUG-08 Fixed**: AutoPilot state now persists to IndexedDB (DB v4) with 4 new stores: `autopilotState`, `holdQueue`, `fcraTimeline`, `cycleAudit`. Automatic one-time migration from localStorage on first launch.
- **Inertia Escalation (GAP-A)**: 3-tier automatic advancement when items stall after a letter is sent — Day 30 nudge, Day 45 pass advance, Day 60 force escalation.
- **Evidence Gate (GAP-B)**: `evidenceGateService` evaluates vault documents before letter generation and blocks letter creation if critical evidence (government ID) is missing.
- **Cycle Audit Log (GAP-H)**: Every cycle run is recorded to IndexedDB with full result data — letters generated, items processed, escalations triggered, errors, duration, AI provider used.
- **Entropy Dispatch Scheduler (GAP-J)**: Staggers dispatch dates automatically — max 2 letters per bureau per day, 2-day cool-down after daily limit, deterministic jitter per item to appear organic.

### Sprint 4 — Intelligence Layer
- **Bureau Calibration Engine (GAP-I)**: Per-bureau tone and strategy calibration — Equifax (Metro 2 technical), Experian (consumer rights / CFPB), TransUnion (formal legal citations). Escalates automatically by pass number.
- **Strategy Rotation Engine (GAP-D)**: Detects stall scenarios (no response, double-verified, pass 4 stalled) and prevents strategy repetition. Includes delinquency date re-aging detection.
- **Frivolous Protocol (GAP-G)**: When a bureau marks a dispute frivolous, the engine activates FCRA §611(a)(3)(B) demand protocol — escalates pass +1, places item on 14-day hold, and generates an escalation event.
- **Batch PDF Export (GAP-F)**: Export multiple letters as a single PDF with optional certified mail cover sheet and mailing log table.
- **AutoPilot Dashboard Enhancements**: SLA Countdown Chips (FCRA deadlines with color-coded urgency), Evidence Readiness Meter, Cycle History Panel.

---

## 3. Quick Start — Basic User Guide

### Prerequisites
- Node.js (LTS >= 18) and npm
- On Windows: PowerShell or Command Prompt
- For Android: Java JDK 17+, Android SDK, Android Studio

### Clone and Install
```bash
git clone <repo-url>
cd "DYLANDOS ULTIMATE CREDIT REPAIR LATEST/newdeepdiveupgradedattempt"
npm ci
```

### Run (Web Development)
```bash
npm run dev
# Open http://localhost:3000 in your browser
```

### Run (Electron Desktop — Development)
```bash
npm run electron:dev
```

### Build (Electron / Windows)
```bash
npm run electron:build
# Outputs are in the release/ folder:
#   Dylando Ultimate Credit Repair Suite Setup 5.0.0.exe   (installer)
#   Dylando Ultimate Credit Repair Suite Portable 5.0.0.exe (portable)
#   win-unpacked/                                           (raw binaries)
```

### Android (Capacitor)
```bash
npm run cap:sync
npm run cap:open
```
Then open Android Studio and run assembleRelease.

### Configuring AI Providers
1. Open **Settings → AI Configuration** in-app.
2. Add keys for Groq, Gemini, or OpenRouter (recommended order: Groq → Gemini → OpenRouter).
3. Click **Test Connection**.

Keys are stored securely via `secureKeyService.ts` in Electron/Android. On web, keys fall back to localStorage.

---

## 4. AutoPilot Engine — Complete In-Depth Guide

### 4.1 What AutoPilot Does

AutoPilot is an autonomous multi-round dispute campaign engine. It selects negative items from your credit report, generates legally-grounded dispute letters, schedules them for mailing, tracks FCRA deadlines, and escalates through 5 progressively more aggressive passes until each item is either removed, corrected, or exhausted.

Every action is logged, every state is persisted to IndexedDB, and every cycle is idempotent — running it twice never produces duplicate letters or double-scheduled actions.

---

### 4.2 The 5-Pass Escalation System

Each negative item moves through up to 5 passes. A new pass is triggered automatically when a bureau responds with verification, when a deadline expires, or when the inertia escalation system detects stall.

#### Pass 1 — Initial Investigation Request
**Legal basis**: FCRA §611(a)(1) — Bureau's duty to investigate disputes within 30 days.

**What it does**: Sends a formal dispute letter requesting the bureau verify the accuracy and completeness of the negative item. Tone is cooperative and professional. Requests verification of all fields: account number, balance, payment history, dates.

**When it advances**: Bureau responds with "verified" (move to Pass 2), or 30–45 days pass with no response (inertia escalation advances to Pass 2).

---

#### Pass 2 — Failure to Investigate + Documentation Request
**Legal basis**: FCRA §611(a)(1), §616 (willful non-compliance liability), §617 (negligent non-compliance).

**What it does**: Escalates with a firm demand letter citing prior dispute reference. Requests documentary evidence proving verification — not just a restatement that the account is valid. Asserts that failure to provide proof of investigation violates FCRA §611(a)(1). Tone escalates to direct and firm.

**When it advances**: Bureau re-verifies without providing documents (move to Pass 3), stagnation triggers inertia escalation.

---

#### Pass 3 — Furnisher Direct Dispute + Metro 2 Challenge
**Legal basis**: FCRA §623(a)(8) — Consumer's right to dispute directly with furnisher. Metro 2 reporting format accuracy requirements.

**What it does**: Simultaneously disputes with the original furnisher (creditor, debt collector) AND the bureau. Demands Metro 2 compliance verification — challenges whether the furnisher is reporting the correct balance, DOFD (Date of First Delinquency), and account status. Bureau receives a copy of the furnisher dispute. Tone is assertive with legal citations.

**When it advances**: Furnisher or bureau re-verifies (move to Pass 4), or inertia triggers auto-advancement.

---

#### Pass 4 — Pre-Litigation Warning + CFPB Notice
**Legal basis**: FCRA §616 (willful violation — up to $1,000 actual + punitive per violation), §617 (negligence — actual damages), FDCPA §809 (debt validation), CFPB enforcement authority.

**What it does**: Issues a formal pre-litigation warning. States that continued reporting of unverifiable information constitutes willful non-compliance under FCRA. Demands permanent deletion or provides 10 business days for response before initiating CFPB complaint. Tone is aggressive with explicit statutory damage calculations.

**When it advances**: Item survives (move to Pass 5) or inertia auto-advances.

---

#### Pass 5 — Regulatory Escalation (CFPB / State AG)
**Legal basis**: FCRA §616, §617, §623 — all previously cited; CFPB Regulation V enforcement; State Attorney General authority; FDCPA §806–808.

**What it does**: Final pass. Generates a formal regulatory demand letter — not a standard dispute. States that a complaint has been or will be filed with the CFPB and/or State AG. Includes all prior dispute dates, bureau reference numbers, and a full chronology of failed verification attempts. This is the highest-pressure letter. Dispatch date is fixed to base date (no entropy delay).

**Expected outcome**: Deletion, account status correction, or consumer protection referral.

---

### 4.3 Configuring AutoPilot Settings

Open **AutoPilot → Settings** panel to configure:

| Setting | Description | Recommended |
|---|---|---|
| `roundSize` | Max items per cycle batch | 4–8 for first campaigns |
| `maxItemsTotal` | Hard cap on total items in campaign | Match your negative item count |
| `staggerByBureau` | Space out letters by bureau across different days | Always ON |
| `batchStrategy` | `balanced` (default), `aggressive`, `conservative` | `balanced` for most users |
| `holdDays` | Minimum days between passes for same item | 30 (matches FCRA §611 window) |
| `dualTargetMode` | Dispute bureau AND furnisher simultaneously | ON for collections and charge-offs |
| `maxPassNumber` | Maximum pass to escalate to (1–5) | 5 for full escalation |

**Strategy Notes:**
- `balanced`: Respects hold timers, selects items by priority score, respects roundSize.
- `aggressive`: Selects highest-priority items first, uses full roundSize every cycle.
- `conservative`: Batches smaller than roundSize, longer hold periods, fewer simultaneous disputes.

---

### 4.4 Running a Cycle — Step by Step

#### Step 1: Upload Your Credit Report
1. Go to **Upload Report**.
2. Drop a PDF or paste the raw text from all 3 bureaus.
3. The parser identifies negative items — collections, charge-offs, late payments, judgments, etc.
4. Review extracted items in **Negative Items** view. Confirm each one is accurate.

#### Step 2: Check Evidence Readiness
Before your first cycle, open **AutoPilot** and review the **Evidence Readiness Meter** in the dashboard:
- **BLOCKED (< 35)**: Upload a government-issued photo ID to the Vault. Letters cannot be generated without it.
- **BASIC (35–59)**: ID present but limited supporting documents. Letters will work but have reduced legal hooks.
- **STRONG (60–84)**: ID + dispute-specific documents present. Full legal arguments available.
- **AUDIT-PROOF (85+)**: Complete documentation. Maximum legal pressure applied to every letter.

Upload supporting documents to the **Vault** (proof of address, account statements, payment records, identity theft reports) to increase your score.

#### Step 3: Set Up a Campaign
1. In **AutoPilot**, click **New Campaign**.
2. Configure the settings above.
3. Set `roundSize` to 4–6 for your first run.
4. Enable `staggerByBureau`.
5. Leave `holdDays` at 30 unless you have specific timing needs.

#### Step 4: Run a Cycle (Dry Run First)
1. Click **Preview Cycle** (dry run). The engine will:
   - Select the optimal batch from eligible items.
   - Show you what letters would be generated, what pass each item is on, and the scheduled dispatch dates.
   - Display any items on hold and when they will become eligible.
2. Review the preview. Check that the items selected match your priorities.
3. Click **Run Cycle** to execute.

#### Step 5: The Engine Runs
During execution the engine:
1. Loads current pass numbers and hold queue from IndexedDB.
2. Applies inertia escalation to any stalled items (30/45/60 day tiers).
3. Checks for overdue FCRA windows (BUG-09 fix) — if a bureau should have responded already, the engine forces pass advancement.
4. Runs evidence gate check — skips items with insufficient vault documents.
5. Selects the batch using priority scoring and your configured strategy.
6. For each selected item: determines bureau-specific tone (Equifax=technical, Experian=consumer rights, TransUnion=formal), builds the strategy rotation recommendation, generates the letter via the AI router.
7. Validates every generated letter (no hallucinated statutes, correct citations, sufficient length).
8. Builds an entropy dispatch schedule — staggers mailing dates so you're not mailing 10 letters to Equifax on the same day.
9. Saves cycle results to the `cycleAudit` IndexedDB store.
10. Saves pass numbers back to `autopilotState` store.

#### Step 6: Print and Mail Letters
1. After the cycle, all generated letters appear in **Dispute Letters**.
2. Click **Print All** to open the batch PDF export.
3. Enable **Include Certified Mail Cover Sheet** if you want a mailing log for your records.
4. Print each letter.
5. Mail via USPS Certified Mail (Return Receipt Requested) to each bureau's dispute department address printed in the letter.
6. Record the certified mail tracking number for each letter.

**Bureau Mailing Addresses:**
- **Equifax**: P.O. Box 740256, Atlanta, GA 30374-0256
- **Experian**: P.O. Box 4500, Allen, TX 75013
- **TransUnion**: P.O. Box 2000, Chester, PA 19016

#### Step 7: Log the Certified Mail Numbers
1. In **Dispute Letters**, click each sent letter.
2. Enter the USPS Certified Mail tracking number.
3. Click **Mark as Sent**. The letter status changes from `draft` to `sent`.
4. The FCRA 30-day clock starts from the date you mark it as sent.

#### Step 8: Wait and Watch the SLA Countdown
The **SLA Countdown Chips** in the AutoPilot dashboard show each active dispute's FCRA deadline:
- **Green**: More than 14 days remaining. No action needed.
- **Yellow**: 7–14 days remaining. Check your mailbox for bureau responses.
- **Red**: Under 7 days. Expect a bureau response imminently. Prepare for next pass.
- **Expired**: Deadline passed with no logged response. Engine will auto-escalate on the next cycle.

---

### 4.5 Logging Outcomes — What Each Response Type Does

When a bureau responds (by mail), log the outcome in **Dispute Letters → Log Response**:

| Outcome | What It Means | What AutoPilot Does |
|---|---|---|
| **Deleted** | Item removed from credit report | Marks item as resolved. Removes from all future batches. Logs `deletion` event. |
| **Updated** | Item information corrected (balance, status, date) | Marks partial win. If status is no longer negative, moves to watch-only mode. |
| **Verified** | Bureau says item is accurate | Moves item to next pass. Sets 30-day hold before re-dispute. |
| **No Response** | Bureau did not reply within 30 days | FCRA §611 violation. Engine logs `no_response` event, advances pass, references prior window expiration in next letter. |
| **Frivolous** | Bureau calls dispute frivolous (FCRA §611(a)(3)) | **Frivolous Protocol Activates**: engine escalates pass +1, places item on 14-day hold, generates demand letter citing FCRA §611(a)(3)(B) requiring bureau to notify consumer of reasons for frivolous determination and provide opportunity to correct. |

---

### 4.6 Auto-Escalation — How the Engine Escalates Without You

AutoPilot v2 includes three automatic escalation mechanisms so items cannot get permanently stuck:

#### Overdue FCRA Window (BUG-09)
If a letter was marked sent more than 30 days ago and no outcome has been logged, the engine checks whether the FCRA investigation window has expired. If it has, the item is force-escalated to the next pass on the next cycle run, citing FCRA §611(a)(1) deadline violation in the new letter.

#### Inertia Escalation (GAP-A)
Monitors how many days have passed since the last letter was sent for each item:
- **Day 30**: Nudge warning in cycle log — "Check your mailbox and log bureau response."
- **Day 45**: Pass advance — item automatically moves to next pass. Letter for new pass is generated next cycle. Logged as `[INERTIA-ADVANCE]`.
- **Day 60**: Force escalate — item is immediately removed from hold queue, pass is advanced by 1, and a new letter is generated in the current cycle. Logged as `[INERTIA-FORCE]`.

#### Hold Queue Expiry
Items placed on hold (after a "Verified" or "Frivolous" response) are automatically released from hold when their hold period expires. On the next cycle, the engine promotes their pass number by 1 and makes them eligible for the next batch.

---

### 4.7 Bureau-Specific Strategy — What the Engine Does Per Bureau

The bureau calibration engine (`bureauCalibrationEngine.ts`) applies different strategies per bureau at each pass level:

#### Equifax
- **Preferred approach**: Technical Metro 2 accuracy challenges.
- **Average response time**: ~28 days.
- **Pass 1–2**: Request investigation with Metro 2 field verification.
- **Pass 3–4**: Challenge specific Metro 2 fields (DOFD, account status code, payment rating).
- **Pass 5**: CFPB complaint draft + Metro 2 format violation allegation.

#### Experian
- **Preferred approach**: Consumer rights citations, CFPB guidance references.
- **Average response time**: ~25 days (fastest responder).
- **Pass 1–2**: FCRA §611 rights assertion with proof of dispute submission.
- **Pass 3–4**: CFPB Bulletin references + §623 furnisher direct dispute.
- **Pass 5**: CFPB complaint + Experian-specific supervisory authority reference.

#### TransUnion
- **Preferred approach**: Precise statutory citations, formal legal tone.
- **Average response time**: ~30 days (most formal process).
- **Pass 1–2**: Precise §611 / §623 language.
- **Pass 3–4**: Dual-target furnisher dispute + FCRA damage calculation ($1,000/violation).
- **Pass 5**: State AG referral notice + pre-litigation demand.

---

### 4.8 Entropy Dispatch Scheduler — Avoiding Anti-Automation Detection

The entropy scheduler (`entropyDispatchScheduler.ts`) prevents bureaus from pattern-detecting automated dispute campaigns by:

1. **Daily bureau cap**: Maximum 2 letters per bureau per day. If you have 8 Equifax letters, they are spread across 4+ days.
2. **2-day cool-down gap**: After hitting the daily limit for a bureau, a mandatory 2-day gap is inserted before the next Equifax batch.
3. **Deterministic jitter**: Each item gets a 0–1 day randomized delay based on a hash of its item ID and bureau name. Same item always gets the same delay (reproducible), but each item looks different.
4. **Pass 5 override**: Final pass letters are always dispatched on the base date — no delay. Maximum urgency on final escalation.

The scheduler output is shown in the cycle preview so you know exactly when each letter is scheduled to mail.

---

### 4.9 Evidence Readiness Meter

The **Evidence Readiness Meter** (AutoPilot dashboard, lower left) shows a 0–100 score based on documents in your Vault:

| Tier | Score Range | What It Means |
|---|---|---|
| BLOCKED | 0–34 | No government ID in vault. Letter generation is blocked. Upload a photo ID to proceed. |
| BASIC | 35–59 | Government ID present. Limited additional evidence. Letters are functional but lack maximum legal hooks. |
| STRONG | 60–84 | ID + dispute-specific documents (account statements, payment records). Full legal arguments enabled. |
| AUDIT-PROOF | 85–100 | Complete documentation package. Maximum legal pressure on every letter. |

**Document scoring:**
- Government-issued photo ID: +35 points (required to unlock)
- Proof of address (utility bill, bank statement): +25 points
- Account statement / original creditor agreement: +15–25 points (dispute-type dependent)
- Identity theft police report / FTC affidavit: +20 points
- Payment confirmation records: +10 points

To maximize your score, upload documents to **Vault → Upload Document** before running your first cycle.

---

### 4.10 Cycle History Panel — Reviewing Your Audit Trail

The **Cycle History Panel** (AutoPilot dashboard, bottom section) shows a paginated list of all past cycle runs:

Each entry shows:
- Date and time of the cycle run
- Number of letters generated
- Number of items processed
- Auto-advancement events triggered (inertia escalation count)
- Any errors that occurred during the cycle
- Duration of the cycle run in seconds
- A green dot (success) or red dot (errors present)

Click **Show all X cycles** to expand the full history.

Every cycle record is stored in IndexedDB (`cycleAudit` store) and survives app restarts. This is your legal-grade audit trail showing the full history of your dispute campaign with timestamps.

---

### 4.11 Strategy Rotation Engine — Preventing Repetition

The strategy rotation engine (`strategyRotationEngine.ts`) ensures each pass uses a different legal argument:

| Scenario | Strategy Used |
|---|---|
| First dispute (`freshly-disputed`) | Initial investigation request (FCRA §611) |
| Bureau didn't respond (`no-response`) | Failure to investigate + §616 / §617 liability notice |
| Bureau verified twice (`double-verified`) | Furnisher direct dispute (FCRA §623(a)(8)) |
| Item stalled across passes (`stalled`) | Metro 2 accuracy challenge |
| Pass 4 with no movement (`pass4-stalled`) | Pre-CFPB / State AG notice |

The engine also detects **delinquency date re-aging** — if a bureau reports a different (more recent) DOFD than what appeared on your original report, the engine flags it as a potential re-aging violation and adds a re-aging demand clause to the next letter. Re-aging a delinquency date to make old debt appear newer is illegal under FCRA.

---

### 4.12 Complete AutoPilot Workflow — Summary Checklist

```
□ 1. Upload credit reports for all 3 bureaus
□ 2. Review extracted negative items — confirm accuracy
□ 3. Upload government ID to Vault (required)
□ 4. Upload any additional supporting documents to Vault
□ 5. Check Evidence Readiness Meter — target STRONG or AUDIT-PROOF
□ 6. Configure campaign settings (roundSize 4–6, staggerByBureau ON)
□ 7. Run Preview Cycle — review what will be generated
□ 8. Run Cycle — generate letters
□ 9. Review each letter in Dispute Letters
□ 10. Export batch PDF with certified mail cover sheet
□ 11. Print and mail via USPS Certified Mail (Return Receipt Requested)
□ 12. Log certified mail tracking numbers in each letter record
□ 13. Watch SLA Countdown Chips (yellow = check mailbox, red = response due soon)
□ 14. When bureau response arrives: log outcome (Deleted/Updated/Verified/No Response/Frivolous)
□ 15. Run next cycle after hold period (30 days) — engine auto-advances stalled items
□ 16. Repeat until all items are resolved or Pass 5 exhausted
□ 17. For unresolved Pass 5 items: file CFPB complaint at consumerfinance.gov/complaint
```

---

## 5. Credit Report Parser

### How It Works
1. Accepts PDF (via pdfjs-dist extraction) or plain text paste.
2. Detects which bureau format each page belongs to (Equifax, Experian, or TransUnion).
3. Applies bureau-specific parsing templates — no generic cross-bureau regex.
4. Validates every extracted item with `isValidTradeline()`: requires creditorName + (accountNumber OR balance) + status.
5. Rejects section headers, personal info blocks, inquiry headers, score factor text, address lines, and summary rows — these are never tradelines.
6. Deduplicates: same account appearing across multiple bureaus is merged into one item with a `bureaus[]` array.
7. All rejected lines go to `rejectedLines[]` debug log with reason — nothing is silently dropped.

### Strict Negative Status Criteria
Only the following statuses are flagged as negative (exact match only — no fuzzy matching):
- Collection
- Charge-off / Charged Off
- Late 30 / Late 60 / Late 90 / Late 120
- Derogatory
- Delinquent
- Repossession
- Foreclosure
- Judgment
- Bankruptcy
- Settled
- Account closed by credit grantor

### Parser Debug Panel
Open **Debug Parser** to see:
- Raw extracted text per page
- Regex matches attempted per bureau
- Items accepted vs. rejected
- Rejection reason per rejected line

---

## 6. Letter Generation Engine

### Letter Templates
- **initial**: First contact dispute under FCRA §611(a)(1)
- **followup**: Re-dispute after verification, citing prior reference
- **escalation**: Firm demand with liability citations (§616, §617)
- **goodwill**: Goodwill deletion request for paid accounts with prior good history
- **pay-for-delete**: Structured settlement offer for collection accounts

### Tones
- **formal**: Professional, measured — ideal for Pass 1–2
- **direct**: Clear and confident — ideal for Pass 3
- **aggressive**: Pre-litigation posture — ideal for Pass 4–5

### AI Router Failover
Letter generation uses the AI router cascade:
1. Groq (primary — fastest)
2. Gemini (secondary — highest quality)
3. OpenRouter (tertiary — backup)

All providers route through `aiRouter.request()`. Provider credentials are never logged. Rate-limit cooldowns persist per session. If all providers fail, the engine returns a validation error and logs the failure.

### Letter Validation
Every generated letter is validated before being saved:
- Minimum 150 words
- Contains at least one valid FCRA or FDCPA citation
- No fabricated statute numbers (validated against approved citation list)
- Correct bureau address
- Consumer's name and address present

---

## 7. Vault — Secure Document Storage

The Vault stores PII documents and sensitive files locally on-device.

- Upload documents via **Vault → Upload Document**.
- Documents are stored in IndexedDB (`vaultDocs` store).
- API keys are stored separately via `secureKeyService.ts` (Electron keytar or encrypted localStorage fallback).
- Never upload vault documents to any external service — they stay local.

Vault documents contribute to your Evidence Readiness score (see Section 4.9).

---

## 8. Platform Build Guide

### Windows (Electron)

Requirements: Node.js 18+, npm

```bash
npm ci
npm run electron:build
```

Outputs (in `release/`):
- `Dylando Ultimate Credit Repair Suite Setup 5.0.0.exe` — NSIS installer
- `Dylando Ultimate Credit Repair Suite Portable 5.0.0.exe` — Portable EXE (no install needed)
- `win-unpacked/` — Raw unpacked binaries

Notes:
- Builds use `base: './'` in Vite for relative asset paths (required for Electron portable).
- In PowerShell, template variable artifact names must be wrapped in single quotes.
- Auto-updater support is pre-configured in `electron-builder.json`.

### Android (Capacitor)

Requirements: Java JDK 17+, Android SDK (API 35 target, API 24 minimum), Gradle 8.x

```bash
npm run build
npm run cap:sync
npm run cap:open
# In Android Studio: Build → Generate Signed Bundle/APK → Release
```

---

## 9. Troubleshooting

### AutoPilot not generating letters
1. Check Evidence Readiness Meter — score must be above 35 (BASIC). Upload government ID to Vault.
2. Check if all items are on hold. Items on hold show in the Hold Queue panel.
3. Verify at least one AI provider key is configured in Settings.
4. Run a Preview Cycle to see if any items are selected before executing.

### Items stuck in hold
- Hold is a minimum wait period (default 30 days) between disputes for the same item.
- Inertia escalation will auto-release items after 45 days even without a logged outcome.
- You can manually release an item from hold in **AutoPilot → Hold Queue**.

### Letters not accepted by bureau
- Ensure certified mail tracking number is on the envelope.
- Verify your name and address in the letter exactly match your credit report.
- For Equifax, include your date of birth and last 4 SSN on the letter (per their dispute requirements).

### Parser extracting false positives
- Open **Debug Parser** and check rejected lines.
- Paste only the "Accounts" section of the credit report — exclude Summary, Inquiries, and Personal Information sections.
- If a specific item is being misclassified, use **Negative Items → Edit** to manually correct it.

### TypeScript build errors
- `scripts/` and `Testparsercreated/` contain pre-existing type mismatches that do not affect the app build. These are utility/test files excluded from the production bundle.

---

## 10. Legal Reference

| Law | Section | Rule Applied |
|---|---|---|
| FCRA | §609 | Right to request original creditor verification documents |
| FCRA | §611(a)(1) | Bureau must investigate disputes within 30 days |
| FCRA | §611(a)(3)(B) | Bureau must notify consumer of frivolous determination and basis |
| FCRA | §612 | Free report rights after adverse action |
| FCRA | §613 | Accuracy requirements for consumer reporting agencies |
| FCRA | §616 | Civil liability for willful non-compliance ($1,000 + punitive) |
| FCRA | §617 | Civil liability for negligent non-compliance (actual damages) |
| FCRA | §623(a)(8) | Consumer's right to dispute directly with furnisher |
| FDCPA | §806 | Prohibition on harassment by collectors |
| FDCPA | §807 | Prohibition on false/misleading representations |
| FDCPA | §808 | Prohibition on unfair practices |
| FDCPA | §809 | Debt validation rights — 30-day window |
| FACTA | Various | Free annual report, identity theft provisions, account truncation |
| Metro 2 | Standard | Reporting format accuracy, dispute flag requirements |
| CROA | Full | Credit Repair Organizations Act — disclosure requirements |

---

## 11. Data Architecture

| Store | IndexedDB Key | Contents |
|---|---|---|
| `appState` | `key` | Global application state |
| `vaultDocs` | `id` | Encrypted vault documents |
| `historyEvents` | `id` | Dispute event history |
| `autopilotLogs` | `id` | AutoPilot run logs |
| `scoreEntries` | `id` | Credit score history |
| `disputeItems` | `id` | Negative item records |
| `disputeLettersV2` | `id` | Generated letter records (v2) |
| `generatedLetters` | `id` | Legacy letter records |
| `bureauResponses` | `id` | Bureau response records |
| `disputeOutcomes` | `id` | Resolved item outcomes |
| `userProfiles` | `id` | User profile data |
| `autopilotState` | `key` | Pass numbers per item per profile |
| `holdQueue` | `id` | Items on hold with expiry dates |
| `fcraTimeline` | `id` | FCRA 30/45-day deadline tracking |
| `cycleAudit` | `cycleId` | Full cycle run audit records |

---

## 12. Developer API — Key Services

| Service | Export | Purpose |
|---|---|---|
| `aiRouter` | `aiRouter.request(task, prompt, options)` | Single AI call point — Groq → Gemini → OpenRouter failover |
| `geminiService` | `parseCreditReport(text)` | Bureau-aware credit report parser |
| `geminiService` | `generateLetter(item, config)` | AI dispute letter generation |
| `autoPilotEngineV2` | `AutoPilotEngineV2.runCycle(profileId, items, settings, progress)` | Main cycle engine |
| `evidenceGateService` | `evaluateEvidenceReadiness(vaultDocs, disputeType)` | Evidence strength scoring |
| `entropyDispatchScheduler` | `buildEntropyDispatchSchedule(items, baseDate)` | Anti-detection dispatch scheduling |
| `bureauCalibrationEngine` | `getBureauCalibrationDirective(bureau, pass)` | Bureau-specific tone/strategy |
| `strategyRotationEngine` | `getRotationStrategy(item, pass, history)` | Anti-repetition strategy selection |
| `batchExportService` | `exportBatchPDF(letters, personalInfo, options)` | Multi-letter PDF export |
| `cycleAuditService` | `getCycleHistory(profileId)` | Retrieve cycle audit records |
| `holdQueue` | `HoldQueueManager` | Hold queue CRUD operations |
| `timelineTracker` | `TimelineTracker` | FCRA deadline tracking |
| `autopilotMigration` | `runAutopilotMigration(profileIds)` | One-time localStorage → IDB migration |

---

*DylandOs Ultimate Credit Repair Suite v5.0.0 — Built for maximum dispute precision, legal accuracy, and consumer protection.*


---

1. Overview
--------------

DylandOs is an end-to-end credit dispute platform that combines:
- A strict, bureau-aware credit report parser
- An AI-backed letter generation engine with cascading provider failover (Groq → Gemini → OpenRouter)
- A multi-pass AutoPilot dispute engine (v1 stable, v2 adaptive)
- Secure local Vault storage for PII and documents
- Exportable, print-ready dispute letters and batch ZIP export

Goals:
- Maximize deletion probability while minimizing risk of re-aging
- Provide clear audit trails for every dispute action
- Keep sensitive keys and PII secure on-device

2. What's New in v4.0.0
-------------------------
- Parser upgrades: multi-chunk parsing, robust JSON recovery, cross-chunk deduplication, strict DOFD handling
- AutoPilot V2: adaptive 5-pass engine, hold-queue persistence, idempotent cycles, per-campaign scheduling
- AI Router: provider failover with rate-limit cooldowns and task-aware routing
- New letter templates and Smart Letter mode with vulnerability targeting
- SecureKeyService integrated for storing provider keys on-device

3. Quick Start — Basic User Guide
----------------------------------

Prerequisites
- Node.js (LTS >= 18) and npm
- On Windows: PowerShell or Command Prompt
- For Android: Java JDK 17+, Android SDK, Android Studio

Clone and Install

```bash
git clone <repo-url>
cd "d:/downloads/DYLANDOS ULTIMATE CREDIT REPAIR LATEST/newdeepdiveupgradedattempt"
npm ci
```

Run (Web Development)

```bash
npm run dev
# Open http://localhost:3000 in your browser
```

Run (Electron Desktop — Development)

```bash
npm run electron:dev
```

Build (Electron / Windows)

```bash
npm run electron:build
# Outputs are in the release/ folder (installer, portable, win-unpacked)
```

Android (Capacitor)

```bash
npm run cap:sync
npm run cap:open
```

Then open Android Studio and build the Android project (assembleRelease) or run on emulator/device.

Configuring AI Providers
1. Open Settings → AI Configuration in-app.
2. Add your API keys for Groq, Gemini, or OpenRouter (recommended order: Groq → Gemini → OpenRouter)
3. Click Test Connection.

Notes: Keys are stored securely via `src/services/secureKeyService.ts` when running in Electron or Android. On web, keys will be stored in memory/localStorage as a fallback — avoid storing long-term in a public web deployment.

4. Advanced Walkthrough — AutoPilot & Parser
--------------------------------------------

Uploading Reports
- Go to Upload Report
- Drop a PDF or paste raw text
- The parser (`src/services/geminiService.ts`) performs preprocessing, chunking, AI extraction, sanitization, and deduplication.

Parser Guarantees
- Every extracted item is validated with strict rules (DOFD mandatory when available).
- Duplicate cross-bureau items are merged into a single item with a `creditBureau` array.
- Rejected lines and parsing anomalies are logged for debugging.

AutoPilot (High-level)
- AutoPilot runs cycles: select batch → generate letters → mark mailed → log responses → escalate or close.
- V2 introduces: hold-queue persistence, pass-based escalation, and idempotent cycles.

AutoPilot Configuration (UI)
- `roundSize`: max items per batch (default safe range: 4–12)
- `staggerByBureau`: when true, spaces out letters per bureau
- `batchStrategy`: `balanced`, `aggressive`, or `conservative`

Best Practices
- Use `staggerByBureau` to avoid mass-simultaneous responses.
- Keep `roundSize` modest (8 or fewer) for first runs.
- Enable dual-target mode (bureau + furnisher) for hard-to-remove items.

Response Handling
- When you receive a bureau response, log it in the app (Deleted/Updated/Verified/No Response).
- `No Response` is a powerful legal indicator — escalate to CFPB after documenting.

5. Platform Notes — Windows (Electron) & Android (Capacitor)
-----------------------------------------------------------

Windows / Electron
- The desktop app packages via `electron-builder` with outputs in `release/`.
- Installer and portable builds are produced by `npm run electron:build`.
- Signing (recommended) — set `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables for code signing during CI.
- If you need an auto-update server, configure `electron-updater` and add keys to your build config. See `electron-builder.json`.

Android / Capacitor
- Scripts: `npm run cap:sync` (sync web build into native project), `npm run cap:open` (open in Android Studio)
- Requirements: JDK 17+, Android SDK, proper `ANDROID_HOME`/`ANDROID_SDK_ROOT` env vars
- Signing: configure signing configs in `android/app/build.gradle` and `gradle.properties` for release builds
- Android-specific helpers: `src/services/pdfGeneratorAndroid.ts` for PDF generation optimizations on Android

Background Tasks & Limitations
- AutoPilot scheduling is persisted locally (IndexedDB). On mobile, background execution is limited by OS. Long-running campaigns assume periodic app foreground or external scheduling (consider platform-specific background tasks/plugins if required).

6. Developer API & Integration Examples
--------------------------------------

Core Services
- AI Router: `src/services/aiRouter.ts` — use `routeAIRequest()` and `aiComplete()` for task-specific AI calls.
- Parser & Letter Engine: `src/services/geminiService.ts` — functions `parseCreditReport()` and `generateDisputeLetter()` are public.

Parsing Example

```ts
import { parseCreditReport } from './src/services/geminiService';
import fs from 'fs/promises';

const text = await fs.readFile('sample-report.txt', 'utf8');
const items = await parseCreditReport(text, 'text/plain');
console.log('Parsed items:', items.length);
```

Generate a Dispute Letter Example

```ts
import { generateDisputeLetter } from './src/services/geminiService';

const letterHtml = await generateDisputeLetter(
  [items[0]],
  { name: 'Jane Doe', address: '1 Main St', ssn: '1234', dob: '1980-01-01' },
  '611-Reinvestigation',
  'Equifax',
  1
);
console.log(letterHtml);
```

AI Router Example

```ts
import { aiComplete } from './src/services/aiRouter';

const out = await aiComplete('You are a parser', 'Extract negative accounts from this text...', 'parse');
console.log(out);
```

Secure Keys (programmatic)

```ts
import { setGroqApiKey } from './src/services/aiRouter';
setGroqApiKey(process.env.GROQ_API_KEY || '');
```

Agent Service (Planned Integration)
----------------------------------
The project design expects an `agentService` action interface (recommended file `src/services/agentService.ts`) that exposes actions such as:

```ts
interface AgentService {
  ingestReport(source: 'text'|'pdf', data: string, filename?: string): Promise<NegativeItem[]>;
  listItems(filter?: any, paging?: any): Promise<NegativeItem[]>;
  createOrUpdateItem(item: Partial<NegativeItem>): Promise<NegativeItem>;
  generateLetter(itemIds: string[], templateType: string, tone: string, previewOnly?: boolean): Promise<string>;
  vaultUpload(file: File, encrypt?: boolean): Promise<VaultFile>;
}
```

Implementing `agentService` should route state changes through `src/context/AppContext.tsx` (single source of truth).

7. Building, Packaging, and Releases
------------------------------------

Development commands (package.json scripts):
- `npm run dev` — Vite web dev server
- `npm run electron:dev` — Run Electron desktop in dev mode (concurrently runs Vite)
- `npm run electron:build` — Build electron + run `electron-builder` (Windows installer + portable)
- `npm run cap:sync` — Build web assets and sync to Android native project
- `npm run cap:open` — Open Android project in Android Studio

CI / Release tips
- Use `npm ci` on CI for deterministic installs
- Provision code-signing certificates for Windows builds in CI using `CSC_LINK` and `CSC_KEY_PASSWORD`
- Use a private storage location for build artifacts (S3, Azure Blob) and sign releases before publishing

8. Security, Privacy & Data Handling
-----------------------------------

- All PII (SSN last 4, DOB, addresses) is stored in the local `Vault` with AES-256 encryption via `src/services/vaultEncryptionService.ts`.
- AI provider keys are stored securely using `src/services/secureKeyService.ts` in native secure stores when running in Electron or Android.
- The app never transmits vault contents to external servers. AI prompts include only the data necessary for generating letters or parsing (user consent required in UI).

9. Troubleshooting & FAQ
-------------------------

Common Problems
- Parser returns no items: try `Paste Text` instead of PDF; verify the report contains negative items; check AI keys.
- AI provider rate limit errors: open Settings → AI Configuration and switch provider order, or add an alternate provider.
- Android build errors: set `ANDROID_SDK_ROOT` and ensure JDK 17+ installed; sync with `npm run cap:sync` and open Android Studio.

Smoke Test (quick verification)
1. `npm run dev` → open UI
2. Create a profile and fill personal info
3. Upload a known sample report (or paste sample text)
4. Confirm `Negative Items` list populates
5. Generate a single `611-Reinvestigation` letter and export PDF

10. Contributing
-----------------

We welcome contributions. High-level guidance:
- Follow existing TypeScript strict patterns and keep `AppContext` as the single source of truth
- All AI calls must route through `src/services/aiRouter.ts` — do not call providers directly
- Any parser changes must preserve `isValidTradeline()` behavior and rejection logging
- Write unit tests for parser heuristics and add CI checks

PR Checklist
- Passes TypeScript compilation (`npm run lint`)
- No secrets in commits
- Update `CHANGELOG.md` when applicable

11. License & Credits
----------------------

DylandOs Ultimate Credit Repair Suite — © DylandOs. Refer to the project root for license details.

Acknowledgements
- Built with React, Vite, Electron, Capacitor, and community AI providers (Groq, Gemini, OpenRouter).

---

If you'd like, I can also:
- Add a developer `README.dev.md` with step-by-step examples and runnable tests
- Scaffold `src/services/agentService.ts` implementation with full typed interfaces
- Generate a `CHANGELOG.md` for v4.0.0 with detailed diffs

Tell me which of those you'd like next, or if you want additional platform-specific CI steps.
