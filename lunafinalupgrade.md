# Luna Final Upgrade — World-Class Consumer Dispute Platform Blueprint

## Purpose

This document replaces the previous upgrade review. It is a repository-specific final implementation blueprint for making the app substantially more autonomous, reliable, consumer-authored, evidence-driven, and easy to use.

The product goal should be:

> The app does the research, matching, drafting, validation, packaging, scheduling, tracking, and response analysis automatically. The user acts only as the consumer-author and signer, and is interrupted only when the app cannot safely determine a fact or when a high-stakes escalation requires confirmation.

No software can honestly guarantee deletion or a particular credit-score result. The highest sustainable success rate comes from accurately identifying incomplete or inaccurate reporting, supplying the strongest available evidence, using the correct recipient and remedy, preserving delivery records, and adapting to the actual response. “Aggressive” should mean more complete analysis and faster exception handling—not unsupported claims, invented account digits, unnecessary legal threats, or repetitive mass disputes.

## Executive decisions

The final upgrade should make these product decisions:

1. Every ordinary dispute letter is authored and signed by the consumer in first-person singular.
2. The app must never imply that a lawyer, law firm, credit-repair company, or representative is speaking unless the user explicitly selects a separately designed representative workflow and supplies the required authority.
3. Letter generation must almost never end with “no letter created.” If AI output fails a style check, the app repairs it; if providers fail, it renders a deterministic consumer template from verified facts.
4. Grouping tradelines and reconstructing account digits must be separate confidence decisions. The app can confidently determine that entries represent the same account without pretending it knows every hidden digit.
5. Each bureau letter should normally use the exact account identifier displayed by that bureau. A full account number is not required to submit a specific dispute when the creditor, displayed identifier, report source, and disputed fields identify the tradeline.
6. V2 becomes the only production autopilot engine and evolves into an event-driven case orchestrator.
7. OpenRouter should be removed. Add an optional OpenAI API provider and finish the already-partially-built Cloudflare Workers AI integration as the third free-capable provider.
8. The app should support two AI modes:
   - `FREE-FIRST`: Gemini + Groq + Cloudflare Workers AI.
   - `QUALITY-FIRST`: OpenAI for final drafting/repair, Gemini for report parsing and long-context comparison, Groq for fast classification, with Cloudflare as final fallback.
9. User interaction becomes exception-only: high-confidence work proceeds automatically; medium-confidence account matches receive one fast confirmation card; low-confidence or high-stakes actions enter an Action Required queue.

## Findings from the current repository

### 1. Third-party voice is still being prompted

The app contains some correct first-person instructions, but the active generation stack is inconsistent:

- `src/services/letterGeneratorV2.ts` tells models they are consumer-rights attorneys.
- `src/services/directFurnisherEngine.ts` tells the model it is a consumer-protection attorney.
- `src/services/cfpbComplaintGenerator.ts` begins from an attorney persona.
- `src/services/geminiService.ts` includes attorney prompts for strength analysis and furnisher escalation.
- `src/services/personaMatrix.ts` injects a selected “legal persona” into the system prompt.

Even when “attorney” is intended only as a writing-quality instruction, models often produce “our client,” “the consumer,” “we demand,” “on behalf of,” or other representative wording. That creates the appearance of third-party representation and can invite authorization or identity questions.

### 2. Current validation rules cause avoidable generation failures

`src/services/letterGeneratorV2.ts` currently throws errors when:

- the opening resembles a conventional dispute opening;
- the first paragraph contains a legal citation;
- a telephone/automated-contact consent revocation is absent;
- banned boilerplate is detected;
- minimum length is not met;
- expected citation text is absent.

`src/services/letterValidator.ts` also bans phrases such as “I am writing to dispute” and “please investigate.” Those phrases are not inherently defective; the FTC’s own consumer sample uses direct first-person wording. They may be stylistically ordinary, but they should not make an otherwise accurate letter fail.

The retry queue retries the generation task, but it does not provide a targeted repair plan describing the exact failed rules. Increasing temperature on later attempts can make factual stability worse. This explains why some items result in no usable letter.

### 2A. Confirmed AutoPilot incident from the supplied 5:09 PM log

The supplied V2 run selected eight items and completed with six generated letters, while seven target-specific letter attempts shown in the log failed. Every shown failure came from only two validators:

- `Telephone-consent revocation is missing or incomplete.`
- `Law or statutory citation detected in opening paragraph.`

The affected targets included American Express, Capital One, Discover by Capital One, Upgrade Inc., Equifax, and direct furnisher targets. These were not factual-grounding failures, missing-account failures, address failures, or provider outages. Usable drafts were discarded because of presentation rules.

The exact failure chain is:

1. `letterGeneratorV2.ts` generates a complete body.
2. `assertNoLawInOpeningParagraph()` or `assertTelephoneConsentRevocation()` throws a normal `Error`.
3. `apiQueueManager.ts` retries only rate-limit errors and `BoilerplateDetectedException` errors.
4. These two normal validation errors enter the `Unclassified Error` path and fail immediately.
5. AutoPilot records the target as failed and continues, leaving fewer letters than planned.

There is also a prompt contradiction in `bureauCalibrationEngine.ts`: the Experian profile says to “open with a clear statement of consumer's rights under the FCRA,” while `letterGeneratorV2.ts` rejects any FCRA, statute, U.S.C., or section reference in the opening paragraph. A model can follow one valid app instruction and then be rejected for violating the other.

This incident makes the following changes P0—not optional polish:

- remove universal telephone-consent validation;
- make paragraph-order preference a soft repair issue;
- resolve all prompt-policy contradictions before generation;
- return typed validation issues instead of throwing ordinary errors;
- run targeted repair for repairable issues;
- render a deterministic fallback if repair fails;
- report `plannedTargets`, `aiDrafts`, `repairedDrafts`, `fallbackDrafts`, and `hardBlockedTargets` separately so “cycle complete” is not misleading.

### 3. Account matching and digit reconstruction are fragmented

There are at least three overlapping implementations:

- `src/services/accountMergeEngine.ts`
- `src/services/tradelineMerger.ts`
- custom grouping and `stitchAccountNumbers()` logic inside `src/context/AppContext.tsx`

They use different thresholds and incompatible alignment assumptions. The AppContext stitcher aligns account strings from the left. `accountMergeEngine.ts` pads shorter strings on the left, effectively aligning from the right. Neither approach can safely determine position when one bureau provides a prefix without mask placeholders and another provides a suffix without the original total length.

The current merge confidence also combines two different questions:

1. Are these records the same real account?
2. Are the reconstructed digits correct at each position?

Those questions require separate scores. A group can be 98% likely to represent one account while the hidden middle digits remain completely unknown.

### 4. The third-provider integration is closer than it appears

`src/services/aiRouter.ts` already contains Cloudflare Workers AI routing and `secureKeyService.ts` already defines a Cloudflare key name. However, the Cloudflare call reads `VITE_CF_AI_TOKEN` and `VITE_CF_ACCOUNT_ID` from build-time environment variables instead of the secure runtime key cache. Settings does not expose the needed Cloudflare Account ID/token pair. Therefore the current app has a mostly hidden provider that cannot be configured normally.

OpenRouter free-model discovery is inherently unstable because free model availability changes. It should not be a critical production fallback.

## Upgrade 1 — Consumer-authored first-person letter system

### Required voice contract

Create a single `ConsumerVoicePolicy` used by every letter, complaint, direct furnisher dispute, disclosure request, follow-up, and escalation.

System instruction:

```text
You are drafting correspondence for the consumer named in the supplied profile.
The consumer is the author, sender, and signer of this letter.
Write in first-person singular using I, me, my, and mine.
Never claim or imply that an attorney, law firm, credit-repair organization,
advocate, agent, or representative is speaking. Never use our client, my client,
the consumer, we, our office, on behalf of, counsel, or represented by.
Do not claim legal expertise or threaten an action the consumer has not selected.
Use the consumer's own verified facts and describe the requested investigation,
correction, or deletion in direct, natural language.
```

### First-person output validator

Add `src/services/consumerVoiceValidator.ts` with:

- forbidden representative phrases;
- third-person references to the sender;
- first-person pronoun presence;
- sender-name consistency;
- signature-name consistency;
- plural “we/our/us” detection, except inside quoted bureau language or organization names;
- a repair instruction that returns exact violations.

Suggested hard-block phrases:

- `our client`
- `my client`
- `on behalf of`
- `the consumer requests`
- `we represent`
- `our office`
- `counsel for`
- `attorney for`
- `represented by`

“I am writing to dispute” should be allowed. The generator may vary it for uniqueness, but it must not fail solely because the phrase is conventional.

### Replace personas with consumer communication styles

Rename `personaMatrix` to `consumerStyleMatrix`. Styles affect cadence and organization, not speaker identity:

- `concise_factual`
- `chronological_record`
- `documented_error`
- `firm_follow_up`
- `plain_language`
- `final_consumer_notice`

Every style inherits `ConsumerVoicePolicy`. Remove names suggesting attorney or law-firm authorship.

### Letter structure

Every ordinary dispute letter should render deterministically as:

1. Consumer return address and actual date.
2. Recipient’s verified dispute address.
3. Subject identifying the report and displayed account identifier.
4. First-person factual opening.
5. One section per disputed field.
6. Evidence/enclosure references.
7. Specific requested result: investigate and correct/delete the inaccurate or incomplete information.
8. Request for written results and an updated report where applicable.
9. Consumer signature and enclosure list.

Legal citations should support the facts, not replace them. A clean factual dispute with useful evidence is preferable to a dense letter filled with marginal citations.

## Upgrade 2 — Near-zero-failure letter generation

### Replace fatal style assertions with a repair pipeline

Introduce a `LetterGenerationOrchestrator`:

```text
VERIFIED FACT MODEL
  -> STRATEGY PLAN
  -> AI DRAFT
  -> FACT GROUNDING
  -> CONSUMER VOICE CHECK
  -> TARGET/REMEDY CHECK
  -> CITATION APPLICABILITY CHECK
  -> TARGETED REPAIR
  -> DETERMINISTIC RENDER
  -> FINAL PDF/TEXT CHECK
```

### Hard failures versus repairable failures

Hard failures should be limited to:

- missing consumer name or mailing address;
- no identifiable recipient;
- no identifiable tradeline or disputed information;
- unresolved placeholder in the final rendered document;
- a factual contradiction that cannot be resolved;
- a high-stakes claim requiring facts the app does not have.

Repairable failures include:

- generic opening;
- insufficient first-person wording;
- missing optional citation;
- length outside the preferred range;
- repetitive structure;
- missing optional telephone-contact language;
- formatting issues;
- a model-added greeting or closing.

The two errors in the supplied AutoPilot log—telephone-consent wording and a legal citation in the first paragraph—must both be repairable and must never terminate letter creation.

### Targeted repair, not blind regeneration

After validation, send the draft and a machine-readable issue list to a repair model:

```json
{
  "preserveFacts": true,
  "issues": [
    "THIRD_PARTY_VOICE: contains 'the consumer'",
    "MISSING_REQUESTED_REMEDY: balance correction not stated",
    "UNSUPPORTED_CLAIM: says bureau used e-OSCAR without evidence"
  ],
  "allowedFactsHash": "...",
  "requiredVoice": "first_person_consumer"
}
```

Use a low temperature for repair. Revalidate after each repair. Do not increase creativity when the problem is compliance.

Replace thrown style assertions with a result such as:

```ts
type ValidationSeverity = 'hard_block' | 'repair' | 'warning';

interface LetterValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  offendingText?: string;
  repairInstruction?: string;
}
```

`apiQueueManager` should route `repair` issues to a repair task, not classify them as unhandled exceptions. Only `hard_block` issues may end without a letter, and even then AutoPilot should record a precise Action Required reason.

### Deterministic fallback templates

Every supported dispute type needs a local fallback template. If all AI providers fail, the app should still produce a precise first-person letter from structured facts.

Fallback families:

- inaccurate balance;
- inaccurate payment status/history;
- wrong date opened/closed/reported;
- incorrect Date of First Delinquency;
- duplicate account;
- not mine/identity issue;
- paid/settled but reporting otherwise;
- obsolete reporting;
- unauthorized inquiry;
- mixed file/personal information;
- direct furnisher dispute;
- method/description of procedure follow-up;
- reinsertion notice;
- goodwill request;
- debt collector validation where factually applicable.

The deterministic fallback is the key to autonomy: provider outages or style-validator failures should not empty a cycle.

### Make telephone-consent language conditional

Remove the universal `assertTelephoneConsentRevocation()` requirement. Include written-contact preference or consent-revocation language only when:

- the target is a collector/furnisher for which contact is relevant;
- the user enabled the preference;
- the language is applicable to the known communication channel;
- adding it does not distract from the reporting dispute.

It should never cause a bureau dispute letter to fail.

For the exact American Express and Discover furnisher failures in the supplied log, the upgraded path should either add the optional communication-preference sentence during targeted repair or omit the preference under policy. Both outcomes still produce the underlying account-reporting dispute.

### Separate content quality from uniqueness

Do not mutate an already grounded letter with a post-generation “anti-spam” rewrite. Select the structure before generation, then preserve facts and meaning. Uniqueness is a soft score. Accuracy and specificity are hard requirements.

## Upgrade 3 — Structured dispute fact and strategy models

Add these core data structures:

### `DisputeFactModel`

- consumer identity reference;
- report source and report date;
- bureau-specific displayed account identifier;
- confirmed account group ID;
- creditor/furnisher and aliases;
- every reported field and source location;
- disputed field(s);
- user assertion or cross-bureau inconsistency;
- supporting evidence IDs;
- confidence per fact;
- prohibited inferences;
- desired correction;
- acceptable remedies.

### `DisputeStrategyPlan`

- target type and target address;
- factual issue code;
- requested remedy;
- allowed legal rules;
- required evidence;
- missing evidence;
- letter style;
- escalation eligibility;
- auto-send eligibility;
- reason for each decision.

AI should never choose facts or invent a dispute. It may phrase a strategy selected from verified facts.

## Upgrade 4 — Account Identity Graph and reconstruction engine

### Replace all merge implementations with one service

Create `src/services/accountIdentityService.ts` and make it the only grouping/reconstruction path. Deprecate or adapt:

- `accountMergeEngine.ts`
- `tradelineMerger.ts`
- the AppContext custom merger/stitcher

### Preserve source tokens exactly

The parser should store:

- `rawAccountToken`: exact text from the report, including mask symbols and separators;
- `normalizedAccountToken`;
- `knownDigitRuns`: each known run and its apparent position;
- `maskPattern`;
- `reportedTokenLength`;
- `sourceBureau`;
- `sourceReportId`;
- `sourcePage` or raw-text offset;
- surrounding raw snippet;
- whether the token appears prefix-anchored, suffix-anchored, fully positioned, or position-unknown.

Do not strip mask characters before determining whether known digits are a prefix, suffix, or internal run.

### Separate three confidence scores

1. `sameAccountConfidence`: probability the tradelines represent the same account.
2. `digitPlacementConfidence`: confidence in each digit’s position.
3. `fullNumberConfidence`: confidence that the entire reconstructed value is complete and correct.

Never label a number “full account number” unless every digit is known and conflicts are resolved.

### Stronger same-account matching

Build a weighted candidate graph using:

- normalized furnisher/creditor name and alias history;
- original creditor;
- matching known prefix/suffix/internal digits;
- account type and portfolio type;
- date opened;
- DOFD;
- close/charge-off date;
- balance and balance trajectory;
- high credit/credit limit;
- monthly payment;
- payment-history fingerprint;
- status and remarks;
- last reported date;
- responsibility type;
- dispute address/phone;
- transfer/sold-to relationships;
- source-bureau separation.

Negative constraints:

- two entries from the same bureau unless clearly duplicated on that report;
- conflicting known digits at a high-confidence aligned position;
- incompatible account types;
- date-opened differences outside a configurable tolerance;
- materially incompatible original balances;
- multiple same-creditor accounts for the same consumer without distinguishing signals.

Use connected components or constrained clustering rather than greedy first-match grouping. Greedy grouping can let an early weak match incorrectly absorb later records.

### Better digit alignment

Do not assume every shorter token is suffix-aligned or prefix-aligned. Generate candidate alignments across plausible total lengths and offsets, then score them using:

- preserved mask positions;
- explicit prefix/suffix cues;
- overlap agreement;
- conflict count;
- likely issuer account-number lengths learned from confirmed local examples;
- user-confirmed prior matches.

Example:

```text
Experian:   12345678****
Equifax:    ********9012
TransUnion: 1234****9012

Result: 123456789012 only if the positions are explicit and non-conflicting.
```

But:

```text
Experian: 1234
Equifax:  9012
```

must not become `12349012` unless source context proves one is a prefix and the other a suffix of an eight-digit identifier.

### Aggressive grouping, conservative digit claims

Recommended thresholds:

- `>= 0.92 sameAccountConfidence`: auto-group.
- `0.70–0.919`: show one confirmation card.
- `0.45–0.699`: place in Account Match Review, sorted by expected value.
- `< 0.45`: keep separate unless the user searches or manually links them.

Digit reconstruction is stricter:

- auto-use only digits with `>= 0.98 digitPlacementConfidence`;
- display uncertain digits as `?` or masked;
- never send inferred digits as confirmed facts;
- keep a provenance tooltip for every digit.

### Confirmation popup requested by the user

For medium-confidence matches, show:

```text
Are these the same account?

Experian   CAPITAL ONE   1234****   Opened 03/2019   Balance $842
Equifax    CAP ONE       ****7788   Opened 03/2019   Balance $846

Why matched: creditor alias, same opened month, compatible balance,
same account type, no digit conflict.

[Yes, same account] [No, separate accounts] [Not sure]
```

When the user confirms:

- persist a `ManualIdentityDecision` event;
- remember creditor aliases and matching patterns;
- recompute the cluster;
- never ask about that exact pair again unless source data changes.

When the user rejects a match, persist a negative edge so future imports do not merge it again.

### Other ways to obtain account identifiers

Create an Account Evidence intake that can scan:

- creditor statements;
- collection notices;
- payment receipts;
- creditor portal exports;
- loan documents;
- prior dispute responses;
- bureau full-file disclosures;
- mailed account correspondence;
- user-entered identifiers confirmed against a document.

The app should OCR/extract candidate identifiers locally, show the source, and require confirmation before replacing a masked report identifier. Never scrape a financial account or log into a creditor site without a separately authorized, secure integration.

Most importantly, letter generation should not wait for a full number. Use the exact identifier shown on the target bureau’s report, plus creditor name, report date, balance, and other identifying fields.

## Upgrade 5 — Autopilot 3.0 case orchestrator

### Case granularity

Track each `consumer + accountGroup + target + issue` as its own case. One account can have different facts and outcomes at each bureau.

### State machine

```text
IMPORTED
 -> IDENTITY_MATCHED
 -> FACTS_NORMALIZED
 -> ISSUE_DETECTED
 -> EVIDENCE_ASSESSED
 -> STRATEGY_SELECTED
 -> DRAFTED
 -> REPAIRED
 -> VALIDATED
 -> READY_TO_SEND
 -> QUEUED
 -> PROVIDER_ACCEPTED / MANUALLY_MAILED
 -> DELIVERY_CONFIRMED
 -> RESPONSE_PENDING
 -> RESPONSE_RECEIVED
 -> RESPONSE_CLASSIFIED
 -> RESOLVED / NEXT_STRATEGY / ACTION_REQUIRED
```

Every transition must be append-only, idempotent, and recoverable after a crash.

### Event-driven triggers

Run autopilot when:

- a report finishes parsing;
- account clusters change;
- evidence is uploaded;
- a medium-confidence match is confirmed;
- a letter is accepted by a mail provider;
- delivery is confirmed;
- a response is scanned or imported;
- a response deadline approaches or expires;
- a new report shows deletion, correction, or reinsertion.

The calendar scheduler remains a safety net, not the primary brain.

### Exception-only user experience

Autopilot should silently complete high-confidence work. The Action Required queue contains only:

- medium-confidence account match;
- missing consumer identity/address;
- contradictory source facts;
- no verified recipient address;
- identity-theft attestation/document needs;
- complaint/pre-litigation approval;
- a response whose classification confidence is low;
- a manual mailing awaiting confirmation.

Target: fewer than 10% of ordinary cases should require interaction after initial profile and report setup.

### Strategy selection

The strategy engine should optimize for the most appropriate successful resolution, including deletion, correction, suppression of obsolete information, duplicate removal, and accurate dispute notation.

Prioritize:

1. clear factual inconsistency with documentary proof;
2. cross-bureau conflict with strong account identity;
3. duplicate reporting;
4. obsolete or reinserted information;
5. incorrect dates/status/balance/payment history;
6. incomplete investigation or response-specific follow-up;
7. goodwill only when the reporting is accurate and the user wants a courtesy request.

Do not auto-select a legal threat merely because a pass number increased. Escalation must depend on the actual history, delivery event, response content, and supported facts.

### Six-round per-item dispute and escalation ladder

The production engine must comfortably support six rounds for every unresolved account issue. Round state belongs to the individual `accountGroup + bureau/furnisher + disputed field` case—not to the campaign as a whole. An item deleted by TransUnion in Round 1 may remain at Round 3 with Equifax and Round 2 with Experian.

Each round has an objective, entry criteria, required material difference, and allowed next action:

#### Round 1 — Initial specific accuracy dispute

- Target: the CRA reporting the item; direct furnisher only when the configured strategy and address are appropriate.
- Voice: cooperative, first-person, concise, factual.
- Content: exact displayed account identifier, exact disputed field/value, basis, requested correction/deletion, report exhibit.
- Goal: obtain a genuine investigation and written result.
- Auto-send: allowed for high-confidence, readiness-score-qualified cases after campaign authorization.

#### Round 2 — Response-specific reinvestigation

- Trigger: verified/updated result that does not resolve the identified issue, or a materially changed report.
- Target: unresolved CRA case; furnisher as appropriate.
- Required new value: identify what the first result failed to address, add a cross-bureau comparison, clarify the consumer assertion, or add newly available report/evidence information.
- Content: prior sent/delivery/result dates, unresolved field, material difference report.
- Goal: focus the second investigation on the exact unresolved defect rather than resending Round 1.
- Auto-send: allowed when response classification and material-difference confidence are high.

#### Round 3 — Direct furnisher and data-integrity escalation

- Trigger: CRA verification persists and the disputed field is within direct-furnisher scope, or the furnisher is the most useful source for resolving the field.
- Target: verified direct-dispute address for the furnisher; CRA follow-up only when independently justified.
- Content: account-identifying information, specific disputed field and basis, available supporting information, prior CRA result, requested correction to every CRA receiving inaccurate data.
- Goal: require investigation at the data source and create a documented furnisher response.
- Auto-send: permitted only after recipient/address/scope validation and consumer-authorship attestation.

#### Round 4 — Procedure, method, and unresolved-investigation notice

- Trigger: completed prior investigation with an unresolved issue, inadequate response, missing treatment of relevant information, or a documented deadline problem.
- Target: the entity whose investigation or response is at issue.
- Content: response-specific omissions, relevant information previously supplied, appropriate procedure/method request, delivery timeline, and exact remaining inaccuracy.
- Goal: determine how the disputed field was handled and give the recipient a precise opportunity to correct the unresolved reporting.
- Auto-send: allowed for well-supported procedural follow-ups; legal conclusions remain constrained by the rule registry.

#### Round 5 — Regulatory escalation packet

- Trigger: documented unresolved reporting after prior specific disputes, a qualifying no-response/deadline event, repeated failure to address relevant information, or other rule-registry eligibility.
- Output: first-person CFPB-ready narrative, timeline, copies of letters, delivery proof, responses, report excerpts, and requested resolution; State AG/other channel only when applicable.
- Goal: present a compact evidence-backed case record rather than a generic complaint threat.
- Auto-generation: yes.
- External submission: consumer confirmation required.

#### Round 6 — Final consumer demand and legal-review package

- Trigger: Round 5 remains unresolved and the event history supports a final escalation.
- Output: measured first-person final notice, complete chronology, issue/evidence matrix, damages-impact notes supplied by the consumer, and attorney-referral export.
- Goal: final documented opportunity for correction and a clean package for qualified legal review if needed.
- Auto-generation: yes.
- Auto-mail: configurable after counsel-approved template review.
- Lawsuit threat or external legal action: never asserted as inevitable and never filed automatically.

### Round transition rules

- Calculate waiting periods from verified mailing/delivery events, never draft generation.
- A response can advance, hold, resolve, or branch the case; a pass number alone never determines the next letter.
- Every Round 2–6 action requires a `MaterialDifferenceReport` or a qualifying procedural/deadline event.
- If no material next step exists, place the item in `MONITORING`, not a cosmetic rewrite queue.
- Do not advance a bureau that deleted or corrected the issue merely because another bureau remains unresolved.
- When one bureau deletes an item, use that fact as a comparison only when the records are confirmed to represent the same account and the implication is stated accurately.
- Permit a user to pause, skip, or seek legal review at any round.
- Preserve all six rounds even when an item starts later because an earlier strategy is inapplicable; record skipped-round reasons.

### After Round 6

Round 6 is not a permanent dead end. Open a new issue cycle only when there is a legitimate new event:

- a newly imported report contains a new or changed inaccuracy;
- the item is reinserted;
- new evidence becomes available;
- a furnisher changes the reported value;
- a regulator or recipient supplies new information;
- the user identifies a different disputed field.

The new cycle links to the prior genealogy but begins with a new issue/version. Do not create Round 7+ by merely changing wording. This allows long-running cases to continue without undermining specificity or creating unnecessary frivolous-treatment risk.

### Six-round data model

Store per case:

- `currentRound: 1 | 2 | 3 | 4 | 5 | 6`;
- `roundStatus`;
- `roundStartedFromEventId`;
- `entryCriteriaSatisfied`;
- `materialDifferenceReport`;
- `strategyVersion`;
- `targetId` and verified address source;
- `sentLetterId`, provider receipt, tracking, delivery date;
- `responseId` and field-level outcome;
- `nextEligibleAt` and calculation reason;
- `skipReason` or `holdReason`;
- `issueCycleNumber`;
- complete parent/child genealogy.

The dashboard should show `Round 3 of 6` per target/field and preview exactly what must happen before Round 4 becomes eligible.

### Automatic remediation before blocking

If an account number is incomplete:

- use the target bureau’s displayed identifier;
- add report date and balance for specificity;
- search confirmed account-group sources;
- search user-uploaded account evidence;
- only then ask the user.

If a letter fails voice or style validation:

- repair automatically;
- then use deterministic fallback;
- do not ask the user to regenerate it manually.

## Upgrade 6 — Response intelligence and closed-loop learning

### Response record

Store:

- original image/PDF hash;
- OCR text;
- sender and received date;
- matched account group and target;
- matching confidence;
- outcome per disputed field;
- reason codes and quoted short excerpts;
- changed report values;
- response deadline comparison;
- recommended next action;
- model/provider/version;
- user correction if classification was wrong.

### Field-level outcomes

A single response may delete one item, update another, and verify a third. Classify at the disputed-field level rather than using one outcome for an entire letter.

### Learning controls

Use local outcome data to rank strategies only after sufficient samples. Apply Bayesian smoothing or minimum sample thresholds so one or two outcomes do not redefine strategy. Track performance by:

- bureau;
- furnisher;
- item type;
- issue code;
- evidence tier;
- letter strategy/version;
- delivery channel;
- response type;
- time to resolution.

Never train the engine to make unsupported claims merely because an aggressive letter coincided with a deletion.

## Upgrade 7 — AI provider redesign

### Remove OpenRouter

Remove:

- OpenRouter key fields from Settings;
- `OPENROUTER_FREE_MODEL_CHAIN` and discovery code;
- OpenRouter provider state and fetch implementation;
- OpenRouter health/status cards;
- secure-key migration after safely deleting the old stored key.

### Add OpenAI API as optional quality provider

Label the setting `OpenAI API Key`, not `ChatGPT API Key`. ChatGPT subscriptions and OpenAI API billing are separate. A ChatGPT Plus/Pro subscription does not supply free API usage.

Use the OpenAI Responses API and structured outputs for:

- final letter drafting;
- targeted repair;
- complex response analysis;
- account-match explanation when deterministic signals are inconclusive.

As of this blueprint, official OpenAI model guidance lists GPT-5.6 variants, including a cost-sensitive `gpt-5.6-luna`. Do not depend forever on one hard-coded model string. Store a tested default and allow remote/configurable model updates with a known-good fallback. The app should expose a small model selector rather than fetching and showing every model.

OpenAI is not the recommended “free third provider.” It is the optional quality provider with explicit spend controls.

### Finish Cloudflare Workers AI as the third free-capable provider

Cloudflare Workers AI currently documents a daily free allocation. The existing router already contains a Cloudflare call, so this is the lowest-friction replacement for OpenRouter.

Fixes required:

- add Cloudflare Account ID and API Token fields to Settings;
- store both using Electron secure storage;
- stop reading only `VITE_CF_AI_TOKEN` and `VITE_CF_ACCOUNT_ID` from the bundled frontend;
- add a model setting and tested fallback model;
- test with a minimal structured-output request;
- show quota/rate-limit status and cooldown;
- never bundle the token into Vite output.

### Recommended routing

`FREE-FIRST`:

- report parsing/long document: Gemini;
- fast classification and ordinary draft: Groq;
- provider fallback and repair: Cloudflare;
- deterministic local template if all fail.

`QUALITY-FIRST`:

- report parsing and extraction: Gemini;
- final grounded draft and repair: OpenAI;
- classification, scoring, and quick transforms: Groq;
- Cloudflare fallback;
- deterministic local template if all fail.

### Provider-aware retry policy

- Retry `429`, `408`, and transient `5xx` responses using provider headers and jitter.
- Do not retry invalid key, malformed request, or unsupported model errors with the same provider.
- On validator failure, issue a repair request—not the original generation request.
- Keep the same structured facts across providers.
- Persist provider/model/version and validation results for diagnosis.
- Use a circuit breaker with task-specific health, because a provider may parse successfully while failing long-form generation.

### Privacy

Never send full SSNs to an AI provider. Mask account numbers unless the full value is strictly needed. Send source snippets only for the relevant account, not an entire report, when the task allows it. Show the user which providers may receive report data.

## Upgrade 8 — Evidence-first success engine

Create an item-level `EvidenceManifest`:

- report excerpt;
- bureau and report date;
- displayed account identifier;
- disputed field/value;
- expected/correct value;
- reason for expected value;
- supporting document IDs;
- prior disputes and responses;
- identity verification documents required for the channel;
- evidence confidence and freshness;
- enclosure list.

Evidence tiers:

- `INSUFFICIENT`: cannot identify a specific issue.
- `FACTUAL_DISPUTE`: report itself shows the claimed value and the user identifies the error.
- `SUPPORTED`: external evidence supports the correction.
- `AUDIT_READY`: source, evidence, delivery, and history are complete.

Do not globally block all letters because a government ID is not in the vault. Determine document requirements by recipient/channel. The app may draft before all mailing enclosures are present, but it should not auto-send a packet that the chosen channel is likely to reject for missing identity documents.

## Upgrade 8A — Item Verify / Report-Only Dispute Engine

### Product definition

“Item verify” or “no outside proof” should mean the consumer has identified a specific accuracy or completeness issue but does not possess an external statement, receipt, court record, or similar exhibit. It must not mean there is no factual basis, or that the app sends a generic “prove this account or delete it” letter.

The consumer report itself, the exact displayed values, cross-bureau differences, prior responses, and the consumer’s first-person knowledge can provide information sufficient to frame a specific dispute. CFPB guidance says a CRA or furnisher cannot insist on a preferred form or a specific attachment beyond applicable requirements when the consumer has supplied sufficient information to investigate. However, a CRA may treat a dispute as frivolous or irrelevant when it does not specify what information is disputed or otherwise lacks enough information to investigate.

Therefore, the app should convert every report-only dispute into a structured, field-specific investigation request.

### Supported report-only bases

1. `CROSS_BUREAU_CONFLICT`
   - The same confirmed account reports materially different balances, statuses, dates, limits, payment history, responsibility, or delinquency information.
2. `INTERNAL_REPORT_CONTRADICTION`
   - Two fields on the same report cannot both be true, such as paid/closed with an incompatible current balance or inconsistent chronology.
3. `CONSUMER_KNOWLEDGE_ASSERTION`
   - The consumer states a specific fact from personal knowledge: not my account, never late in the identified month, not jointly liable, wrong opened date, wrong balance, or paid/settled status.
4. `INCOMPLETE_REPORTING`
   - A material field required to understand the reported status is missing, ambiguous, or internally incomplete.
5. `DUPLICATE_OR_TRANSFER_CONFLICT`
   - Multiple tradelines appear to report the same obligation without clearly distinguishing transfer, sale, or remaining liability.
6. `OBSOLESCENCE_OR_DATE_CONCERN`
   - Reported dates create a specific concern about the reporting period or possible re-aging.
7. `PRIOR_INVESTIGATION_GAP`
   - A prior result did not address the exact field, evidence, or discrepancy presented.

### Minimum specificity contract

Every item-verify dispute must contain:

- target bureau and report date;
- creditor/furnisher name;
- the exact account token displayed by that target;
- the exact field being disputed;
- the value currently reported;
- the consumer’s basis for questioning it;
- the expected value if known, otherwise a precise request to determine and report the accurate value;
- the requested outcome: correct, delete if inaccurate/unverifiable, remove duplicate, or provide results;
- a copy/excerpt of the relevant report entry when available;
- no unsupported claim that a missing document automatically compels deletion.

Example structure:

```text
My Equifax report dated [date] lists [creditor], account ending [token],
with a current balance of [reported value]. Experian reports the account
as [conflicting value/status], and the records have been matched to the same
account based on [confirmed matching signals]. I dispute the accuracy and
completeness of the Equifax balance/status. Please conduct a reasonable
reinvestigation of those specific fields and correct them to the accurate
values, or delete the information if it cannot be verified as accurate.
```

For a consumer-knowledge assertion:

```text
My report lists a 30-day late payment for [month/year] on account ending
[token]. I dispute that specific payment-history entry because I did not make
a late payment for that month. Please investigate that month’s payment status
and correct or delete the inaccurate late-payment notation.
```

The app must not add a claimed correct value unless the consumer, another confirmed report, or a source document supplies it.

### Automatic Report Exhibit Builder

For report-only disputes, automatically create an enclosure from the imported report:

- crop or reproduce only the relevant tradeline section;
- show bureau, report date, creditor, displayed account token, and disputed fields;
- visually mark the exact values being disputed;
- redact unrelated accounts, full SSN, and unnecessary personal data;
- add an exhibit label and source hash;
- include a cross-bureau comparison table when that is the basis.

This turns a “no outside proof” dispute into a well-organized packet without asking the user to manually annotate a PDF.

### Non-frivolous quality score

Add an explainable `InvestigationReadinessScore`:

- account identified: 20;
- disputed field identified: 20;
- current reported value quoted: 15;
- basis explained: 20;
- requested result stated: 10;
- relevant report excerpt included: 10;
- consumer contact/identity packet complete for channel: 5.

Routing:

- `85–100`: auto-ready after normal validation.
- `70–84`: auto-repair missing specificity.
- `50–69`: Action Required with one focused question.
- `< 50`: do not send; the app has not identified a meaningful dispute.

Do not award points merely for adding citations, aggressive words, or length.

### Repeated-round protection

Substantially repeating the same dispute with no new information creates avoidable frivolous-treatment risk, particularly for direct furnisher disputes. Before any later round, compute a `MaterialDifferenceReport` against all prior letters:

- new disputed field;
- newly discovered cross-bureau conflict;
- new report value;
- new consumer clarification;
- new exhibit;
- response-specific omission;
- elapsed deadline/delivery event;
- newly relevant remedy.

If there is no material difference, do not rotate wording just to appear new. Hold the case, request one useful fact, monitor the next report, or select a procedurally appropriate response action. Semantic camouflage is not a valid strategy.

### Item-verify escalation sequence

1. **Initial report-specific dispute**
   - first-person, concise, one or a few clearly related fields, report excerpt attached;
   - minimal legal density;
   - exact displayed account token.
2. **Response-aware follow-up**
   - quote or summarize the actual result;
   - identify the field or evidence the response did not address;
   - add a genuinely new comparison, clarification, or report value.
3. **Procedure/method follow-up where applicable**
   - request the appropriate description or information based on the completed reinvestigation;
   - do not use this as a generic first-round substitute for a factual dispute.
4. **Direct furnisher dispute when within scope**
   - send to the proper direct-dispute address;
   - identify the account, disputed information, basis, and reasonably available supporting information;
   - preserve the consumer-authored review/attestation.
5. **Regulatory complaint or legal review**
   - only after documented delivery/history and a supported unresolved problem;
   - generate automatically but require confirmation before external filing.

### Consumer attestation

Before the first campaign, use one plain-language attestation instead of repeated prompts:

```text
I reviewed the accounts and dispute reasons selected for this campaign.
The statements are based on my credit reports, documents, or personal knowledge.
I authorize the app to prepare correspondence in my name using those facts.
I understand the app cannot truthfully dispute information I know is accurate.
```

Store the attestation version, timestamp, selected cases, and later corrections. This supports genuine consumer authorship; it must not be presented as a device for disguising third-party preparation.

## Upgrade 9 — Legal and claim applicability registry

Create a versioned registry rather than scattering legal assertions through prompts.

Each rule includes:

- authority and citation;
- allowed target;
- factual predicates;
- requested remedy supported;
- prohibited overstatement;
- last counsel-review date;
- source URL;
- template fragments;
- whether auto-send is permitted.

Remove or rewrite claims that universally state:

- original signed contracts must always be produced;
- failure to provide every demanded document automatically requires deletion;
- automated processing itself proves a violation;
- a particular Metro 2 code is legally mandatory without confirming applicability;
- damages or willfulness are established before the facts support them.

Use the direct-dispute requirements in Regulation V as the baseline for furnisher notices: identify the account, identify the specific disputed information and basis, and include reasonably required supporting information.

## Upgrade 10 — Usability and overall app improvements

### One-command onboarding

1. Create/confirm consumer profile.
2. Import all available reports.
3. Parse and normalize.
4. Build Account Identity Graph.
5. Show only medium-confidence match confirmations.
6. Detect dispute candidates and evidence gaps.
7. Present one campaign summary and consent screen.
8. Autopilot handles the remainder.

### Command center

Replace overlapping autopilot screens with one dashboard:

- `Ready`: validated packets ready to send.
- `Waiting`: delivered and within response window.
- `Action Required`: only real exceptions.
- `Responses`: newly classified results.
- `Wins/Corrections`: resolved items and reinsertion monitoring.
- `Account Match Review`: medium-confidence links.

### Explainability

Every automated decision should answer:

- Why were these accounts grouped?
- Which account digits came from which source?
- Why was this issue selected?
- Why was this recipient selected?
- Why is this letter allowed to auto-send?
- What event starts the response clock?
- Why is the next escalation appropriate?

### Accessibility and reliability

- keyboard navigation for all confirmation cards;
- screen-reader labels;
- high-contrast modes;
- autosave drafts and workflow state;
- offline deterministic letter generation;
- crash recovery banner with automatic resume;
- exportable audit package;
- visible data-retention/delete controls.

## Upgrade 11 — Concrete file-by-file implementation map

### Replace or substantially refactor

- `src/services/letterGeneratorV2.ts`: orchestrated draft/repair/fallback pipeline.
- `src/services/personaMatrix.ts`: consumer styles only.
- `src/services/directFurnisherEngine.ts`: first-person consumer-author policy.
- `src/services/geminiService.ts`: eliminate duplicate legacy letter path or make it call V2.
- `src/services/autopilotEngine.ts`: compatibility adapter only.
- `src/services/autoPilotEngineV2.ts`: event-driven case orchestrator.
- `src/services/accountMergeEngine.ts`: adapter to Account Identity Graph.
- `src/services/tradelineMerger.ts`: adapter or removal after migration.
- `src/context/AppContext.tsx`: remove inline account-number stitcher.
- `src/services/aiRouter.ts`: remove OpenRouter; add OpenAI; finish secure Cloudflare.
- `src/pages/Settings.tsx`: OpenAI and Cloudflare settings, provider mode, spend/quota status.

### Add

- `src/services/consumerVoicePolicy.ts`
- `src/services/consumerVoiceValidator.ts`
- `src/services/letterGenerationOrchestrator.ts`
- `src/services/deterministicLetterRenderer.ts`
- `src/services/disputeFactModel.ts`
- `src/services/legalRuleRegistry.ts`
- `src/services/accountIdentityService.ts`
- `src/services/accountAlignmentEngine.ts`
- `src/services/accountEvidenceExtractor.ts`
- `src/services/caseStateMachine.ts`
- `src/services/autopilotEventBus.ts`
- `src/services/providerHealthService.ts`
- `src/components/AccountMatchConfirmationModal.tsx`
- `src/components/ActionRequiredQueue.tsx`
- `src/components/DigitProvenanceView.tsx`

## Upgrade 12 — Implementation phases

### Phase 0: Test harness and baselines

- Save anonymized examples of letters that failed.
- Add fixtures for every dispute family, target, and pass.
- Add third-party voice fixtures.
- Add masked-number alignment fixtures.
- Record current generation success rate and average interventions.

### Phase 1: Consumer voice and zero-failure generation

- Add ConsumerVoicePolicy and validator.
- Remove attorney/representative prompts.
- Split hard and soft validation failures.
- Add targeted repair.
- Add deterministic fallback templates.
- Make V2 the only letter path.
- Add regression fixtures from the supplied American Express, Capital One, Discover, and Upgrade failure messages.
- Remove the Experian calibration/global opening-rule contradiction.

Exit criteria:

- 100% of ordinary fixture letters use first-person consumer voice.
- zero `client`, `on behalf`, or representative-language leakage.
- at least 99% of valid-input fixtures produce a usable draft even with all providers disabled.
- the supplied seven failed target scenarios produce repaired or deterministic fallback letters with no style-related terminal failure.

### Phase 2: Account Identity Graph

- preserve raw account tokens and provenance;
- implement constrained candidate graph;
- separate grouping/digit confidence;
- add alignment candidates;
- add confirmation/rejection persistence;
- migrate existing cross-bureau groups safely.

Exit criteria:

- no invented digit in any fixture;
- all displayed digits have provenance;
- high-confidence grouping precision above 99% on labeled fixtures;
- medium-confidence candidates appear in the confirmation popup;
- letters work with bureau-displayed identifiers even when full number remains unknown.

### Phase 3: Autopilot case orchestration

- add per-target cases and immutable transitions;
- event triggers;
- automatic remediation;
- delivery-based clocks;
- response classification at field level;
- crash recovery/idempotency.
- implement the complete six-round ladder and per-target round genealogy;

Exit criteria:

- no duplicate send after restart;
- no deadline created from draft generation;
- unresolved placeholders cannot leave the app;
- normal high-confidence cases require no manual step after campaign approval.
- one item can progress independently through all six justified rounds without being coupled to unrelated bureau outcomes.

### Phase 4: Provider redesign

- remove OpenRouter;
- implement OpenAI Responses API provider;
- finish Cloudflare runtime credential path;
- add FREE-FIRST and QUALITY-FIRST;
- provider-specific health, retry, and observability;
- PII minimization.

### Phase 5: UX consolidation and analytics

- command center;
- Action Required queue;
- Account Match Review;
- explainability panels;
- outcome analytics with sample-size controls;
- accessibility and recovery testing.

## Upgrade 13 — Three-Month Beta and Small-Alpha Release Program

### Commercial compliance gate before accepting payment

Because the planned alpha involves discounted paid access to a credit-repair product, obtain specialist counsel before setting pricing, marketing, billing timing, contracts, cancellation handling, telemarketing, or promising results. The Credit Repair Organizations Act prohibits misleading representations, requires disclosures and written contracts in covered situations, provides cancellation rights, and restricts advance payment. Telemarketing can add stricter Telemarketing Sales Rule requirements. Software providers supporting credit-repair businesses have also faced regulatory scrutiny.

Required release controls:

- no guaranteed deletions, score increases, or completion dates;
- marketing language tied to measured beta results with sample sizes;
- no claims that accurate, current negative information can always be removed;
- counsel-approved terms, disclosures, contract, cancellation process, and billing flow;
- state-by-state review before offering paid service broadly;
- clear distinction between self-help software and any managed service;
- documented consumer review/authorization and ability to edit every external submission;
- no telemarketing launch until TSR analysis is complete.

### Weeks 1–2: Instrumented shadow beta

- Generate plans, matches, and letters but do not auto-mail.
- Have an expert review every draft against source data.
- Label each validation finding.
- Build the first 100–250 anonymized fixture cases.
- Compare AI output with deterministic fallback output.
- Measure false merges and missing matches.
- Fix every third-party voice leak and unsupported claim before proceeding.

Exit gate:

- no critical factual hallucination in the latest 200 drafts;
- zero representative-voice leakage;
- 100% final placeholders resolved;
- every account digit has provenance or remains masked;
- every planned target has a verified address source.

### Weeks 3–6: Controlled internal sending beta

- Send only expert-approved packets.
- Start with high-confidence account groups and readiness scores of 85+.
- Limit batch size by recipient and day.
- Validate actual mail-provider acceptance and delivery events.
- Import every response and compare AI classification with expert classification.
- Test crash recovery, duplicate prevention, provider outages, and offline fallback.

Exit gate:

- zero duplicate sends;
- zero deadlines started from generation time;
- >=99% valid-input letter creation;
- >=98% high-confidence response classification, with uncertain cases routed to review;
- high-confidence account grouping precision >=99% on labeled cases.

### Weeks 7–10: Expanded beta and outcome calibration

- Expand issue types gradually.
- Compare report-only packets with evidence-supported packets separately.
- Measure outcomes by issue code, not just letter tone or pass.
- Require minimum sample sizes before changing strategy weights.
- Audit complaints and high-pressure language manually.
- Run accessibility, backup/restore, export/delete, and multi-profile isolation tests.

### Weeks 11–12: Alpha release candidate

- Freeze schemas and legal-rule registry version.
- Run full regression suite on Windows and Android.
- Perform a PII/security review of logs, archives, API prompts, backups, and crash reports.
- Verify installer upgrades preserve encrypted profiles and event history.
- Prepare rollback and incident-response procedures.
- Publish known limitations and supported dispute types.
- Complete counsel review of paid-release flows and external templates.

### Small-alpha operating limits

- invite-only cohort;
- explicit supported-state list;
- conservative daily send caps;
- no unattended complaint or pre-litigation submission;
- rapid kill switch by provider, template version, issue code, bureau, or furnisher;
- in-app feedback attached to case/letter IDs;
- weekly review of failed drafts, false merges, frivolous notices, and response outcomes;
- automatic rollback to deterministic templates when a prompt/model regression appears.

### Beta dataset discipline

- strip names, addresses, SSNs, and full account numbers from test fixtures;
- preserve structural mask patterns and field relationships;
- version every fixture and expected result;
- separate training/optimization examples from final holdout evaluation;
- do not optimize against the holdout set;
- keep adverse examples: false same-account matches, conflicting digits, vague disputes, and misleading model language.

## Acceptance test matrix

The upgrade is not complete until automated tests cover:

### Voice

- normal bureau dispute is first-person;
- direct furnisher dispute is first-person;
- CFPB narrative is first-person;
- pre-litigation draft is first-person and does not claim representation;
- no forbidden representative phrase appears.

### Generation reliability

- Groq unavailable -> Gemini succeeds;
- Gemini unavailable -> Cloudflare succeeds;
- every provider unavailable -> deterministic letter succeeds;
- model produces third-party voice -> targeted repair succeeds;
- repair fails -> deterministic first-person template succeeds;
- optional telephone paragraph missing -> letter still succeeds;
- FCRA citation appears in paragraph one -> letter is accepted or automatically reordered, not discarded;
- Experian calibration and global voice policy cannot issue contradictory opening instructions;
- unsupported legal claim -> removed or routed to review.
- a report-only dispute with a specific field and basis produces a complete packet without an external proof document;
- a vague “verify this account” request is repaired into a specific dispute or blocked for one focused clarification;
- a substantially repeated dispute with no new information is held rather than cosmetically rewritten.

### Account identity

- exact suffix match plus matching dates groups automatically;
- first-four and last-four tokens align only with position evidence;
- two same-creditor accounts do not collapse together;
- contradictory digits produce uncertainty, not majority-vote invention;
- user-confirmed match persists;
- user-rejected match never reappears unchanged;
- bureau-specific letters use the target bureau’s displayed account token.

### Autopilot

- restart during generation resumes without duplication;
- provider acceptance creates the deadline event;
- draft creation does not create a deadline;
- response on one bureau does not resolve other bureau cases;
- deletion triggers reinsertion monitoring;
- low-confidence response enters Action Required;
- high-confidence correction automatically closes the relevant field.
- report-only cases receive an automatically marked report excerpt;
- medium-readiness cases ask only the missing factual question;
- every later-round letter contains a documented material difference from the prior round.
- each unresolved item/target can complete Rounds 1–6 independently;
- Round 2 cannot be a cosmetic copy of Round 1;
- Round 3 validates direct-furnisher scope and address;
- Round 5 generates but does not externally submit a complaint without confirmation;
- Round 6 generates a complete final/legal-review package;
- a genuinely new post-Round-6 event opens a linked new issue cycle rather than an arbitrary Round 7 rewrite.

## Metrics

Track:

- usable-letter generation rate;
- deterministic fallback rate;
- first-person voice violation rate;
- factual-grounding failure rate;
- average repair attempts;
- cases requiring user interaction;
- account-group precision and recall;
- digit provenance coverage;
- false merge/rejected merge rate;
- provider failure/rate-limit rate;
- time from report import to ready packet;
- delivery-confirmed packet rate;
- deletion, correction, duplicate-removal, and no-response rates separately;
- time to first useful resolution;
- reinsertion rate;
- duplicate-send and deadline-error rate.

Primary product targets:

- `>= 99%` usable draft creation for valid inputs;
- `0%` third-party voice leakage;
- `0` invented account digits;
- `< 10%` ordinary cases requiring interaction after setup;
- `0` deadlines created before a real mailing event;
- `0` duplicate sends after crash/restart.

## Recommended final provider configuration

Default new installation:

1. Gemini — parsing and long-context report comparison.
2. Groq — fast classification and free-first drafting.
3. Cloudflare Workers AI — third free-capable fallback.
4. OpenAI — optional quality upgrade for final drafting/repair and complex response reasoning.
5. Deterministic local renderer — mandatory final fallback, no API key required.

This design removes OpenRouter instability without forcing users to pay for OpenAI. Users who add an OpenAI API key can enable QUALITY-FIRST. Users who do not still have three provider paths plus local deterministic generation.

## Official references used for this blueprint

- FTC sample letters use direct first-person consumer wording and recommend identifying each disputed item, explaining the facts, requesting correction/deletion, including supporting documents, and keeping delivery records: https://consumer.ftc.gov/articles/sample-letter-credit-bureaus-disputing-errors-credit-reports
- FTC dispute guidance recommends disputing with both the reporting company and the furnisher, supplying copies of evidence, and keeping records: https://consumer.ftc.gov/articles/disputing-errors-your-credit-reports
- CFPB consumer guidance recommends explaining what is wrong and why and including supporting documents: https://www.consumerfinance.gov/ask-cfpb/how-do-i-dispute-an-error-on-my-credit-report-en-314/
- CFPB Circular 2022-07 explains reasonable-investigation duties, limits on requiring preferred forms or specific attachments, and frivolous/irrelevant handling: https://www.consumerfinance.gov/compliance/circulars/consumer-financial-protection-circular-2022-07-reasonable-investigation-of-consumer-reporting-disputes/
- Regulation V direct-dispute notice requirements: https://www.consumerfinance.gov/rules-policy/regulations/1022/43/
- OpenAI API models and current model guidance: https://developers.openai.com/api/docs/models
- OpenAI Responses API migration guidance: https://developers.openai.com/api/docs/guides/migrate-to-responses
- OpenAI API pricing: https://developers.openai.com/api/docs/pricing
- OpenAI explains that ChatGPT and API billing are separate: https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account
- Cloudflare Workers AI pricing and daily free allocation: https://developers.cloudflare.com/workers-ai/platform/pricing/
- Groq rate-limit guidance: https://console.groq.com/docs/rate-limits
- Gemini API billing/free-tier guidance: https://ai.google.dev/gemini-api/docs/billing
- FTC Credit Repair Organizations Act overview: https://www.ftc.gov/legal-library/browse/statutes/credit-repair-organizations-act
- Official U.S. Code advance-payment provision: https://uscode.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title15-section1679b

## Final recommendation

Build the next release around three pillars:

1. **Consumer-authored correspondence:** every letter sounds like the consumer, contains the consumer’s facts, and requires no implied representative authority.
2. **Account Identity Graph:** aggressively discover likely same-account relationships, ask once on uncertain matches, and remain conservative about hidden digits.
3. **Autonomous repair and fallback:** AI failures, voice failures, and provider outages are handled automatically so valid cases still produce accurate, sendable drafts.

These changes will do more for real autonomy and outcome quality than adding harsher language or more dispute rounds. They make the app faster because it stops failing on style, smarter because it understands account identity and evidence, and easier because the user only sees decisions the software truly cannot make safely.

## Final implementation status — July 9, 2026

The production upgrade described by this blueprint has now been applied to the app:

- Consumer-authorship policy, first-person normalization, post-generation voice validation, targeted repair, and deterministic local fallback are active across the V2, direct-furnisher, CFPB, and legacy AutoPilot letter paths.
- The six-round strategy is active end-to-end. Each round has a distinct, response-aware purpose; rounds do not manufacture filings, evidence, legal conclusions, deadlines, or threats.
- Letter-creation provider errors no longer have to end the case: valid inputs fall back to a first-person local renderer for all six rounds.
- Account Identity Plan matching now uses creditor aliases, displayed account digits, dates, balances, and account type. High-confidence cross-bureau matches group automatically; medium-confidence candidates open a side-by-side Yes/No/Not sure review; hidden digits are reconstructed only when source tokens prove the alignment.
- V2 letter records now retain recipient address, citations, generation metadata, review state, archive path, and word count. Deadlines begin from an actual mailing event, not draft generation.
- OpenRouter has been removed from the active code and settings. FREE-FIRST and QUALITY-FIRST modes route among Gemini, Groq, Cloudflare Workers AI, optional OpenAI Responses API, and the local fallback.
- Cloudflare credentials are configurable in secure settings, and OpenAI is an optional quality provider rather than a requirement.
- Regression coverage now verifies consumer voice, all six deterministic rounds, confident account grouping, conflict rejection, and source-proven account suffix handling.
- Type-checking, final-upgrade regression tests, the Electron production build, and executable packaging are release gates for this implementation.

The next 1–3 months should be treated as outcome-validation beta work: measure delivery, response, correction/deletion, false-match, regeneration, and user-interruption rates by bureau, furnisher, account type, dispute reason, and round. Tune thresholds and templates from those measured outcomes without weakening factual accuracy or consumer authorship.

This document is product and engineering guidance, not legal advice. Before enabling automatic external submission of regulatory complaints or pre-litigation correspondence, have the applicable rule registry and final templates reviewed by qualified counsel.
