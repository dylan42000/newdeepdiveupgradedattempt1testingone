/**
 * scripts/letter-engine-regression.ts
 * World-Class AutoPilot Dispute Letter Engine — Regression Suite (Roadmap §8.1)
 *
 * Repository test convention: tsx + node:assert (no vitest runner installed).
 * Covers the full Milestone 1–5 surface:
 *
 *   1. FTC phrasing whitelist (§3.1) — ordinary consumer English never blocks
 *   2. Masked-account anchor tolerance (§3.2)
 *   3. Law-firm pronoun normalization to first-person (§3.4)
 *   4. Deterministic fallback when primary AI throws (§2 — Net-100% guarantee)
 *   5. FCRA statutory damages ($1,000) never trip fabrication gate (§3.3.1)
 *   6. Genuine law-firm/CRO template markers STILL blocked (regression guard)
 *   7. Acronym creditor anchor matching (§3.2)
 *   8. Repairable drafts pass as ai_primary when the repair pass is unreachable
 *   9. §5.2 Grouping Decision Matrix + grouped unit builder
 *  10. §6.1 QUEUE_CONFIG + adaptive jittered backoff
 *  11. §6.2 PROVIDER_CASCADE_TIERS 4-tier specification
 *  12. §5.1 Metro 2 cross-bureau narrative builder (§607(b) anchoring)
 *  13. Orchestrator diagnostics: unresolved placeholder → deterministic fallback
 */

import assert from 'node:assert/strict';
import {
  checkBoilerplatePolicy,
  assertFactualAnchorsPresent,
  assertNoBoilerplate,
  BoilerplateDetectedException,
  FUZZY_THRESHOLD,
  SEMANTIC_THRESHOLD,
} from '../src/services/letterValidator';
import { normalizeConsumerVoice } from '../src/services/consumerVoicePolicy';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import {
  orchestrateLetterGeneration,
  evaluateLetterDiagnostics,
  buildOrchestratorFactBlock,
  type OrchestratedLetterResult,
} from '../src/services/letterGenerationOrchestrator';
import {
  buildMetro2CrossBureauNarrative,
  type DisputeLetterRequest,
} from '../src/services/letterGeneratorV2';
import { buildFactBlock } from '../src/services/letterFactInjector';
import { QUEUE_CONFIG, computeAdaptiveBackoff } from '../src/services/apiQueueManager';
import { PROVIDER_CASCADE_TIERS } from '../src/services/aiRouter';
import {
  resolveGroupingStrategy,
  buildGroupedLetterUnits,
  GROUPING_DECISION_MATRIX,
} from '../src/services/autopilotOrchestrator';
import { renderTargetedDeterministicLetter } from '../src/services/manualLetterOrchestration';
import type { NegativeItem } from '../src/types';
import type { HealedAccount } from '../src/services/accountHealingEngine';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const baseItem: NegativeItem = {
  id: 'item-101',
  creditorName: 'DISCOVER FIN SVCS',
  accountNumber: '****8899',
  balance: 1200,
  typeOfNegative: 'Charge-off',
  originalDateOfDelinquency: '2022-11-01',
  dateOfLastReporting: '2026-05-01',
  originalOpeningDate: '2019-01-15',
  status: 'Charge-off',
  creditBureau: ['equifax'],
  additionalInfo: '',
  disputeRound: 1,
  disputeStatus: 'Undisputed',
  lastDisputeDate: null,
  disputeDeadline: null,
  priorityScore: 60,
  estimatedScoreImpact: null,
  notes: [],
  solDropDate: null,
};

const baseAccount: HealedAccount = {
  id: baseItem.id,
  creditorName: baseItem.creditorName,
  reconstructedAccountNumber: '****8899',
  balance: 1200,
  status: 'Charge-off',
  dateOpened: '2019-01-15',
  dateOfFirstDelinquency: '2022-11-01',
  confidenceScore: 92,
  healingFlags: [],
  requiresDisclosureRequest: false,
};

function makeReq(overrides: Partial<DisputeLetterRequest> = {}): DisputeLetterRequest {
  return {
    account: baseAccount,
    item: baseItem,
    metro2Flags: [],
    passNumber: 1,
    bureau: 'equifax',
    consumerName: 'Test Consumer',
    consumerAddress: '1 Main St, Salt Lake City, UT 84101',
    todayDate: '2026-07-31',
    ...overrides,
  };
}

function cleanDraftBody(): string {
  // 180+ words, anchored (creditor + suffix 8899), first-person, $1,200 only,
  // no statutes needed (pass 1), no placeholders, no banned template phrases.
  return [
    'My Equifax credit file reports a tradeline from DISCOVER FIN SVCS under account identifier ending in 8899, showing a reported balance of $1,200 and a charge-off status. I dispute the accuracy and completeness of this reporting because the balance figure and the delinquency trajectory reflected on my file do not match my own records of the account.',
    'Under 15 U.S.C. § 1681i(a)(1), you are required to conduct a reasonable reinvestigation of the information I have disputed. I ask that you examine the underlying account agreement and the complete payment ledger for account number ending in 8899 rather than relying on an automated verification response from the furnisher. The reported balance of $1,200 is the specific figure I challenge, along with the completeness of the dates associated with the delinquency.',
    'Please correct every inaccurate field you identify, and if the information cannot be verified as accurate and complete through the underlying records, delete the affected reporting from my file within the statutory period. Send me the written results of your reinvestigation and an updated copy of my credit report reflecting any changes.',
    'I am keeping a complete copy of this correspondence and its enclosures for my records. I revoke consent for automated telephone dialing systems, artificial or prerecorded voice calls, and SMS text messages concerning this account; please direct all future communications to me in writing at the address on file. Thank you for your prompt attention to this matter.',
  ].join('\n\n');
}

// ─── Test 1: FTC phrasing whitelist (§3.1) ────────────────────────────────────

{
  const text =
    'I am writing to dispute the reported balance on my Equifax report. ' +
    'Please investigate this inaccurate item. I believe this information is inaccurate.';
  const res = checkBoilerplatePolicy(text);
  assert.equal(res.ok, true, `FTC ordinary phrasing must pass (got finding: ${res.finding ?? 'none'})`);
  console.log('✔ 1. FTC consumer phrasing whitelisted — no boilerplate block');
}

// ─── Test 2: Masked-account anchor tolerance (§3.2) ───────────────────────────

{
  const text =
    'I dispute the tradeline from MIDLAND CREDIT MGMT for account ending in 1234 ' +
    'because the reported balance does not match my records.';
  const factBlock = buildFactBlock(
    {
      ...baseItem,
      creditorName: 'MIDLAND CREDIT MGMT',
      accountNumber: '****1234',
      fullAccountNumber: null,
    } as NegativeItem,
    'experian',
  );
  factBlock.accountSuffix = '1234';
  factBlock.accountDisplay = '****1234';
  const res = assertFactualAnchorsPresent(text, factBlock, 1);
  assert.equal(res.ok, true, `Masked ****1234 anchor must pass (missing: ${res.missingAnchors.join(', ')})`);
  console.log('✔ 2. Masked account ****1234 passes anchor verification');
}

// ─── Test 3: Law-firm pronoun normalization (§3.4) ────────────────────────────

{
  const raw = "Our client's account with Chase was charged off. On behalf of the consumer, we demand deletion.";
  const clean = normalizeConsumerVoice(raw);
  assert.ok(clean.includes('my account with Chase'), 'possessive client form → first-person my');
  assert.ok(clean.toLowerCase().includes('on my own behalf'), 'on behalf of → on my own behalf');
  assert.ok(!clean.includes('Our client'), 'third-party voice removed');
  console.log('✔ 3. Third-party law-firm pronouns normalized to first-person');
}

// ─── Test 4: Deterministic fallback when primary AI throws ────────────────────

{
  const faultyAIGenerator = async (): Promise<any> => {
    throw new Error('LLM_RATE_LIMIT_EXCEEDED');
  };
  const result: OrchestratedLetterResult = await orchestrateLetterGeneration(
    makeReq(),
    faultyAIGenerator,
  );
  assert.equal(result.sourceType, 'deterministic_fallback');
  assert.ok(result.body.includes('DISCOVER FIN SVCS'), 'fallback names creditor');
  assert.ok(result.body.includes('My equifax credit file reports'), 'fallback intro intact');
  assert.ok(result.wordCount > 50, 'fallback is a complete letter');
  assert.ok(result.auditExplanation.length > 0, 'audit trail recorded');
  console.log('✔ 4. Deterministic Metro 2 fallback renders when primary AI throws (Net-100%)');
}

// ─── Test 5: FCRA statutory damages never trip fabrication gate (§3.3.1) ──────

{
  const text =
    'If this unverified charge-off is not removed after reinvestigation, I may seek statutory ' +
    'damages of up to $1,000 under FCRA § 616 for willful noncompliance.';
  const res = guardLetterAgainstFabrication({ letterText: text, item: baseItem, personalInfo: null });
  const inventedBalance = res.findings.filter((f) => f.code === 'INVENTED_BALANCE');
  assert.equal(inventedBalance.length, 0, 'FCRA §616 statutory $1,000 must not be flagged as invented balance');
  // …but an ACTUAL invented balance is still blocked:
  const badRes = guardLetterAgainstFabrication({
    letterText: 'The reported balance is $73,419 which I dispute.',
    item: baseItem,
    personalInfo: null,
  });
  assert.ok(
    badRes.findings.some((f) => f.code === 'INVENTED_BALANCE' && f.severity === 'block'),
    'fabricated $73,419 must still hard-block',
  );
  console.log('✔ 5. Statutory damages whitelisted; true invented balances still blocked');
}

// ─── Test 6: Law-firm/CRO template markers STILL blocked ──────────────────────

{
  const text = 'This letter serves as formal notice of intent to file suit under FCRA unless you comply.';
  const res = checkBoilerplatePolicy(text);
  assert.equal(res.ok, false, 'law-firm template phrase must be flagged');
  assert.throws(() => assertNoBoilerplate(text), BoilerplateDetectedException);
  console.log('✔ 6. Genuine law-firm template markers remain blocked');
}

// ─── Test 7: Acronym creditor anchor matching (§3.2) ──────────────────────────

{
  const factBlock = buildFactBlock(
    { ...baseItem, creditorName: 'Bank of America', accountNumber: '****4455' } as NegativeItem,
    'transunion',
  );
  factBlock.accountSuffix = '4455';
  const res = assertFactualAnchorsPresent(
    'My report shows the BOA tradeline for account number ending in 4455 with a balance I dispute.',
    factBlock,
    1,
  );
  assert.equal(res.ok, true, `acronym "BOA" must satisfy creditor anchor (missing: ${res.missingAnchors.join(', ')})`);
  console.log('✔ 7. Acronym creditor matching (Bank of America → BOA) works');
}

// ─── Test 8: Repairable draft → ai_primary when repair layer unreachable ──────

{
  // Draft is missing the account suffix anchor (repairable) but has no hard blocks.
  const repairable = cleanDraftBody().replace(/882?899|8899/g, 'as shown on the report').replace(/ending in as shown on the report/g, 'as shown on the report');
  const result = await orchestrateLetterGeneration(makeReq(), async () => ({
    body: repairable,
    persona: 'test_persona',
    passNumber: 1 as const,
    bureau: 'equifax',
    metro2FlagsUsed: [],
    requiresDisclosure: false,
    generatedAt: new Date().toISOString(),
  }));
  assert.ok(
    result.sourceType === 'ai_primary' || result.sourceType === 'ai_repaired',
    `repairable draft must yield an AI-sourced letter, got ${result.sourceType}`,
  );
  assert.ok(result.body.trim().length > 0);
  console.log(`✔ 8. Repairable draft resolved via AI path (source: ${result.sourceType})`);
}

// ─── Test 9: §5.2 Grouping Decision Matrix ────────────────────────────────────

{
  assert.equal(resolveGroupingStrategy(1).mode, 'grouped_bureau');
  assert.equal(resolveGroupingStrategy(2).mode, 'individual_item');
  assert.equal(resolveGroupingStrategy(3).mode, 'individual_furnisher');
  assert.equal(resolveGroupingStrategy(4).mode, 'individual_item');
  assert.equal(resolveGroupingStrategy(6).mode, 'individual_item');
  assert.equal(GROUPING_DECISION_MATRIX.pass1.maxItemsPerLetter, 5);

  const items: NegativeItem[] = Array.from({ length: 7 }, (_, i) => ({
    ...baseItem,
    id: `grp-${i}`,
    creditBureau: i % 2 === 0 ? ['equifax'] : ['experian'],
  }));
  const units = buildGroupedLetterUnits(items, 1);
  const eqUnits = units.filter((u) => u.bureau === 'equifax');
  const exUnits = units.filter((u) => u.bureau === 'experian');
  assert.equal(eqUnits.length, 1, '4 equifax items fit in one grouped letter');
  assert.equal(eqUnits[0].items.length, 4);
  assert.equal(exUnits.length, 1, '3 experian items fit in one grouped letter');
  assert.equal(buildGroupedLetterUnits(items, 2).length, 7, 'pass 2 forces individual units');
  console.log('✔ 9. §5.2 grouping matrix: pass-1 grouped (≤5/bureau), passes 2–6 individual');
}

// ─── Test 10: §6.1 queue config + adaptive backoff ────────────────────────────

{
  assert.equal(QUEUE_CONFIG.MAX_CONCURRENCY, 2);
  assert.equal(QUEUE_CONFIG.MIN_REQUEST_INTERVAL_MS, 3500);
  assert.equal(QUEUE_CONFIG.MAX_RATE_LIMIT_RETRIES, 6);
  assert.equal(QUEUE_CONFIG.BASE_BACKOFF_MS, 2000);
  assert.equal(QUEUE_CONFIG.MAX_BACKOFF_MS, 60000);

  const b1 = computeAdaptiveBackoff(1);
  const b3 = computeAdaptiveBackoff(3);
  assert.ok(b1 >= 2000 && b1 <= 2800, `attempt 1 backoff ~2s+jitter (got ${b1})`);
  assert.ok(b3 >= 8000 && b3 <= 8800, `attempt 3 backoff ~8s+jitter (got ${b3})`);
  assert.ok(computeAdaptiveBackoff(10) <= 60000, 'backoff capped at 60s');
  assert.equal(computeAdaptiveBackoff(1, 5000), 5500, 'Retry-After header honored (+500ms)');
  console.log('✔ 10. §6.1 adaptive jittered backoff + queue config verified');
}

// ─── Test 11: §6.2 four-tier provider cascade ─────────────────────────────────

{
  assert.equal(PROVIDER_CASCADE_TIERS.length, 4, '4-tier cascade documented');
  assert.equal(PROVIDER_CASCADE_TIERS[0].provider, 'groq');
  assert.equal(PROVIDER_CASCADE_TIERS[1].provider, 'gemini');
  assert.equal(PROVIDER_CASCADE_TIERS[2].provider, 'openai');
  const tier4 = PROVIDER_CASCADE_TIERS[3];
  assert.ok(
    String(tier4.provider).includes('deterministic'),
    'tier 4 is the local deterministic Metro 2 engine',
  );
  assert.deepEqual(
    PROVIDER_CASCADE_TIERS[1].models.slice(0, 3),
    ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    'Gemini model order preserved',
  );
  console.log('✔ 11. §6.2 cascade: Groq ×2 → Gemini → OpenAI → Local Deterministic');
}

// ─── Test 12: §5.1 Metro 2 cross-bureau narrative builder ─────────────────────

{
  const narrative = buildMetro2CrossBureauNarrative('DISCOVER FIN SVCS', [
    { field: 'BALANCE', description: 'Equifax reports $0 / Paid while Experian reports $540 / Charge-Off', bureausInvolved: ['equifax', 'experian'] },
    { field: '17A', description: 'DOFD differs by 14 months across bureaus for the identical tradeline', bureausInvolved: ['equifax', 'experian'] },
  ]);
  assert.ok(narrative.includes('[Metro 2 Field Violation - BALANCE]'), 'field violation bullet rendered');
  assert.ok(narrative.includes('EQUIFAX, EXPERIAN'), 'bureaus enumerated');
  assert.ok(narrative.includes('§ 607(b)'), 'FCRA §607(b) anchor present');
  assert.ok(narrative.includes('1681e(b)'), '15 U.S.C. §1681e(b) anchor present');
  assert.equal(buildMetro2CrossBureauNarrative('X', []), '', 'empty violations → empty narrative');
  console.log('✔ 12. §5.1 Metro 2 cross-bureau narrative builder verified');
}

// ─── Test 13: Placeholder hard-block → deterministic fallback ─────────────────

{
  const placeholderDraft = cleanDraftBody() + '\n\nConsumer Name: [YOUR FULL NAME]';
  const result = await orchestrateLetterGeneration(makeReq(), async () => ({
    body: placeholderDraft,
    persona: 'test_persona',
    passNumber: 1 as const,
    bureau: 'equifax',
    metro2FlagsUsed: [],
    requiresDisclosure: false,
    generatedAt: new Date().toISOString(),
  }));
  assert.equal(result.sourceType, 'deterministic_fallback', 'unresolved placeholder must force fallback');
  assert.ok(!result.body.includes('[YOUR FULL NAME]'), 'fallback body is placeholder-free');
  console.log('✔ 13. Unresolved placeholder hard-block routes to deterministic fallback');
}

// ─── Test 14: Diagnostics are non-terminal & structured ───────────────────────

{
  const req = makeReq({ passNumber: 3 });
  const factBlock = buildOrchestratorFactBlock(req);
  const short = 'I dispute this account.';
  const diags = evaluateLetterDiagnostics(short, req, factBlock);
  assert.ok(diags.some((d) => d.code === 'LENGTH_INSUFFICIENT' && d.severity === 'repair'), 'short draft → repair');
  assert.ok(diags.some((d) => d.code === 'MISSING_ACCOUNT_SUFFIX_ANCHOR' && d.severity === 'repair'), 'missing suffix → repair');
  assert.ok(diags.some((d) => d.code === 'MISSING_STATUTORY_ANCHOR' && d.severity === 'repair'), 'pass 3 without statute → repair');
  assert.ok(!diags.some((d) => d.severity === 'hard_block'), 'plain short draft has no hard blocks');
  console.log('✔ 14. Stage-5 diagnostics classify repair vs hard_block correctly');
}

// ─── Test 15: Target-aware furnisher fallback (manual path) ───────────────────

{
  const req = makeReq({ passNumber: 3 });
  const letter = renderTargetedDeterministicLetter(req, 'LVNV Funding LLC');
  assert.ok(letter.body.includes('You furnish information about me'), 'furnisher framing present');
  assert.ok(letter.body.includes('1681s-2(a)(8)'), 'furnisher statutory duty anchor present');
  assert.ok(!letter.body.includes('My equifax credit file reports'), 'no CRA framing for furnisher target');

  const bureauLetter = renderTargetedDeterministicLetter(makeReq(), 'Equifax');
  assert.ok(bureauLetter.body.includes('My equifax credit file reports'), 'CRA framing for bureau target');

  const grouped = renderTargetedDeterministicLetter(makeReq(), 'Experian', [
    { ...baseItem, id: 'item-102', creditorName: 'CAPITAL ONE', accountNumber: '****5555' },
  ]);
  assert.ok(grouped.body.includes('2 reported items'), 'grouped letter enumerates items');
  assert.ok(grouped.body.includes('CAPITAL ONE'), 'sibling item named in grouped fallback');
  console.log('✔ 15. Target-aware deterministic fallback (furnisher vs bureau vs grouped)');
}

console.log('\nWorld-Class letter engine regression checks passed. (15/15)');
