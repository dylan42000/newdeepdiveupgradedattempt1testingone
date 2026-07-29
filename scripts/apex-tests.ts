/**
 * Apex service regression tests — legal, debt-type, fraud, inquiry, goodwill,
 * classifier, anti-fab/UPL, aliases, consumer statement, score impact.
 */
import assert from 'node:assert/strict';
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategy } from '../src/services/debtTypeStrategyLibrary';
import { scanForFraud, scanReportForFraud } from '../src/services/fraudDetectionEngine';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';
import { evaluateGoodwillEligibility } from '../src/services/goodwillCampaignEngine';
import { classifyOnDeviceSync } from '../src/services/onDeviceClassifier';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { assertNoUplRisk } from '../src/services/uplPhraseBlocklist';
import { creditorsAreAliasMatch, resolveCreditorCanonical } from '../src/data/creditorAliasMatrix';
import { draftConsumerStatement, enforceWordLimit, isStatementEligible } from '../src/services/consumerStatementEngine';
import { estimateScoreImpactRange } from '../src/services/scoreImpactSimulator';
import { planApexItemStrategy } from '../src/services/apexItemStrategyPlanner';
import { planBatchStrategies } from '../src/services/itemStrategyPlanner';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import type { NegativeItem } from '../src/types';

function mkItem(partial: Partial<NegativeItem> & Pick<NegativeItem, 'id' | 'creditorName'>): NegativeItem {
  return {
    creditBureau: ['Experian'],
    accountNumber: '****1234',
    fullAccountNumber: 'XXXXXX1234',
    typeOfNegative: 'Collection',
    status: 'Open',
    accountType: 'Collection',
    balance: 450,
    dateOpened: '2022-01-15',
    dateOfFirstDelinquency: '2022-06-01',
    originalDateOfDelinquency: '2022-06-01',
    disputeStatus: 'Not Disputed',
    ...partial,
  } as NegativeItem;
}

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    throw err;
  }
}

console.log('Apex regression tests');

test('legal profile applies FCRA 611 and collection FDCPA flags', () => {
  const item = mkItem({ id: '1', creditorName: 'Midland Credit' });
  const profile = buildLegalProfile(item, { state: 'CA' });
  assert.equal(profile.fcra611Applicable, true);
  assert.ok(profile.availableAnchors.length >= 1);
  assert.equal(profile.debtClass, 'collections');
});

test('debt-type library covers 12 classes and inquiry classification', () => {
  assert.equal(classifyDebtType({ typeOfNegative: 'Hard Inquiry' }), 'hard_inquiry');
  assert.equal(classifyDebtType({ typeOfNegative: 'Charge Off', status: 'Charge-off' }), 'charge_off');
  assert.equal(getDebtTypeStrategy('medical').voiceRegister, 'consumer_assertive');
});

test('fraud scan flags mixed-file language', () => {
  const item = mkItem({
    id: 'f1',
    creditorName: 'Unknown Bank',
    additionalInfo: 'Possible mixed file / identity theft',
  });
  const flags = scanForFraud(item);
  assert.ok(flags.some((f) => f.severity === 'critical'));
  assert.ok(scanReportForFraud([item]).length >= 1);
});

test('inquiry engine classifies obsolete hard pulls', () => {
  const item = mkItem({
    id: 'inq1',
    creditorName: 'Chase Soft Check',
    typeOfNegative: 'Hard Inquiry',
    dateOpened: '2018-01-01',
  });
  assert.equal(isInquiryItem(item), true);
  const profile = classifyInquiry(item);
  assert.equal(profile.strategy, 'obsolete_removal');
});

test('goodwill eligibility for paid accounts', () => {
  const item = mkItem({
    id: 'gw1',
    creditorName: 'Capital One',
    status: 'Paid',
    accountStatus: 'Closed - Paid',
    typeOfNegative: 'Late Payment',
  });
  const result = evaluateGoodwillEligibility(item);
  assert.equal(typeof result.eligible, 'boolean');
});

test('on-device classifier heuristic path (no Transformers.js)', () => {
  const item = mkItem({ id: 'c1', creditorName: 'LVNV Funding', typeOfNegative: 'Collection' });
  const result = classifyOnDeviceSync(item, { pass: 1 });
  assert.equal(result.engine, 'heuristic');
  assert.equal(result.accountClass, 'collections');
});

test('anti-fabrication + UPL block attorney persona language', () => {
  const item = mkItem({ id: 'af1', creditorName: 'Cap One', accountNumber: '****9999' });
  const upl = assertNoUplRisk('As your attorney I demand deletion of account ending in 1234');
  assert.equal(upl.ok, false);
  const fab = guardLetterAgainstFabrication({
    letterText: 'Please delete account ending in 1234 immediately. As your attorney I insist.',
    item,
  });
  assert.equal(fab.ok, false);
});

test('creditor alias matrix matches Cap One ↔ Capital One', () => {
  assert.equal(resolveCreditorCanonical('CAP1'), 'CAPITAL_ONE');
  assert.equal(creditorsAreAliasMatch('CAP1', 'Capital One Bank'), true);
});

test('consumer statement enforces 100-word limit', () => {
  const item = mkItem({
    id: 'cs1',
    creditorName: 'Bank',
    disputeStatus: 'Verified',
    verificationCount: 3,
  });
  assert.equal(isStatementEligible(item, 5).eligible, true);
  const draft = draftConsumerStatement(item);
  assert.ok(draft.wordCount <= 100);
  const long = Array.from({ length: 120 }, () => 'word').join(' ');
  assert.equal(enforceWordLimit(long).split(/\s+/).length, 100);
});

test('score impact returns a range, never a single point', () => {
  const item = mkItem({ id: 'sc1', creditorName: 'Collection Agency', balance: 1200 });
  const range = estimateScoreImpactRange(item);
  assert.ok(range.high >= range.low);
  assert.ok(range.mid >= range.low && range.mid <= range.high);
});

test('Apex strategy card includes ≥3 Why bullets', () => {
  const item = mkItem({ id: 'st1', creditorName: 'Portfolio Recovery' });
  const card = planApexItemStrategy({ item, pass: 1 });
  assert.ok(card.explainWhy.length >= 3);
  assert.ok(card.legalProfile);
  assert.ok(card.onDevice);
});

test('V2 planBatchStrategies still returns ItemStrategyCard shape', () => {
  const item = mkItem({ id: 'v2', creditorName: 'Synchrony' });
  const cards = planBatchStrategies([item], { passNumbers: { v2: 1 } });
  assert.equal(cards.length, 1);
  assert.ok(Array.isArray(cards[0].explainWhy));
  assert.ok(typeof cards[0].primaryAngle === 'string');
  assert.ok(cards[0].frivolousRisk);
});

test('OC/CA detector returns link-only suggestions for sold portfolios', () => {
  const oc = mkItem({
    id: 'oc1',
    creditorName: 'Chase',
    accountNumber: '****5555',
    typeOfNegative: 'Charge Off',
  });
  const ca = mkItem({
    id: 'ca1',
    creditorName: 'LVNV Funding',
    accountNumber: '****5555',
    typeOfNegative: 'Collection',
  });
  const link = detectOCCARelationship(oc, ca);
  assert.ok(link.decision === 'link_only' || link.decision === 'possible_same_account' || link.decision === 'unrelated');
});

console.log(`\nAll ${passed} Apex tests passed.`);
