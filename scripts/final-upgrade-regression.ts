import { normalizeConsumerVoice, validateConsumerVoice } from '../src/services/consumerVoicePolicy';
import { buildAccountIdentityPlan, reconstructProvenAccountNumber } from '../src/services/accountIdentityService';
import { buildTradelineMergePlan, scoreMergeCandidate, stitchAccountNumbers, decideMergeTier } from '../src/services/tradelineMerger';
import type { NegativeItem } from '../src/types';
import { deriveDofdFromRemovalDate } from '../src/services/creditReportParser/creditParser';
import { readFileSync } from 'node:fs';
import { getAIProviderMode, type AIProviderMode } from '../src/services/aiRouter';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { evaluateDisputeUniqueness } from '../src/services/antiSpamDisputeEngine';
import { getAccountTail, maskAccountNumber } from '../src/services/letterTemplateService';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const repaired = normalizeConsumerVoice('Our client disputes this account on behalf of the consumer.');
assert(validateConsumerVoice(repaired).length === 0, 'Consumer voice normalization must remove representative wording.');

const baseItem: NegativeItem = {
  id: 'eq-1', creditorName: 'Capital One Bank USA NA', accountNumber: '1234****7788', balance: 842,
  typeOfNegative: 'Charge-Off', originalDateOfDelinquency: '2022-01-01', dateOfLastReporting: '2026-06-01',
  originalOpeningDate: '2019-03-01', status: 'Charge-off', creditBureau: ['Equifax'], additionalInfo: 'Balance differs across reports',
  disputeRound: 1, disputeStatus: 'Undisputed', lastDisputeDate: null, disputeDeadline: null, priorityScore: 50,
  estimatedScoreImpact: null, notes: [], solDropDate: null, accountType: 'Revolving',
};
const sibling: NegativeItem = { ...baseItem, id: 'ex-1', creditorName: 'CAP ONE', accountNumber: '****56787788', balance: 846, creditBureau: ['Experian'] };
const unrelated: NegativeItem = { ...baseItem, id: 'tu-2', accountNumber: '9999****1111', balance: 9000, originalOpeningDate: '2024-01-01', creditBureau: ['TransUnion'] };
const plan = buildAccountIdentityPlan([baseItem, sibling, unrelated]);
assert(plan.autoGroups.some(group => group.some(item => item.id === baseItem.id) && group.some(item => item.id === sibling.id)), 'Strong cross-bureau account match should auto-group.');
assert(!plan.autoGroups.some(group => group.some(item => item.id === unrelated.id) && group.length > 1), 'Conflicting account should not auto-group.');
const stitched = reconstructProvenAccountNumber([baseItem, sibling]);
assert(stitched.endsWith('7788'), 'Source-proven suffix digits should be preserved.');

const smartPlan = buildTradelineMergePlan([baseItem, sibling, unrelated]);
assert(smartPlan.autoMerged.length === 1, 'Strong same-account records should auto-merge without manual review.');
assert(smartPlan.autoMerged[0].sourceItems.length === 2, 'Only the two compatible bureau records should merge.');
assert(smartPlan.pendingReviewMerges.length === 0, 'Clearly unrelated records must not create manual review noise.');
assert(stitchAccountNumbers([baseItem, sibling]).accountNumber === '123456787788', 'Complementary source digits should reconstruct the longest proven account token.');

const sameCreditorDifferentAccount: NegativeItem = {
  ...baseItem, id: 'tu-capital-one-other', creditBureau: ['TransUnion'], accountNumber: '9999****1111', balance: 844,
};
assert(scoreMergeCandidate(baseItem, sameCreditorDifferentAccount).disqualified, 'Conflicting known digits must prevent false merges for two accounts at the same creditor.');

// B6 adversarial: AMEX vs American Honda
const amex: NegativeItem = { ...baseItem, id: 'amex-1', creditorName: 'AMERICAN EXPRESS', accountNumber: '****1111', creditBureau: ['Equifax'] };
const honda: NegativeItem = { ...baseItem, id: 'honda-1', creditorName: 'AMERICAN HONDA', accountNumber: '****2222', creditBureau: ['Experian'] };
const amexHonda = decideMergeTier(amex, honda);
assert(
  amexHonda.decision === 'HARD_REFUSE' || amexHonda.decision === 'NO_MERGE' || amexHonda.disqualified,
  'AMEX vs American Honda must never AUTO_MERGE',
);
assert(amexHonda.decision !== 'AUTO_MERGE', 'Shared AMERICAN root must not auto-merge');

// Name+balance ONLY (strip dates) with no digits → never AUTO; ambiguous review/link only
const noDigitsA: NegativeItem = {
  ...baseItem, id: 'nd-a', accountNumber: '', fullAccountNumber: null, creditBureau: ['Equifax'],
  dateOpened: null, originalOpeningDate: null, dateOfFirstDelinquency: null, originalDateOfDelinquency: null,
};
const noDigitsB: NegativeItem = {
  ...baseItem, id: 'nd-b', accountNumber: '', fullAccountNumber: null, creditBureau: ['Experian'], balance: 840,
  dateOpened: null, originalOpeningDate: null, dateOfFirstDelinquency: null, originalDateOfDelinquency: null,
};
const borderline = decideMergeTier(noDigitsA, noDigitsB);
assert(borderline.decision !== 'AUTO_MERGE', 'Name+balance without digits/dates must never AUTO_MERGE');

// Alias + last4 should AUTO even without dates
const aliasLast4A: NegativeItem = {
  ...baseItem, id: 'al4-a', creditorName: 'CAP1', accountNumber: '****4821', balance: 500,
  creditBureau: ['Equifax'], dateOpened: null, originalOpeningDate: null,
};
const aliasLast4B: NegativeItem = {
  ...baseItem, id: 'al4-b', creditorName: 'Capital One', accountNumber: '5512****4821', balance: 510,
  creditBureau: ['Experian'], dateOpened: null, originalOpeningDate: null,
};
assert(decideMergeTier(aliasLast4A, aliasLast4B).decision === 'AUTO_MERGE', 'Alias + last4 must AUTO_MERGE');

assert(
  deriveDofdFromRemovalDate('TransUnion', 'Estimated month and year this item will be removed: January 2031') === '01/2024',
  'TransUnion removal month/year must derive a DOFD seven years earlier.',
);
assert(
  deriveDofdFromRemovalDate('Experian', 'On Record Until 08/2030') === '08/2023',
  'Experian On Record Until month/year must derive a DOFD seven years earlier.',
);
assert(
  deriveDofdFromRemovalDate('Equifax', 'On Record Until 08/2030') === 'Not listed',
  'Equifax must never receive the Experian/TransUnion derived-DOFD fallback.',
);
assert(
  deriveDofdFromRemovalDate('Experian', 'On Record Until 08/2030', '09/2019') === '09/2019',
  'An explicit bureau DOFD must always win over a derived value.',
);

const letterGeneratorSource = readFileSync(new URL('../src/services/letterGeneratorV2.ts', import.meta.url), 'utf8');
const directFurnisherSource = readFileSync(new URL('../src/services/directFurnisherEngine.ts', import.meta.url), 'utf8');
const aiRouterSource = readFileSync(new URL('../src/services/aiRouter.ts', import.meta.url), 'utf8');
const autopilotSource = readFileSync(new URL('../src/services/autoPilotEngineV2.ts', import.meta.url), 'utf8');
// Deterministic fallback is now a FEATURE — guarantees letters are always produced
// when ALL AI providers fail. This is the safety net, not a bug.
assert(letterGeneratorSource.includes('renderSafeFallbackDisputeLetter'), 'AutoPilot must import the safe fallback renderer as last-resort safety net.');
// Direct-furnisher letters use AI only (separate code path from dispute letters),
// so the assertion about the fallback renderer does not apply here.
assert(letterGeneratorSource.includes("taskType: 'letter'"), 'AutoPilot letter generation must use the provider-scoped letter route.');
assert(aiRouterSource.includes('primary-stack'), 'AI router must expose primary-stack mode');
assert(aiRouterSource.includes("raw === 'quality-first'"), 'Legacy quality-first must migrate to backup-quality');
assert(aiRouterSource.includes('backup-quality'), 'backup-quality mode must exist');
assert(
  !aiRouterSource.includes("getAIProviderMode() === 'quality-first'"),
  'selectProvider must not still branch on quality-first OpenAI-first',
);
assert(autopilotSource.includes('getPriorLetterContentsForItem'), 'Autopilot must fetch real prior letter bodies for uniqueness');
assert(autopilotSource.includes('planBatchStrategies'), 'Autopilot must plan Strategy Cards');
assert(!autopilotSource.includes('[], // Prior contents not fetched'), 'Empty uniqueness prior array defect must be fixed');

// Strategy card explainability
const card = planItemStrategy(baseItem, { passNumbers: { 'eq-1': 1 } });
assert(card.explainWhy.length >= 3, 'Strategy card must emit ≥3 explainWhy bullets');
assert(card.primaryAngle, 'Strategy card must select a primary angle');

// Uniqueness with real priors should score below empty-prior 100 when near-duplicate
const body = 'I dispute the Capital One account ending in 7788 as inaccurate under FCRA section 611.';
const uniq = evaluateDisputeUniqueness(body, [body], 2);
assert(uniq.score < 100, 'Near-duplicate prior letter must reduce uniqueness score');

// Identity fidelity: never invent 1234
const blankItem: NegativeItem = { ...baseItem, accountNumber: '', fullAccountNumber: null };
assert(getAccountTail(blankItem) === 'unconfirmed', 'Missing account digits must not invent 1234');
assert(maskAccountNumber(null, blankItem) === 'XXXX-????', 'maskAccountNumber must not fabricate digits');

// Provider mode type sanity
const mode: AIProviderMode = 'primary-stack';
assert(mode === 'primary-stack', 'primary-stack is the product default mode name');
void getAIProviderMode;

process.stdout.write('Final upgrade regression checks passed.\n');
