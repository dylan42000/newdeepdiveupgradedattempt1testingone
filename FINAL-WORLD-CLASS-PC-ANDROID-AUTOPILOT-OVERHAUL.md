# Dylando Ultimate Credit Repair Suite
## Final World-Class PC-First / Android-Ready AutoPilot Overhaul

**Document status:** Final product and implementation blueprint  
**Codebase baseline:** Version 5.6.1, July 2026  
**Primary platform:** Windows PC (Electron)  
**Companion platform:** Android (Capacitor)  
**North star:** Produce the strongest supportable deletion or correction campaign for each inaccurate, incomplete, obsolete, or unverifiable item while requiring the least practical effort from the user.

> This is a product and engineering specification, not a promise of deletion, score improvement, or legal advice. AutoPilot must dispute only user-selected or evidence-supported inaccuracies, must never invent facts, and must keep the consumer in control of consequential submissions.

---

## 1. Final Product Decision

Dylando should no longer feel like a collection of credit-repair tools. It should feel like one intelligent case manager.

The default experience is:

1. The user imports a credit report.
2. Dylando identifies and safely merges the same accounts across bureaus.
3. AutoPilot builds a ranked case plan for every potentially actionable item.
4. The user answers only the facts the system cannot establish.
5. AutoPilot creates the best evidence-backed action, schedules it at the correct time, and prepares the complete dispatch packet.
6. The user gives one clear approval before an external submission unless the user has deliberately enabled an available, compliant delivery integration.
7. AutoPilot tracks deadlines, reads responses, adapts the next strategy, and stops when the objective is achieved or escalation is no longer justified.

The product promise is not “one-click credit repair.” The honest promise is:

**Import once. Answer only what matters. Let AutoPilot organize, prepare, time, and learn from the rest.**

---

## 2. Non-Negotiable Product Principles

### 2.1 Evidence before aggression

The strongest letter is the most specific supportable letter, not the most threatening one. AutoPilot must prefer a precise factual discrepancy with traceable evidence over broad legal language.

### 2.2 Per-item strategy, never bulk-template strategy

Every account-bureau pair is its own case. It receives its own facts, evidence score, reporting conflicts, prior outcomes, deadline, strategy, letter fingerprint, and stop conditions.

### 2.3 Minimal effort through progressive disclosure

Do not ask the user to understand the entire workflow. Ask one small question only when the answer will materially improve or unblock the next action.

### 2.4 Consequential-action control

AutoPilot may autonomously analyze, rank, draft, validate, schedule, remind, and assemble. It must not silently assert a consumer fact, upload evidence, mail a letter, file a complaint, or accept a settlement without the consumer’s informed approval.

### 2.5 Explain every important decision

Every recommendation must answer:

- Why this item?
- Why this recipient?
- Why this strategy?
- Why now?
- What evidence supports it?
- What could block it?
- What happens next?

### 2.6 Local-first privacy

PII, reports, letters, responses, and learning history remain on the user’s device unless the user explicitly invokes an external provider or delivery channel. Only the minimum necessary information may leave the device.

### 2.7 Outcome optimization with guardrails

Historical outcomes may influence ranking and strategy selection. They may never manufacture a fact, convert correlation into a legal conclusion, or bypass the evidence and validation gates.

---

## 3. The One-Screen PC Experience

The Windows version should become the command center. The default landing page is the **AutoPilot Mission Control**, not a generic dashboard.

### 3.1 Mission Control layout

#### Top status strip

Show five plain-language states:

- **AutoPilot status:** Running, Needs You, Waiting, Paused, or Setup
- **Next best action:** the single highest-value user action
- **Active cases:** number currently in motion
- **Waiting on responses:** number under a valid hold/deadline
- **Confirmed results:** deletions, corrections, and other resolved outcomes

#### Primary action card

Display exactly one dominant action:

- “Import your latest reports”
- “Answer 3 quick accuracy questions”
- “Add one missing proof document”
- “Review and approve 4 ready packets”
- “Scan 2 bureau responses”
- “Nothing needed — AutoPilot is monitoring deadlines”

The button must communicate time and effect, for example: **Answer 3 questions · about 2 minutes**.

#### Case pipeline

Use a compact pipeline:

`Discovered → Needs facts → Ready → Approved → Sent → Waiting → Response received → Resolved / Next move`

Clicking a stage filters the work queue. Avoid separate pages for tasks that are stages of the same workflow.

#### Success panel

Show:

- Confirmed deletions
- Confirmed corrections
- Active opportunities
- Avoided premature/repetitive disputes
- Estimated user time saved

Never display an unsupported guaranteed score gain or guaranteed deletion probability.

#### “Why AutoPilot chose this” drawer

For each case, expose:

- Reporting conflict or user-confirmed inaccuracy
- Evidence used and missing evidence
- Selected recipient and strategy
- Current pass and prior result
- Deadline and earliest safe action date
- Risk flags
- Alternative actions considered
- Confidence label with contributing factors

### 3.2 Desktop efficiency features

The PC version should add:

- Drag-and-drop multi-report import
- Batch response import and matching
- Side-by-side report/account/letter/evidence view
- Keyboard-first review: approve, hold, edit, exclude, next
- Bulk approval only for packets that independently pass every gate
- Print-ready packet assembly with a cover checklist
- Certified-mail tracking entry and receipt attachment
- Encrypted full backup and restore
- Background scheduler that resumes after reboot
- Native notifications that deep-link to the exact case
- Full audit export for the user

### 3.3 Navigation simplification

Primary PC navigation should be:

1. **AutoPilot**
2. **Cases**
3. **Documents**
4. **Results**
5. **Settings**

Existing tools remain available under **Tools & Learn**, but they should not compete with the core path. Upload Report, Negative Items, Dispute Letters, Calendar, History, and Vault become views or tabs within the four core workspaces where practical.

---

## 4. The Zero-Confusion Setup

Setup is complete only when AutoPilot can safely make a plan.

### Step 1 — Identity

Collect name, current mailing address, prior addresses only when relevant, date of birth, and SSN last four in normal app state. Store the full SSN only in the platform secure store and request it only when a specific document requires it.

### Step 2 — Import

Offer:

- PDF import
- Multi-file import for three-bureau reports
- Paste as a fallback
- Camera/document capture on Android

Immediately show extraction progress and preserve the original file in the encrypted vault.

### Step 3 — Confirm identity matches

Ask only about ambiguous identity records, mixed files, or suspected split profiles. Do not make the user review every correctly parsed field.

### Step 4 — Resolve high-value uncertainties

AutoPilot presents a short, adaptive questionnaire. Example:

- “Do you recognize this account?”
- “Is this balance accurate as of the report date?”
- “Was this payment actually late?”
- “Is this address yours?”
- “Was this account included in bankruptcy?”

Every answer is stored as a versioned fact with source, timestamp, and confidence.

### Step 5 — AutoPilot mode

Offer three modes:

- **Guided AutoPilot — recommended:** prepares everything; asks for approval before dispatch.
- **Review each action:** requires approval at both strategy and final packet stages.
- **Monitor only:** analyzes reports, deadlines, and responses without preparing dispatch.

Do not describe any mode as fully autonomous if the installed platform cannot actually complete external delivery.

---

## 5. AutoPilot Decision Architecture

The existing `autoPilotEngineV2`, evidence, strategy-rotation, deadline, outcome, and validation services should be composed behind one deterministic orchestration contract.

### 5.1 Canonical case unit

The smallest actionable unit is:

`profile + canonical account + bureau + reporting snapshot`

A shared account may link Equifax, Experian, and TransUnion records, but each bureau row retains independent facts and case history.

### 5.2 Case state machine

```text
IMPORTED
  → NORMALIZED
  → IDENTITY_RESOLVED
  → FACTS_NEEDED | EVIDENCE_NEEDED | ELIGIBLE
  → PLANNED
  → DRAFTED
  → VALIDATED
  → USER_APPROVAL
  → READY_TO_DISPATCH
  → SENT
  → WAITING
  → RESPONSE_RECEIVED | DEADLINE_BREACH
  → DELETED | CORRECTED | VERIFIED | NO_RESPONSE | REINSERTED
  → REPLAN | RESOLVED | MANUAL_REVIEW | CLOSED
```

All transitions must be event-driven, idempotent, recoverable after restart, and recorded in the audit log.

### 5.3 Decision pipeline

For every case, AutoPilot runs these gates in order:

1. **Identity gate** — confirm that the item belongs to the active profile.
2. **Merge gate** — link cross-bureau records without destroying source rows.
3. **Actionability gate** — identify an actual user-confirmed or evidence-supported issue.
4. **Accuracy gate** — block invented, contradictory, stale, or unsupported assertions.
5. **Evidence gate** — score the evidence required for this exact dispute type.
6. **Timing gate** — respect active investigations, response windows, holds, and recent duplicate actions.
7. **Recipient gate** — select bureau, furnisher, collector, specialty bureau, or complaint path based on the facts and stage.
8. **Strategy gate** — choose the narrowest high-value strategy that has not already failed unchanged.
9. **Uniqueness gate** — prevent semantic duplication across rounds and accounts.
10. **Legal/claim gate** — allow only applicable, supportable statements and demands.
11. **Packet gate** — confirm address, identifiers, attachments, pagination, and unresolved-token zero tolerance.
12. **Approval gate** — obtain the required consumer approval.

A failed gate creates one actionable remediation task. It must not generate a vague error or silently skip the case.

### 5.4 Ranking model

Use a transparent, bounded priority score:

```text
Case Priority =
  25% actionability confidence
  20% evidence readiness
  15% reporting inconsistency strength
  15% estimated credit-profile relevance
  10% timing urgency
  10% strategy fit from local outcomes
   5% response/deadline opportunity
  minus risk penalties
```

Risk penalties include identity ambiguity, incomplete account matching, unsupported date assumptions, active holds, duplicate strategy, weak recipient address, and frivolous/repetition risk.

The ranking score chooses work order. It must never be displayed as a promised deletion percentage. In the UI use **Strong case**, **Promising**, **Needs evidence**, or **Not currently actionable**.

### 5.5 Batch construction

The current “top N by score” model should become a constrained optimizer:

- Never include a blocked case.
- Respect per-recipient and per-day caps.
- Avoid repeated wording or identical issue mixes.
- Prefer a diversified set of strong, ready cases.
- Preserve bureau-specific timing.
- Exclude cases already awaiting a response.
- Exclude cases whose newest report snapshot materially changed until re-analysis completes.
- Create one packet per recipient and case unless a carefully validated combined packet is clearly stronger.

Default batch size should adapt to evidence readiness, user review capacity, delivery capacity, and current open-case volume—not just a fixed percentage.

---

## 6. Strategy Ladder

The six-pass architecture remains, but pass number alone must never determine content.

### Pass 1 — Precise factual dispute

Use the clearest supportable reporting discrepancy. Keep the request narrow, readable, and specific.

### Pass 2 — Targeted reinvestigation

Use only after a response or deadline event. Address the unresolved field or inadequate correction; do not resend Pass 1 with stronger adjectives.

### Pass 3 — Method and source challenge

Use when the outcome and record justify a method-of-verification or source-specific follow-up. Tie the request to the actual prior correspondence.

### Pass 4 — Furnisher or collector direct path

Use the correct direct-dispute route when supported, with recipient-specific facts and evidence. Do not automatically duplicate a bureau letter.

### Pass 5 — Documented regulatory escalation

Prepare a complaint packet only when prerequisites, chronology, evidence, and prior attempts are complete. The user reviews and submits it.

### Pass 6 — Final case disposition

Choose among a final targeted correction request, reinsertion response, goodwill path, settlement-related workflow, attorney referral packet, monitor-only status, or closure. Repeating a failed theory without new facts is prohibited.

### Strategy stop rules

Stop or pause when:

- The item is deleted or corrected as requested.
- The user withdraws or contradicts the disputed fact.
- New evidence shows the reporting is accurate.
- No new supportable theory or evidence exists.
- Identity/account matching is unresolved.
- Timing rules require waiting.
- The next action would be substantially duplicative.
- The correct next step requires professional legal advice.

---

## 7. Evidence and Fact System

### 7.1 Fact ledger

Create a canonical fact record:

```ts
interface CaseFact {
  id: string;
  profileId: string;
  caseId: string;
  field: string;
  value: unknown;
  sourceType: 'report' | 'document' | 'user' | 'response' | 'derived';
  sourceId: string;
  capturedAt: string;
  confidence: 'confirmed' | 'high' | 'ambiguous' | 'conflicting';
  userConfirmedAt?: string;
  supersedesFactId?: string;
}
```

Derived facts must store the rule used. A derived date may never silently become a user-confirmed date.

### 7.2 Evidence graph

Each assertion in a letter links to one or more facts and documents. The review screen should allow the user to click a sentence and see its source.

### 7.3 Evidence readiness

Evaluate readiness per case, not from the first item in a batch. Retain the existing tiers:

- **BLOCKED**
- **BASIC**
- **STRONG**
- **AUDIT_PROOF**

Add:

- Required missing fact
- Recommended supporting evidence
- Stale-document warning
- Name/address mismatch warning
- Attachment suitability
- Recipient-specific requirement

### 7.4 Anti-fabrication rules

AutoPilot must never:

- Infer date of first delinquency from open date.
- Claim identity theft without explicit confirmation and appropriate evidence.
- Claim payment, payoff, settlement, or non-ownership without support.
- Treat a bureau difference as automatically inaccurate.
- Insert a statute or legal conclusion solely because it sounds forceful.
- Use a full SSN in an AI prompt.
- convert “not recognized” into “not mine” without confirmation.

---

## 8. Letters and Dispatch Packets

### 8.1 Deterministic facts, constrained language

Use code to assemble recipient, identity, account identifiers, dates, balances, requested correction, attachments, and chronology. AI may improve clarity and consumer voice only inside a constrained schema.

If AI is unavailable, deterministic generation must still produce a valid factual packet. Provider failure cannot corrupt state or advance the case.

### 8.2 Packet contents

Every ready packet contains:

- Final letter
- Recipient and validated mailing address
- Consumer return address
- Case/account reference
- Attachment list
- Redaction preview
- Mailing/submission checklist
- Tracking placeholder
- Copy saved to the encrypted vault
- Immutable content hash

### 8.3 Final validation

Block dispatch for:

- Any unresolved placeholder
- Missing or conflicting identity data
- Missing recipient
- Unsupported material assertion
- Non-applicable citation
- Duplicate or near-duplicate prior letter without new basis
- Missing required attachment
- Account-number mismatch
- Report/source mismatch
- Empty or malformed PDF
- Content changed after approval

If anything changes after approval, invalidate approval and show the exact diff.

### 8.4 Consumer voice

Letters should be concise, direct, factual, and varied naturally. Avoid canned threats, pseudo-lawyer voice, excessive citations, or language designed to impersonate legal counsel.

---

## 9. Response-In → Next-Best-Action Loop

This is the largest deletion-success opportunity after parser accuracy.

### 9.1 Response intake

On PC: drag in one or many response PDFs/images.  
On Android: photograph or import a response.

AutoPilot:

1. Identifies sender and date.
2. Matches the response to the most likely case.
3. Extracts outcome, reason codes, changed fields, and enclosures.
4. Compares the new report/response to the pre-dispute snapshot.
5. Shows a short confirmation screen only for ambiguous findings.
6. Updates the deadline and strategy plan.

### 9.2 Supported outcomes

- Deleted
- Corrected
- Verified
- Partial correction
- No response
- Frivolous/irrelevant response
- Identity/evidence requested
- Forwarded/transferred
- Reinserted
- Unclear/manual review

Do not reduce all non-deletions to “verified.”

### 9.3 Learning

Learn locally from:

- Bureau
- Furnisher/collector
- Account type
- Confirmed issue type
- Evidence tier and document categories
- Strategy family
- Pass
- Response type
- Time to outcome

Use minimum sample thresholds, recency weighting, and conservative priors. Never claim statistical confidence from tiny samples. Provide a reset/export control for learned data.

---

## 10. AutoPilot Inbox: The Only Work Queue the User Needs

All user effort should arrive in one prioritized inbox with four task types:

- **Answer** — one missing fact
- **Add** — one needed document
- **Review** — a matched response or ambiguous parse
- **Approve** — a complete action packet

Each task shows:

- Why it matters
- Estimated time
- What AutoPilot will do afterward
- Skip/hold option
- Privacy impact

AutoPilot should group compatible questions, reuse prior confirmed facts, and never ask the same question twice unless newer evidence conflicts.

---

## 11. Windows Implementation Plan

### 11.1 Use the existing architecture

Build on:

- `src/services/autoPilotEngineV2.ts`
- `src/services/apexItemStrategyPlanner.ts`
- `src/services/evidenceGateService.ts`
- `src/services/strategyRotationEngine.ts`
- `src/services/disputeClockEngine.ts`
- `src/services/disputeOutcomeTracker.ts`
- `src/services/letterGeneratorV2.ts`
- `src/services/letterValidator.ts`
- `src/services/accountMergeEngine/`
- `src/services/indexedDB.ts`
- `src/components/AutoPilotDashboard.tsx`
- `electron/main.cjs` and `electron/preload.cjs`

Do not introduce a third AutoPilot engine or another parallel persistence model.

### 11.2 Required desktop services

Add or consolidate:

- `autopilotOrchestrator.ts` — the only public cycle/state-transition entry point
- `caseRepository.ts` — canonical case reads/writes and migrations
- `factLedgerService.ts` — versioned facts and provenance
- `casePlanService.ts` — ranked next action and alternatives
- `packetAssembler.ts` — deterministic final packet
- `approvalService.ts` — content-hash-bound approval
- `responseIntakeService.ts` — response matching and extraction
- `autopilotInboxService.ts` — normalized user tasks

Existing specialist services remain internal dependencies.

### 11.3 Scheduler contract

The Electron scheduler:

- Wakes at startup and on a bounded interval.
- Acquires a profile-scoped lease before work.
- Processes idempotent jobs.
- Never depends on a visible renderer window.
- Persists checkpoint, attempt count, and last safe state.
- Uses exponential backoff with a maximum attempt policy.
- Notifies only when user action is needed or a deadline materially changes.
- Never performs an external submission without the required approval.

### 11.4 Multi-profile isolation

Every case, fact, letter, document, deadline, job, outcome, and learning record must include `profileId`. Switching profiles must not leak counts, notifications, cache entries, or scheduler actions.

### 11.5 PC performance target

- Mission Control interactive within 2 seconds after normal launch.
- Large import parsing occurs off the renderer thread.
- 300-account three-bureau workspace remains responsive.
- Scheduler resumes correctly after forced termination.
- Packet generation does not retain unreleased PDF blobs.

---

## 12. Android Finalization Guide

Android uses the same domain rules, case state machine, gates, and event schema. Only the shell, interaction density, secure storage, file handling, and background execution differ.

### 12.1 Mobile information architecture

Bottom navigation:

1. **Home**
2. **Tasks**
3. **Cases**
4. **Documents**
5. **More**

Home shows the same single next-best action as PC. Tasks contains Answer/Add/Review/Approve cards. Avoid desktop tables; use stacked cards and bottom sheets.

### 12.2 Android import reliability

Finalize the Android flow with:

- Explicit controlled-state paste handling
- Unicode NFKC normalization
- Removal of unsafe zero-width/control characters
- Local heuristic parser fallback when AI returns zero items
- Multi-file document picker
- Camera capture with crop/rotate/quality check
- Chunked parsing for large files
- A visible, recoverable import checkpoint
- PII-masked local diagnostics

The user must never lose a captured document or pasted report because the WebView reloads.

### 12.3 Background work

WorkManager is a wake-up and notification mechanism, not a promise that a WebView will stay alive.

- Persist all pending jobs before scheduling.
- Use native background networking only for narrowly defined, approved tasks.
- Resume WebView-dependent analysis when the app opens.
- Apply network, battery, and retry constraints.
- Re-register durable schedules after reboot and app update.
- Deduplicate jobs with stable IDs.
- Never run an unapproved external submission in the background.

### 12.4 Secure storage

- API keys and full SSN: Android Keystore/EncryptedSharedPreferences.
- Reports, responses, evidence, and letters: app-private encrypted vault.
- IndexedDB: state and metadata only where practical.
- Large binary documents: native files referenced by stable IDs.
- Clear-data flow: explicitly offer to wipe both web state and native secure/vault state.

### 12.5 Mobile notifications

Notify for:

- Approval needed
- Response due/overdue
- New response ready to scan
- Missing evidence blocking a strong case
- Confirmed outcome
- Background job requiring app-open continuation

Every notification deep-links to the exact profile, case, and task. Notification content must avoid sensitive account details on the lock screen by default.

### 12.6 Android acceptance matrix

Test at minimum:

- API 26 low-memory device/emulator
- Current mainstream API
- API 36 target behavior
- Offline launch and queued recovery
- App killed during import
- App killed during packet generation
- Reboot with future deadline
- Permission denial and later grant
- WebView update variance
- Large scanned PDF
- Paste from common PDF readers
- Camera response capture

---

## 13. Data Model and Persistence Upgrade

Add stores or equivalent versioned repositories for:

- `cases`
- `caseFacts`
- `caseSnapshots`
- `casePlans`
- `autopilotTasks`
- `autopilotJobs`
- `packetApprovals`
- `responseMatches`
- `learningAggregates`

### Required invariants

- Stable IDs survive report re-import.
- Source bureau rows are immutable snapshots.
- Cross-bureau linking is reversible.
- Every derived plan names its input snapshot version.
- Every letter names its plan and fact versions.
- Every approval binds to the final content hash.
- Every outcome names the response/source that established it.
- Dual-write migration is temporary, measured, and removable.
- Failed transactions cannot partially advance a case.

### Event log

Use an append-only event envelope:

```ts
interface AutoPilotEvent {
  id: string;
  profileId: string;
  caseId?: string;
  type: string;
  occurredAt: string;
  actor: 'user' | 'autopilot' | 'system';
  sourceVersion: string;
  payload: Record<string, unknown>;
  previousEventHash?: string;
}
```

The user-facing history is derived from this log. Sensitive payload fields remain encrypted or redacted.

---

## 14. AI Routing and Reliability

Use the configured provider cascade, but make provider choice invisible to normal users.

### Task routing

- Deterministic code: parsing anchors, normalization, merge keys, deadlines, validation, packet assembly.
- Fast model: classification, response labeling, short structured extraction.
- Large-context model: difficult report/response extraction.
- Generative model: constrained letter-language variation after facts are locked.

### Required controls

- Strict JSON schema validation
- Timeout and cancellation
- Per-provider rate limiting
- Idempotency keys
- Retry only safe operations
- Redacted prompts
- No full SSN
- Minimum necessary context
- Deterministic fallback
- Provider health visible in diagnostics
- No state transition based on unvalidated model prose

AutoPilot must degrade gracefully: if all AI providers fail, deadlines, existing cases, deterministic packets, and manual workflows must still function.

---

## 15. Safety, Compliance, and Trust

### Required user controls

- Pause all AutoPilot work
- Pause one case
- Exclude an item
- Correct a fact
- Undo a merge
- Revoke an approval before dispatch
- Export all data
- Delete a profile
- Wipe local data and native secrets

### Required disclosures

Communicate clearly that:

- Results vary.
- Accurate negative information cannot properly be removed merely because it is negative.
- The consumer is responsible for confirming factual accuracy.
- Dylando does not provide legal representation.
- Complaint and legal escalation paths require review.

### Prohibited product behavior

- Guaranteed deletions or score increases
- Fabricated disputes
- Automatic identity-theft assertions
- Spam-like repeated submissions
- Hidden external transmission of PII
- Dark patterns around approval
- Fake “AI confidence” presented as outcome certainty
- Automatic credit-repair-organization claims that exceed the product’s actual role

Before commercial release, obtain jurisdiction-appropriate legal review of product claims, billing, disclosures, document-delivery behavior, and credit-repair regulations.

---

## 16. Metrics That Actually Matter

### North-star metric

**Confirmed favorable resolutions per 100 evidence-ready cases**, segmented into deletions and corrections.

### Supporting outcome metrics

- First-action deletion/correction rate
- Favorable resolution rate by issue, recipient, evidence tier, and pass
- Median days to confirmed outcome
- Re-verification rate
- Reinsertion rate
- No-response escalation success

### Effort metrics

- Median user minutes per resolved case
- Questions asked per case
- Approval time per packet
- Percentage of cycles requiring no user action
- Repeated-question rate

### Quality and safety metrics

- Parser field accuracy
- False account-merge rate
- Response-to-case match accuracy
- Unsupported-claim blocks
- Duplicate-strategy blocks
- Unresolved-placeholder escape rate
- Deadline accuracy
- Failed/duplicated background jobs
- Approval/content hash mismatch count

### Release targets

- Zero unresolved placeholders at export
- Zero known cross-profile leaks
- Zero duplicate dispatch jobs
- Zero state advancement after failed validation
- 100% consequential actions represented in the audit log
- 100% final packets traceable to facts and source documents
- Parser and response-match accuracy measured on anonymized golden fixtures

Do not set a deletion-rate guarantee as a release gate; use measured cohort results and confidence intervals.

---

## 17. Final Build Roadmap

### Phase 0 — Freeze and baseline

- Declare `autoPilotEngineV2` plus the new orchestrator as the only live AutoPilot path.
- Inventory duplicate engines, stores, profile systems, and letter paths.
- Capture current parser, merge, packet, deadline, and cycle baselines.
- Add anonymized golden fixtures before refactoring.

**Exit gate:** current behavior is reproducible and measured.

### Phase 1 — Canonical cases and provenance

- Implement stable case IDs and immutable bureau snapshots.
- Add fact ledger and evidence links.
- Make cross-bureau link/merge reversible.
- Add profile IDs to every related record.
- Migrate existing state safely.

**Exit gate:** re-import never loses history or silently changes case identity.

### Phase 2 — Unified decision engine

- Implement the ordered gate pipeline.
- Replace top-N batching with constrained selection.
- Produce ranked next-best actions and reason codes.
- Add stop rules and idempotent state transitions.
- Route failures into AutoPilot Inbox tasks.

**Exit gate:** every active case has one explainable state and next action.

### Phase 3 — World-class PC Mission Control

- Replace the current dashboard hierarchy with Mission Control.
- Add the unified task inbox.
- Add side-by-side review and keyboard workflow.
- Add deterministic packet assembly and content-hash approval.
- Harden Electron scheduler and reboot recovery.

**Exit gate:** a new user can go from import to approved packets without navigating the legacy tool maze.

### Phase 4 — Response intelligence

- Add batch response intake.
- Match responses to cases.
- Extract granular outcomes and changed fields.
- Replan from outcome, chronology, and new evidence.
- Add local learning aggregates with minimum sample thresholds.

**Exit gate:** a response import automatically produces a trustworthy next-best action or one clear clarification task.

### Phase 5 — Android parity finalization

- Implement mobile Tasks and Home.
- Harden paste/camera/import persistence.
- Align Android storage and event schemas.
- Finalize WorkManager resumption, boot recovery, and notifications.
- Validate API 26 through API 36.

**Exit gate:** Android can complete the same case lifecycle with mobile-appropriate interactions and no WebView-dependent background assumptions.

### Phase 6 — Release hardening

- Security review and secret scan
- Accessibility audit
- Crash/recovery tests
- Backup/restore tests
- Large-data performance tests
- Installer/update tests
- Legal/product-claims review
- Signed Windows and Android release candidates

**Exit gate:** all critical acceptance tests pass with no P0/P1 defects.

---

## 18. Test Strategy

### Unit tests

- Normalization and sanitizer edge cases
- Merge hard-refuse and soft-confirm rules
- Ranking bounds and risk penalties
- Every evidence tier
- Every state transition
- Deadline calculations
- Strategy stop/rotation rules
- Placeholder and unsupported-claim validation
- Approval hash invalidation
- Provider schema rejection

### Golden fixture tests

Use anonymized:

- Three-bureau reports from multiple vendors/layouts
- Split and duplicated tradelines
- Masked account-number variations
- Collections, charge-offs, late payments, inquiries, bankruptcy, and medical debt
- Bureau and furnisher response letters
- Deletion, correction, verification, frivolous, evidence-request, and reinsertion outcomes

### End-to-end tests

1. Import → normalize → merge → questions → plan → packet → approval.
2. Restart during every major stage and resume without duplication.
3. Import response → match → confirm → outcome → replan.
4. Switch profiles during active jobs and prove isolation.
5. Disable network/providers and complete deterministic/manual paths.
6. Backup, wipe, restore, and verify hashes/history.
7. Build Windows installer/portable and Android release artifacts.

### Adversarial tests

- Prompt injection inside imported PDFs
- Malformed AI JSON
- Contradictory user and report facts
- Replaced document after approval
- Path traversal filenames
- Oversized files and decompression bombs
- Duplicate scheduler wake-ups
- Clock/timezone changes
- Corrupted IndexedDB entry
- XSS payload in letter/response text

---

## 19. Definition of Done

The overhaul is complete only when:

- AutoPilot is the obvious default product experience.
- A user can understand the next step without credit-repair expertise.
- Every case has provenance, an explainable plan, and a safe stop condition.
- The PC app continues scheduled local work after window close/restart where the OS permits.
- Android reliably resumes work without assuming a living WebView.
- No letter can be exported with placeholders, unconfirmed material facts, or invalidated approval.
- Every response can be linked, classified, and turned into a next action.
- Outcomes improve future ranking without creating unsupported claims.
- User effort is measured and intentionally reduced.
- Security, recovery, accessibility, and multi-profile isolation pass release gates.

---

## 20. Final Priority Order

If resources are limited, build in this order:

1. **Parser and account identity accuracy**
2. **Fact provenance and evidence gating**
3. **Unified case state machine and stop rules**
4. **Response intake and adaptive next action**
5. **Packet validation and approval integrity**
6. **PC Mission Control and task inbox**
7. **Reliable desktop scheduling**
8. **Android import, task, storage, and WorkManager parity**
9. **Outcome learning and optimization**
10. **Secondary tools and cosmetic expansion**

Deletion success will not come from more templates or more aggressive wording. It will come from better input accuracy, better evidence, better timing, better response interpretation, and a system that selects the right supportable action for each case while asking the user for almost nothing that it can safely determine itself.

---

## Final Product Summary

The final Dylando experience should be calm:

**AutoPilot is working.**  
**Here is what it found.**  
**Here is the one thing it needs from you.**  
**Here is why this action is strongest.**  
**Approve when ready.**  
**Dylando will track what happens and choose the next safe move.**

That is the world-class version: not the loudest credit-repair app, but the most disciplined, evidence-driven, privacy-respecting, low-effort case manager the user can run on their own PC and carry with them on Android.
