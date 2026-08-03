# Patches for phase2-tests.ts (24)

## Patch 1 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (920)
```
test('a terminal (deleted) campaign produces no further letters', () => {
  const eq = [mkItem({ id: 't_eq', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 9000, status: 'Late Payment' })];
  const ctx = {
    consumerName: 'Jane Q. Consumer',
    todayDate: '2026-06-27',
    detectMetro2Violations: stubDetector({}),
  };
  const first = planTradelineCampaign(eq, [], [], ctx);
  const tlId = first.plans[0].tradeline.id;
  const second = planTradelineCampaign(eq, [], [], {
    ...ctx,
    machineStates: first.machineStates,
    outcomesSinceLastRun: { [tlId]: 'deleted' },
  });
  assert.equal(second.plans[0].dispatches.length, 0);
  assert.equal(second.summary.totalLetters, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```
### NEW (3345)
```
test('a terminal (deleted) campaign produces no further letters', () => {
  const eq = [mkItem({ id: 't_eq', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 9000, status: 'Late Payment' })];
  const ctx = {
    consumerName: 'Jane Q. Consumer',
    todayDate: '2026-06-27',
    detectMetro2Violations: stubDetector({}),
  };
  const first = planTradelineCampaign(eq, [], [], ctx);
  const tlId = first.plans[0].tradeline.id;
  const second = planTradelineCampaign(eq, [], [], {
    ...ctx,
    machineStates: first.machineStates,
    outcomesSinceLastRun: { [tlId]: 'deleted' },
  });
  assert.equal(second.plans[0].dispatches.length, 0);
  assert.equal(second.summary.totalLetters, 0);
});

// ─── UnifiedTradelineResolver (v5.1) ─────────────────────────────────────────

import {
  resolveAllTradelines,
  scoreTradelinePair,
  applySmartMerge,
} from '../src/services/unifiedTradelineResolver';
import { mergeAccountNumbers } from '../src/services/accountMergeEngine';

group('UnifiedTradelineResolver');

test('reconstructs account digits from EQ ****4821 + TU 5512****4821', () => {
  const merged = mergeAccountNumbers([
    { bureau: 'Equifax', rawAccountNumber: '****4821', creditorName: 'Cap One', balance: 500, accountType: 'Revolving' },
    { bureau: 'TransUnion', rawAccountNumber: '5512****4821', creditorName: 'Cap One', balance: 500, accountType: 'Revolving' },
  ]);
  assert.ok(merged.includes('4821'), `expected suffix 4821 in ${merged}`);
  assert.ok(merged.startsWith('5512') || merged.includes('5512'), `expected prefix 5512 in ${merged}`);
});

test('scoreTradelinePair rejects same-bureau pairs', () => {
  const a = mkItem({ creditBureau: ['Equifax'], creditorName: 'Chase', balance: 100, accountNumber: '****1234' });
  const b = mkItem({ creditBureau: ['Equifax'], creditorName: 'Chase', balance: 100, accountNumber: '****1234' });
  const score = scoreTradelinePair(a, b);
  assert.equal(score.band, 'reject');
});

test('applySmartMerge links EQ+EX without collapsing rows', () => {
  const items = [
    mkItem({ id: 'm1', creditorName: 'Capital One', creditBureau: ['Equifax'], balance: 400, accountNumber: '****9999', dateOpened: '2020-01-15' }),
    mkItem({ id: 'm2', creditorName: 'CAPITAL ONE NA', creditBureau: ['Experian'], balance: 402, accountNumber: 'XXXX9999', dateOpened: '2020-01-15' }),
  ];
  const linked = applySmartMerge(items);
  assert.equal(linked.length, 2, 'must keep both bureau rows');
  assert.ok(linked[0].crossBureauGroupId);
  assert.equal(linked[0].crossBureauGroupId, linked[1].crossBureauGroupId);
});

test('resolveAllTradelines reports cross-bureau merges', () => {
  const items = [
    mkItem({ id: 'r1', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 1200, accountNumber: '****4444', dateOpened: '2019-06-01' }),
    mkItem({ id: 'r2', creditorName: 'Chase Bank', creditBureau: ['TransUnion'], balance: 1200, accountNumber: '9988****4444', dateOpened: '2019-06-01' }),
  ];
  const result = resolveAllTradelines(items);
  assert.ok(result.autoMergedGroups + result.reviewGroups >= 1);
  assert.equal(result.linkedItems.length, 2);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

## Patch 2 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (87)
```
import { planTradelineCampaign } from '../src/services/tradelineAutoPilotOrchestrator';
```
### NEW (286)
```
import { planTradelineCampaign } from '../src/services/tradelineAutoPilotOrchestrator';
import {
  resolveAllTradelines,
  scoreTradelinePair,
  applySmartMerge,
} from '../src/services/unifiedTradelineResolver';
import { mergeAccountNumbers } from '../src/services/accountMergeEngine';
```

## Patch 3 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (2506)
```
// ─── UnifiedTradelineResolver (v5.1) ─────────────────────────────────────────

import {
  resolveAllTradelines,
  scoreTradelinePair,
  applySmartMerge,
} from '../src/services/unifiedTradelineResolver';
import { mergeAccountNumbers } from '../src/services/accountMergeEngine';

group('UnifiedTradelineResolver');

test('reconstructs account digits from EQ ****4821 + TU 5512****4821', () => {
  const merged = mergeAccountNumbers([
    { bureau: 'Equifax', rawAccountNumber: '****4821', creditorName: 'Cap One', balance: 500, accountType: 'Revolving' },
    { bureau: 'TransUnion', rawAccountNumber: '5512****4821', creditorName: 'Cap One', balance: 500, accountType: 'Revolving' },
  ]);
  assert.ok(merged.includes('4821'), `expected suffix 4821 in ${merged}`);
  assert.ok(merged.startsWith('5512') || merged.includes('5512'), `expected prefix 5512 in ${merged}`);
});

test('scoreTradelinePair rejects same-bureau pairs', () => {
  const a = mkItem({ creditBureau: ['Equifax'], creditorName: 'Chase', balance: 100, accountNumber: '****1234' });
  const b = mkItem({ creditBureau: ['Equifax'], creditorName: 'Chase', balance: 100, accountNumber: '****1234' });
  const score = scoreTradelinePair(a, b);
  assert.equal(score.band, 'reject');
});

test('applySmartMerge links EQ+EX without collapsing rows', () => {
  const items = [
    mkItem({ id: 'm1', creditorName: 'Capital One', creditBureau: ['Equifax'], balance: 400, accountNumber: '****9999', dateOpened: '2020-01-15' }),
    mkItem({ id: 'm2', creditorName: 'CAPITAL ONE NA', creditBureau: ['Experian'], balance: 402, accountNumber: 'XXXX9999', dateOpened: '2020-01-15' }),
  ];
  const linked = applySmartMerge(items);
  assert.equal(linked.length, 2, 'must keep both bureau rows');
  assert.ok(linked[0].crossBureauGroupId);
  assert.equal(linked[0].crossBureauGroupId, linked[1].crossBureauGroupId);
});

test('resolveAllTradelines reports cross-bureau merges', () => {
  const items = [
    mkItem({ id: 'r1', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 1200, accountNumber: '****4444', dateOpened: '2019-06-01' }),
    mkItem({ id: 'r2', creditorName: 'Chase Bank', creditBureau: ['TransUnion'], balance: 1200, accountNumber: '9988****4444', dateOpened: '2019-06-01' }),
  ];
  const result = resolveAllTradelines(items);
  assert.ok(result.autoMergedGroups + result.reviewGroups >= 1);
  assert.equal(result.linkedItems.length, 2);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```
### NEW (2306)
```
// ─── UnifiedTradelineResolver (v5.1) ─────────────────────────────────────────

group('UnifiedTradelineResolver');

test('reconstructs account digits from EQ ****4821 + TU 5512****4821', () => {
  const merged = mergeAccountNumbers([
    { bureau: 'Equifax', rawAccountNumber: '****4821', creditorName: 'Cap One', balance: 500, accountType: 'Revolving' },
    { bureau: 'TransUnion', rawAccountNumber: '5512****4821', creditorName: 'Cap One', balance: 500, accountType: 'Revolving' },
  ]);
  assert.ok(merged.includes('4821'), `expected suffix 4821 in ${merged}`);
  assert.ok(merged.startsWith('5512') || merged.includes('5512'), `expected prefix 5512 in ${merged}`);
});

test('scoreTradelinePair rejects same-bureau pairs', () => {
  const a = mkItem({ creditBureau: ['Equifax'], creditorName: 'Chase', balance: 100, accountNumber: '****1234' });
  const b = mkItem({ creditBureau: ['Equifax'], creditorName: 'Chase', balance: 100, accountNumber: '****1234' });
  const score = scoreTradelinePair(a, b);
  assert.equal(score.band, 'reject');
});

test('applySmartMerge links EQ+EX without collapsing rows', () => {
  const items = [
    mkItem({ id: 'm1', creditorName: 'Capital One', creditBureau: ['Equifax'], balance: 400, accountNumber: '****9999', dateOpened: '2020-01-15' }),
    mkItem({ id: 'm2', creditorName: 'CAPITAL ONE NA', creditBureau: ['Experian'], balance: 402, accountNumber: 'XXXX9999', dateOpened: '2020-01-15' }),
  ];
  const linked = applySmartMerge(items);
  assert.equal(linked.length, 2, 'must keep both bureau rows');
  assert.ok(linked[0].crossBureauGroupId);
  assert.equal(linked[0].crossBureauGroupId, linked[1].crossBureauGroupId);
});

test('resolveAllTradelines reports cross-bureau merges', () => {
  const items = [
    mkItem({ id: 'r1', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 1200, accountNumber: '****4444', dateOpened: '2019-06-01' }),
    mkItem({ id: 'r2', creditorName: 'Chase Bank', creditBureau: ['TransUnion'], balance: 1200, accountNumber: '9988****4444', dateOpened: '2019-06-01' }),
  ];
  const result = resolveAllTradelines(items);
  assert.ok(result.autoMergedGroups + result.reviewGroups >= 1);
  assert.equal(result.linkedItems.length, 2);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```

## Patch 4 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (156)
```
import { mergeAccountNumbers } from '../src/services/accountMergeEngine';

// ─── Tiny harness ─────────────────────────────────────────────────────────────
```
### NEW (699)
```
import { mergeAccountNumbers } from '../src/services/accountMergeEngine';
import { preprocessBureauText } from '../src/services/creditReportParser/bureauNormalizers/bureauTextPreprocessor';
import { normalizeEquifaxText } from '../src/services/creditReportParser/bureauNormalizers/equifaxNormalizer';
import { normalizeExperianText } from '../src/services/creditReportParser/bureauNormalizers/experianNormalizer';
import { normalizeTransUnionText } from '../src/services/creditReportParser/bureauNormalizers/transunionNormalizer';
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';

// ─── Tiny harness ─────────────────────────────────────────────────────────────
```

## Patch 5 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (631)
```
test('resolveAllTradelines reports cross-bureau merges', () => {
  const items = [
    mkItem({ id: 'r1', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 1200, accountNumber: '****4444', dateOpened: '2019-06-01' }),
    mkItem({ id: 'r2', creditorName: 'Chase Bank', creditBureau: ['TransUnion'], balance: 1200, accountNumber: '9988****4444', dateOpened: '2019-06-01' }),
  ];
  const result = resolveAllTradelines(items);
  assert.ok(result.autoMergedGroups + result.reviewGroups >= 1);
  assert.equal(result.linkedItems.length, 2);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```
### NEW (3013)
```
test('resolveAllTradelines reports cross-bureau merges', () => {
  const items = [
    mkItem({ id: 'r1', creditorName: 'Chase', creditBureau: ['Equifax'], balance: 1200, accountNumber: '****4444', dateOpened: '2019-06-01' }),
    mkItem({ id: 'r2', creditorName: 'Chase Bank', creditBureau: ['TransUnion'], balance: 1200, accountNumber: '9988****4444', dateOpened: '2019-06-01' }),
  ];
  const result = resolveAllTradelines(items);
  assert.ok(result.autoMergedGroups + result.reviewGroups >= 1);
  assert.equal(result.linkedItems.length, 2);
});

// ─── Golden parser markers (Testparser parity) ───────────────────────────────

group('Golden parser — section markers survive preprocess');

test('normalizers preserve Experian POTENTIALLY NEGATIVE marker', () => {
  const raw = 'MIDLAND CREDIT\nPOTENTIALLY NEGATIVE\nAccount Number: ****1234\nStatus: Collection\nBalance: $500';
  assert.match(normalizeEquifaxText(raw), /POTENTIALLY NEGATIVE/i);
  assert.match(normalizeExperianText(raw), /POTENTIALLY NEGATIVE/i);
  assert.match(preprocessBureauText(raw, 'Unknown').text, /POTENTIALLY NEGATIVE/i);
  assert.match(preprocessBureauText(raw, 'Equifax').text, /POTENTIALLY NEGATIVE/i);
});

test('normalizers preserve TransUnion adverse information marker', () => {
  const raw =
    'Accounts with adverse information\nCAPITAL ONE ****9999\nAccount Information\nStatus: Charge Off\nBalance: $1,200';
  assert.match(normalizeTransUnionText(raw), /accounts with adverse information/i);
  assert.match(normalizeEquifaxText(raw), /accounts with adverse information/i);
  assert.match(preprocessBureauText(raw, 'Unknown').text, /accounts with adverse information/i);
  assert.match(preprocessBureauText(raw, 'TransUnion').text, /accounts with adverse information/i);
});

test('goldenParser finds Experian section after preprocess', () => {
  const raw = [
    'Experian Credit Report',
    'MIDLAND FUNDING LLC',
    'POTENTIALLY NEGATIVE',
    'Account Number: ****4321',
    'Status: Collection',
    'Balance: $850',
    'Date Opened: 01/2020',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'Unknown');
  const items = parseNegativeItems([{ sourceName: 'fixture', text }]);
  assert.ok(items.length >= 1, `expected ≥1 item, got ${items.length}`);
  assert.match(items[0].creditor, /MIDLAND/i);
});

test('goldenParser finds TransUnion adverse section after preprocess', () => {
  const raw = [
    'TransUnion',
    'Accounts with adverse information',
    'CAPITAL ONE BANK USA NA 5178****1234',
    'Account Information',
    'Pay Status: Charge Off',
    'Balance Owed: $2,400',
    'Date Opened: 03/2019',
    'Satisfactory Accounts',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'TransUnion');
  const items = parseNegativeItems([{ sourceName: 'fixture', text }]);
  assert.ok(items.length >= 1, `expected ≥1 item, got ${items.length}`);
  assert.match(items[0].creditor, /CAPITAL ONE/i);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```

## Patch 6 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (542)
```
import { preprocessBureauText } from '../src/services/creditReportParser/bureauNormalizers/bureauTextPreprocessor';
import { normalizeEquifaxText } from '../src/services/creditReportParser/bureauNormalizers/equifaxNormalizer';
import { normalizeExperianText } from '../src/services/creditReportParser/bureauNormalizers/experianNormalizer';
import { normalizeTransUnionText } from '../src/services/creditReportParser/bureauNormalizers/transunionNormalizer';
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
```
### NEW (1062)
```
import { preprocessBureauText } from '../src/services/creditReportParser/bureauNormalizers/bureauTextPreprocessor';
import { normalizeEquifaxText } from '../src/services/creditReportParser/bureauNormalizers/equifaxNormalizer';
import { normalizeExperianText } from '../src/services/creditReportParser/bureauNormalizers/experianNormalizer';
import { normalizeTransUnionText } from '../src/services/creditReportParser/bureauNormalizers/transunionNormalizer';
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { acquireFromPaste } from '../src/services/creditReportParser/textAcquisition';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
import { extractConsumerInfo } from '../src/services/creditReportParser/personalInfoExtractor';
import { heuristicParse } from '../src/services/creditReportParser/heuristicParser';
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AIEnhancedAccount } from '../src/services/creditReportParser/types';
```

## Patch 7 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (697)
```
test('goldenParser finds TransUnion adverse section after preprocess', () => {
  const raw = [
    'TransUnion',
    'Accounts with adverse information',
    'CAPITAL ONE BANK USA NA 5178****1234',
    'Account Information',
    'Pay Status: Charge Off',
    'Balance Owed: $2,400',
    'Date Opened: 03/2019',
    'Satisfactory Accounts',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'TransUnion');
  const items = parseNegativeItems([{ sourceName: 'fixture', text }]);
  assert.ok(items.length >= 1, `expected ≥1 item, got ${items.length}`);
  assert.match(items[0].creditor, /CAPITAL ONE/i);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```
### NEW (2394)
```
test('goldenParser finds TransUnion adverse section after preprocess', () => {
  const raw = [
    'TransUnion',
    'Accounts with adverse information',
    'CAPITAL ONE BANK USA NA 5178****1234',
    'Account Information',
    'Pay Status: Charge Off',
    'Balance Owed: $2,400',
    'Date Opened: 03/2019',
    'Satisfactory Accounts',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'TransUnion');
  const items = parseNegativeItems([{ sourceName: 'fixture', text }]);
  assert.ok(items.length >= 1, `expected ≥1 item, got ${items.length}`);
  assert.match(items[0].creditor, /CAPITAL ONE/i);
});

group('parser.md pipeline — heuristic + postValidator');

test('heuristicParse + validateAndEnrich extracts Experian labeled negative', async () => {
  const raw = [
    'Experian Credit Report',
    'Name: JANE DOE',
    'POTENTIALLY NEGATIVE',
    'Account Name MIDLAND FUNDING LLC',
    'Account Number ****4321',
    'Account Status Collection',
    'Balance $850',
    'Date Opened 01/2020',
    'Date of First Delinquency 03/2020',
  ].join('\n');

  const acquired = await acquireFromPaste(raw);
  const normalized = normalizeText(acquired);
  const consumer = extractConsumerInfo(normalized.fullText);
  const heuristic = heuristicParse(normalized, consumer);
  assert.ok(heuristic.accounts.length >= 1, `heuristic expected ≥1, got ${heuristic.accounts.length}`);

  const aiShape: AIEnhancedAccount[] = heuristic.accounts.map((h) => ({
    accountName: h.accountName,
    accountNumber: h.accountNumber ?? null,
    balance: h.balance ?? null,
    creditLimit: null,
    monthlyPayment: null,
    dateOpened: h.dateOpened ?? null,
    dateClosed: null,
    dateReported: null,
    dateOfFirstDelinquency: h.dateOfFirstDelinquency ?? null,
    dateLastActive: null,
    status: h.status ?? 'Collection',
    itemType: h.type ?? 'Collection',
    creditorName: h.accountName,
    originalCreditor: null,
    bureaus: h.bureaus.length ? h.bureaus : ['Experian'],
    paymentHistory: null,
    remarks: null,
    aiConfidence: h.confidence,
    needsUserReview: true,
  }));

  const { items } = validateAndEnrich(aiShape, { defaultBureaus: ['Experian'] });
  assert.ok(items.length >= 1, `validated expected ≥1, got ${items.length}`);
  assert.match(items[0].creditorName, /MIDLAND/i);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```

## Patch 8 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (1062)
```
import { preprocessBureauText } from '../src/services/creditReportParser/bureauNormalizers/bureauTextPreprocessor';
import { normalizeEquifaxText } from '../src/services/creditReportParser/bureauNormalizers/equifaxNormalizer';
import { normalizeExperianText } from '../src/services/creditReportParser/bureauNormalizers/experianNormalizer';
import { normalizeTransUnionText } from '../src/services/creditReportParser/bureauNormalizers/transunionNormalizer';
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { acquireFromPaste } from '../src/services/creditReportParser/textAcquisition';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
import { extractConsumerInfo } from '../src/services/creditReportParser/personalInfoExtractor';
import { heuristicParse } from '../src/services/creditReportParser/heuristicParser';
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AIEnhancedAccount } from '../src/services/creditReportParser/types';
```
### NEW (989)
```
import { preprocessBureauText } from '../src/services/creditReportParser/bureauNormalizers/bureauTextPreprocessor';
import { normalizeEquifaxText } from '../src/services/creditReportParser/bureauNormalizers/equifaxNormalizer';
import { normalizeExperianText } from '../src/services/creditReportParser/bureauNormalizers/experianNormalizer';
import { normalizeTransUnionText } from '../src/services/creditReportParser/bureauNormalizers/transunionNormalizer';
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
import { extractConsumerInfo } from '../src/services/creditReportParser/personalInfoExtractor';
import { heuristicParse } from '../src/services/creditReportParser/heuristicParser';
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';
```

## Patch 9 from 61a88268-6764-4544-98a8-695204df84b9.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (1637)
```
test('heuristicParse + validateAndEnrich extracts Experian labeled negative', async () => {
  const raw = [
    'Experian Credit Report',
    'Name: JANE DOE',
    'POTENTIALLY NEGATIVE',
    'Account Name MIDLAND FUNDING LLC',
    'Account Number ****4321',
    'Account Status Collection',
    'Balance $850',
    'Date Opened 01/2020',
    'Date of First Delinquency 03/2020',
  ].join('\n');

  const acquired = await acquireFromPaste(raw);
  const normalized = normalizeText(acquired);
  const consumer = extractConsumerInfo(normalized.fullText);
  const heuristic = heuristicParse(normalized, consumer);
  assert.ok(heuristic.accounts.length >= 1, `heuristic expected ≥1, got ${heuristic.accounts.length}`);

  const aiShape: AIEnhancedAccount[] = heuristic.accounts.map((h) => ({
    accountName: h.accountName,
    accountNumber: h.accountNumber ?? null,
    balance: h.balance ?? null,
    creditLimit: null,
    monthlyPayment: null,
    dateOpened: h.dateOpened ?? null,
    dateClosed: null,
    dateReported: null,
    dateOfFirstDelinquency: h.dateOfFirstDelinquency ?? null,
    dateLastActive: null,
    status: h.status ?? 'Collection',
    itemType: h.type ?? 'Collection',
    creditorName: h.accountName,
    originalCreditor: null,
    bureaus: h.bureaus.length ? h.bureaus : ['Experian'],
    paymentHistory: null,
    remarks: null,
    aiConfidence: h.confidence,
    needsUserReview: true,
  }));

  const { items } = validateAndEnrich(aiShape, { defaultBureaus: ['Experian'] });
  assert.ok(items.length >= 1, `validated expected ≥1, got ${items.length}`);
  assert.match(items[0].creditorName, /MIDLAND/i);
});
```
### NEW (1720)
```
test('heuristicParse + validateAndEnrich extracts Experian labeled negative', () => {
  const raw = [
    'Experian Credit Report',
    'Name: JANE DOE',
    'POTENTIALLY NEGATIVE',
    'Account Name MIDLAND FUNDING LLC',
    'Account Number ****4321',
    'Account Status Collection',
    'Balance $850',
    'Date Opened 01/2020',
    'Date of First Delinquency 03/2020',
  ].join('\n');

  const acquired: AcquiredText = {
    source: 'paste',
    rawPages: [raw],
    fullText: raw,
    pageCount: 1,
    warnings: [],
  };
  const normalized = normalizeText(acquired);
  const consumer = extractConsumerInfo(normalized.fullText);
  const heuristic = heuristicParse(normalized, consumer);
  assert.ok(heuristic.accounts.length >= 1, `heuristic expected ≥1, got ${heuristic.accounts.length}`);

  const aiShape: AIEnhancedAccount[] = heuristic.accounts.map((h) => ({
    accountName: h.accountName,
    accountNumber: h.accountNumber ?? null,
    balance: h.balance ?? null,
    creditLimit: null,
    monthlyPayment: null,
    dateOpened: h.dateOpened ?? null,
    dateClosed: null,
    dateReported: null,
    dateOfFirstDelinquency: h.dateOfFirstDelinquency ?? null,
    dateLastActive: null,
    status: h.status ?? 'Collection',
    itemType: h.type ?? 'Collection',
    creditorName: h.accountName,
    originalCreditor: null,
    bureaus: h.bureaus.length ? h.bureaus : ['Experian'],
    paymentHistory: null,
    remarks: null,
    aiConfidence: h.confidence,
    needsUserReview: true,
  }));

  const { items } = validateAndEnrich(aiShape, { defaultBureaus: ['Experian'] });
  assert.ok(items.length >= 1, `validated expected ≥1, got ${items.length}`);
  assert.match(items[0].creditorName, /MIDLAND/i);
});
```

## Patch 10 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (86)
```
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';
```
### NEW (518)
```
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';
import {
  classifyOnDeviceSync,
  classifyOnDevice,
} from '../src/services/onDeviceClassifier';
import {
  draftConsumerStatement,
  validateConsumerStatement,
  enforceWordLimit,
  CONSUMER_STATEMENT_WORD_LIMIT,
} from '../src/services/consumerStatementEngine';
import { evaluateGoodwillEligibility, goodwillLetterGuard } from '../src/services/goodwillCampaignEngine';
import { FEATURE_FLAGS } from '../src/config/featureFlags';
```

## Patch 11 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (738)
```
test('AIG builds link groups for OC+CA without auto-merge edge', () => {
  const oc = mkItem({
    id: 'g_oc',
    creditorName: 'Capital One',
    typeOfNegative: 'Charge-off',
    balance: 800,
    dateOfFirstDelinquency: '2019-01-01',
    creditBureau: ['TransUnion'],
  });
  const ca = mkItem({
    id: 'g_ca',
    creditorName: 'LVNV Funding',
    typeOfNegative: 'Collection',
    balance: 850,
    dateOpened: '2020-01-01',
    creditBureau: ['Equifax'],
  });
  const graph = buildAccountIdentityGraph([oc, ca]);
  assert.ok(graph.linkGroups.some((g) => g.includes('g_oc') && g.includes('g_ca')));
  assert.equal(graph.mergeGroups.length, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```
### NEW (3081)
```
test('AIG builds link groups for OC+CA without auto-merge edge', () => {
  const oc = mkItem({
    id: 'g_oc',
    creditorName: 'Capital One',
    typeOfNegative: 'Charge-off',
    balance: 800,
    dateOfFirstDelinquency: '2019-01-01',
    creditBureau: ['TransUnion'],
  });
  const ca = mkItem({
    id: 'g_ca',
    creditorName: 'LVNV Funding',
    typeOfNegative: 'Collection',
    balance: 850,
    dateOpened: '2020-01-01',
    creditBureau: ['Equifax'],
  });
  const graph = buildAccountIdentityGraph([oc, ca]);
  assert.ok(graph.linkGroups.some((g) => g.includes('g_oc') && g.includes('g_ca')));
  assert.equal(graph.mergeGroups.length, 0);
});

group('Apex 5.5 — Wave 3–5 polish');

test('on-device classifier uses heuristic engine by default', () => {
  assert.equal(FEATURE_FLAGS.ON_DEVICE_TRANSFORMERS_JS, false);
  const item = mkItem({ typeOfNegative: 'Collection', creditorName: 'Midland Credit' });
  const result = classifyOnDeviceSync(item, { pass: 1 });
  assert.equal(result.engine, 'heuristic');
  assert.equal(result.accountClass, 'collections');
  assert.ok(result.disputeAngleScore >= 0 && result.disputeAngleScore <= 1);
});

test('on-device async path stays build-safe without Transformers.js', async () => {
  const item = mkItem({ typeOfNegative: 'Hard Inquiry', dateOpened: '2020-01-01' });
  const result = await classifyOnDevice(item);
  assert.ok(result.engine === 'heuristic' || result.engine === 'stub');
  assert.equal(result.accountClass, 'hard_inquiry');
});

test('consumer statement enforces 100-word limit and validates', () => {
  const item = mkItem({
    creditorName: 'Chase',
    accountNumber: '****4321',
    disputeStatus: 'Round5-Verified',
    verificationCount: 3,
  });
  const draft = draftConsumerStatement(item);
  assert.ok(draft.withinLimit);
  assert.ok(draft.wordCount <= CONSUMER_STATEMENT_WORD_LIMIT);
  const padded = enforceWordLimit(Array.from({ length: 120 }, () => 'word').join(' '));
  assert.equal(padded.split(/\s+/).length, CONSUMER_STATEMENT_WORD_LIMIT);
  const bad = validateConsumerStatement('As an attorney I demand deletion of everything forever.');
  assert.equal(bad.ok, false);
});

test('goodwill guard rejects FCRA demand language', () => {
  const item = mkItem({
    status: 'Paid in full',
    typeOfNegative: 'Late payment',
    paymentHistory: '1×30d',
    forceStrategy: 'goodwill',
  });
  const gw = evaluateGoodwillEligibility(item);
  assert.equal(gw.eligible, true);
  const guard = goodwillLetterGuard('I demand deletion under FCRA §611 reinvestigation.');
  assert.equal(guard.ok, false);
});

test('strategy card includes on-device classification', () => {
  const item = mkItem({
    creditorName: 'Portfolio Recovery',
    typeOfNegative: 'Collection',
    dateOfFirstDelinquency: '2019-05-01',
  });
  const card = planItemStrategy({ item, pass: 1, personalInfo: { state: 'CA', ssn: '', address: '', city: '' } });
  assert.ok(card.onDevice);
  assert.equal(card.onDevice.engine, 'heuristic');
});

// ─── Summary ──────────────────────────────────────────────────────────────────
```

## Patch 12 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (97)
```
import {
  classifyOnDeviceSync,
  classifyOnDevice,
} from '../src/services/onDeviceClassifier';
```
### NEW (74)
```
import { classifyOnDeviceSync } from '../src/services/onDeviceClassifier';
```

## Patch 13 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (418)
```
test('on-device async path stays build-safe without Transformers.js', async () => {
  const item = mkItem({ typeOfNegative: 'Hard Inquiry', dateOpened: '2020-01-01' });
  const result = await classifyOnDevice(item);
  assert.ok(result.engine === 'heuristic' || result.engine === 'stub');
  assert.equal(result.accountClass, 'hard_inquiry');
});

test('consumer statement enforces 100-word limit and validates', () => {
```
### NEW (367)
```
test('on-device classifies hard inquiries separately', () => {
  const item = mkItem({ typeOfNegative: 'Hard Inquiry', dateOpened: '2020-01-01' });
  const result = classifyOnDeviceSync(item);
  assert.equal(result.engine, 'heuristic');
  assert.equal(result.accountClass, 'hard_inquiry');
});

test('consumer statement enforces 100-word limit and validates', () => {
```

## Patch 14 from d7a7b6e5-a403-4fea-971b-1f6af0aba8e6.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (614)
```
test('goldenParser finds TransUnion adverse section after preprocess', () => {
  const raw = [
    'TransUnion',
    'Accounts with adverse information',
    'CAPITAL ONE BANK USA NA 5178****1234',
    'Account Information',
    'Pay Status: Charge Off',
    'Balance Owed: $2,400',
    'Date Opened: 03/2019',
    'Satisfactory Accounts',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'TransUnion');
  const items = parseNegativeItems([{ sourceName: 'fixture', text }]);
  assert.ok(items.length >= 1, `expected ≥1 item, got ${items.length}`);
  assert.match(items[0].creditor, /CAPITAL ONE/i);
});
```
### NEW (2605)
```
test('goldenParser finds TransUnion adverse section after preprocess', () => {
  const raw = [
    'TransUnion',
    'Accounts with adverse information',
    'CAPITAL ONE BANK USA NA 5178****1234',
    'Account Information',
    'Pay Status: Charge Off',
    'Balance Owed: $2,400',
    'Date Opened: 03/2019',
    'Satisfactory Accounts',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'TransUnion');
  const items = parseNegativeItems([{ sourceName: 'fixture', text }]);
  assert.ok(items.length >= 1, `expected ≥1 item, got ${items.length}`);
  assert.match(items[0].creditor, /CAPITAL ONE/i);
});

test('goldenParser recovers TU adverse past-due that ACR subset would miss', () => {
  const raw = [
    'TransUnion Interactive',
    'Accounts with adverse information',
    'MIDLAND FUNDING LLC 4412****8899',
    'Account Information',
    'Pay Status >Past Due<',
    'Balance $640',
    'Date Opened 01/2018',
    'LVNV FUNDING LLC 9981****2211',
    'Account Information',
    'Pay Status >Charge Off<',
    'Balance $1,100',
    'Date Opened 06/2019',
    'Satisfactory Accounts',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'TransUnion');
  const items = parseNegativeItems([{ sourceName: 'tu-adverse', text }]);
  assert.ok(items.length >= 2, `expected ≥2 TU adverse items, got ${items.length}`);
  const names = items.map((i) => i.creditor.toUpperCase()).join(' | ');
  assert.match(names, /MIDLAND/);
  assert.match(names, /LVNV/);
});

test('goldenParser extracts Equifax angle-bracket Charge-Off', () => {
  const raw = [
    'Equifax Credit Report',
    'Credit Accounts',
    'Account Name: PORTFOLIO RECOVERY ASSOC',
    'Account Number: ****5566',
    'Loan/Account Type: Collection | Status: >Charge-Off<',
    'Date Reported: 01/2024 | Balance: $925',
    'Date Opened: 04/2019',
    'Amount Past Due: $925',
    'Narrative Code(s): 067',
  ].join('\n');
  const { text } = preprocessBureauText(raw, 'Equifax');
  assert.match(text, />Charge-Off</i);
  const items = parseNegativeItems([{ sourceName: 'eq-angle', text }]);
  assert.ok(items.length >= 1, `expected ≥1 Equifax item, got ${items.length}`);
  assert.match(items[0].creditor, /PORTFOLIO/i);
  assert.match(items[0].status, /charge/i);
});

test('preprocessTransUnionText does not strip Equifax angle brackets', async () => {
  const { preprocessTransUnionText } = await import(
    '../src/services/creditReportParser/index.ts'
  );
  const raw = 'Account Name: ACME\nStatus: >Charge-Off<\nBalance: $100';
  const out = preprocessTransUnionText(raw);
  assert.match(out, />Charge-Off</);
});
```

## Patch 15 from d7a7b6e5-a403-4fea-971b-1f6af0aba8e6.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (532)
```
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
import { extractConsumerInfo } from '../src/services/creditReportParser/personalInfoExtractor';
import { heuristicParse } from '../src/services/creditReportParser/heuristicParser';
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';
```
### NEW (617)
```
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { preprocessTransUnionText } from '../src/services/creditReportParser/index';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
import { extractConsumerInfo } from '../src/services/creditReportParser/personalInfoExtractor';
import { heuristicParse } from '../src/services/creditReportParser/heuristicParser';
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';
```

## Patch 16 from d7a7b6e5-a403-4fea-971b-1f6af0aba8e6.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (351)
```
test('preprocessTransUnionText does not strip Equifax angle brackets', async () => {
  const { preprocessTransUnionText } = await import(
    '../src/services/creditReportParser/index.ts'
  );
  const raw = 'Account Name: ACME\nStatus: >Charge-Off<\nBalance: $100';
  const out = preprocessTransUnionText(raw);
  assert.match(out, />Charge-Off</);
});
```
### NEW (237)
```
test('preprocessTransUnionText does not strip Equifax angle brackets', () => {
  const raw = 'Account Name: ACME\nStatus: >Charge-Off<\nBalance: $100';
  const out = preprocessTransUnionText(raw);
  assert.match(out, />Charge-Off</);
});
```

## Patch 17 from d7a7b6e5-a403-4fea-971b-1f6af0aba8e6.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (253)
```
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { preprocessTransUnionText } from '../src/services/creditReportParser/index';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
```
### NEW (280)
```
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseNegativeItems } from '../src/services/creditReportParser/goldenParser';
import { normalizeText } from '../src/services/creditReportParser/textNormalizer';
```

## Patch 18 from d7a7b6e5-a403-4fea-971b-1f6af0aba8e6.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (237)
```
test('preprocessTransUnionText does not strip Equifax angle brackets', () => {
  const raw = 'Account Name: ACME\nStatus: >Charge-Off<\nBalance: $100';
  const out = preprocessTransUnionText(raw);
  assert.match(out, />Charge-Off</);
});
```
### NEW (484)
```
test('preprocessTransUnionText source must not strip angle brackets', () => {
  const indexPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../src/services/creditReportParser/index.ts'
  );
  const src = readFileSync(indexPath, 'utf8');
  assert.match(src, /NEVER strip <>/);
  assert.equal(
    /preprocessTransUnionText[\s\S]*?replace\(\s*\/\[<>\]/m.test(src),
    false,
    'preprocessTransUnionText must not strip <> (kills Equifax >Charge-Off<)'
  );
});
```

## Patch 19 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (274)
```
  assert.match(items[0].creditorName, /MIDLAND/i);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

```
### NEW (5156)
```
  assert.match(items[0].creditorName, /MIDLAND/i);
});

// ─── Apex 6.0 cores ───────────────────────────────────────────────────────────

group('Apex — Legal Intelligence + Debt Type');
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategyForItem } from '../src/services/debtTypeStrategyLibrary';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import { creditorsAreAliasMatch } from '../src/data/creditorAliasMatrix';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { simulateRemovals } from '../src/services/scoreImpactSimulator';
import { buildAccountIdentityGraph } from '../src/services/accountIdentityGraph';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';

test('classifies collection debt type and SOL/FCRA anchors', () => {
  const item = mkItem({
    creditorName: 'Portfolio Recovery',
    typeOfNegative: 'Collection',
    dateOfFirstDelinquency: '2015-01-15',
    balance: 400,
  });
  assert.equal(classifyDebtType(item), 'collections');
  const profile = buildLegalProfile(item, { state: 'TX' });
  assert.equal(profile.fdcpa809Applicable, true);
  assert.ok(profile.availableAnchors.some((a) => a.id === 'fcra_611'));
  assert.ok(profile.obsoletionDisputable || profile.creditClockExpired);
});

test('creditor alias matrix matches CAP1 ↔ Capital One', () => {
  assert.equal(creditorsAreAliasMatch('CAP1', 'Capital One Bank'), true);
});

test('OC+CA detector returns link_only for charge-off + PRA', () => {
  const oc = mkItem({
    id: 'oc1',
    creditorName: 'Chase',
    typeOfNegative: 'Charge-off',
    accountStatus: '93',
    balance: 1200,
    dateOfFirstDelinquency: '2020-03-01',
    creditBureau: ['Equifax'],
  });
  const ca = mkItem({
    id: 'ca1',
    creditorName: 'Portfolio Recovery Associates',
    typeOfNegative: 'Collection',
    balance: 1350,
    dateOpened: '2021-06-01',
    creditBureau: ['Experian'],
  });
  const rel = detectOCCARelationship(oc, ca);
  assert.equal(rel.decision, 'link_only');
  assert.equal(rel.disputeCaFirst, true);
});

test('anti-fabrication blocks invented account suffix', () => {
  const item = mkItem({ accountNumber: '****4321', fullAccountNumber: '****4321', balance: 100 });
  const result = guardLetterAgainstFabrication({
    letterText: 'Please delete account ending in 9999 with a balance of $100.00.',
    item,
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'INVENTED_ACCOUNT_SUFFIX'));
});

test('anti-fabrication blocks UPL attorney persona', () => {
  const item = mkItem({ accountNumber: '****4321' });
  const result = guardLetterAgainstFabrication({
    letterText: 'As an attorney I demand deletion of this account ending in 4321.',
    item,
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'UPL_PHRASE'));
});

test('strategy card always has ≥3 Why bullets', () => {
  const item = mkItem({
    creditorName: 'Midland Credit',
    typeOfNegative: 'Collection',
    dateOfFirstDelinquency: '2019-05-01',
  });
  const card = planItemStrategy({ item, pass: 1, personalInfo: { state: 'CA', ssn: '', address: '', city: '' } });
  assert.ok(card.explainWhy.length >= 3);
  assert.ok(card.legalProfile.itemId === item.id);
  assert.equal(getDebtTypeStrategyForItem(item).debtClass, 'collections');
});

test('score simulator always returns a range + disclaimer', () => {
  const items = [
    mkItem({ typeOfNegative: 'Collection', balance: 500 }),
    mkItem({ typeOfNegative: 'Charge-off', balance: 900 }),
  ];
  const sim = simulateRemovals(items);
  assert.ok(sim.high >= sim.mid && sim.mid >= sim.low);
  assert.match(sim.disclaimer, /not a FICO/i);
});

test('inquiry classifier separates obsolete hard pulls', () => {
  const item = mkItem({
    typeOfNegative: 'Hard Inquiry',
    dateOpened: '2020-01-01',
  });
  assert.equal(isInquiryItem(item), true);
  const profile = classifyInquiry(item, new Date('2026-07-23'));
  assert.equal(profile.strategy, 'obsolete_removal');
  assert.equal(profile.blockFromTradelineBatch, true);
});

test('AIG builds link groups for OC+CA without auto-merge edge', () => {
  const oc = mkItem({
    id: 'g_oc',
    creditorName: 'Capital One',
    typeOfNegative: 'Charge-off',
    balance: 800,
    dateOfFirstDelinquency: '2019-01-01',
    creditBureau: ['TransUnion'],
  });
  const ca = mkItem({
    id: 'g_ca',
    creditorName: 'LVNV Funding',
    typeOfNegative: 'Collection',
    balance: 850,
    dateOpened: '2020-01-01',
    creditBureau: ['Equifax'],
  });
  const graph = buildAccountIdentityGraph([oc, ca]);
  assert.ok(graph.linkGroups.some((g) => g.includes('g_oc') && g.includes('g_ca')));
  assert.equal(graph.mergeGroups.length, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

```

## Patch 20 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (265)
```
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';

// ─── Tiny harness ─────────────────────────────────────────────────────────────
```
### NEW (1003)
```
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategyForItem } from '../src/services/debtTypeStrategyLibrary';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import { creditorsAreAliasMatch } from '../src/data/creditorAliasMatrix';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { simulateRemovals } from '../src/services/scoreImpactSimulator';
import { buildAccountIdentityGraph } from '../src/services/accountIdentityGraph';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';

// ─── Tiny harness ─────────────────────────────────────────────────────────────
```

## Patch 21 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (855)
```
group('Apex — Legal Intelligence + Debt Type');
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategyForItem } from '../src/services/debtTypeStrategyLibrary';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import { creditorsAreAliasMatch } from '../src/data/creditorAliasMatrix';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { simulateRemovals } from '../src/services/scoreImpactSimulator';
import { buildAccountIdentityGraph } from '../src/services/accountIdentityGraph';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';

test('classifies collection debt type and SOL/FCRA anchors', () => {
```
### NEW (117)
```
group('Apex — Legal Intelligence + Debt Type');

test('classifies collection debt type and SOL/FCRA anchors', () => {
```

## Patch 22 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (274)
```
  assert.match(items[0].creditorName, /MIDLAND/i);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

```
### NEW (5156)
```
  assert.match(items[0].creditorName, /MIDLAND/i);
});

// ─── Apex 6.0 cores ───────────────────────────────────────────────────────────

group('Apex — Legal Intelligence + Debt Type');
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategyForItem } from '../src/services/debtTypeStrategyLibrary';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import { creditorsAreAliasMatch } from '../src/data/creditorAliasMatrix';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { simulateRemovals } from '../src/services/scoreImpactSimulator';
import { buildAccountIdentityGraph } from '../src/services/accountIdentityGraph';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';

test('classifies collection debt type and SOL/FCRA anchors', () => {
  const item = mkItem({
    creditorName: 'Portfolio Recovery',
    typeOfNegative: 'Collection',
    dateOfFirstDelinquency: '2015-01-15',
    balance: 400,
  });
  assert.equal(classifyDebtType(item), 'collections');
  const profile = buildLegalProfile(item, { state: 'TX' });
  assert.equal(profile.fdcpa809Applicable, true);
  assert.ok(profile.availableAnchors.some((a) => a.id === 'fcra_611'));
  assert.ok(profile.obsoletionDisputable || profile.creditClockExpired);
});

test('creditor alias matrix matches CAP1 ↔ Capital One', () => {
  assert.equal(creditorsAreAliasMatch('CAP1', 'Capital One Bank'), true);
});

test('OC+CA detector returns link_only for charge-off + PRA', () => {
  const oc = mkItem({
    id: 'oc1',
    creditorName: 'Chase',
    typeOfNegative: 'Charge-off',
    accountStatus: '93',
    balance: 1200,
    dateOfFirstDelinquency: '2020-03-01',
    creditBureau: ['Equifax'],
  });
  const ca = mkItem({
    id: 'ca1',
    creditorName: 'Portfolio Recovery Associates',
    typeOfNegative: 'Collection',
    balance: 1350,
    dateOpened: '2021-06-01',
    creditBureau: ['Experian'],
  });
  const rel = detectOCCARelationship(oc, ca);
  assert.equal(rel.decision, 'link_only');
  assert.equal(rel.disputeCaFirst, true);
});

test('anti-fabrication blocks invented account suffix', () => {
  const item = mkItem({ accountNumber: '****4321', fullAccountNumber: '****4321', balance: 100 });
  const result = guardLetterAgainstFabrication({
    letterText: 'Please delete account ending in 9999 with a balance of $100.00.',
    item,
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'INVENTED_ACCOUNT_SUFFIX'));
});

test('anti-fabrication blocks UPL attorney persona', () => {
  const item = mkItem({ accountNumber: '****4321' });
  const result = guardLetterAgainstFabrication({
    letterText: 'As an attorney I demand deletion of this account ending in 4321.',
    item,
  });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some((f) => f.code === 'UPL_PHRASE'));
});

test('strategy card always has ≥3 Why bullets', () => {
  const item = mkItem({
    creditorName: 'Midland Credit',
    typeOfNegative: 'Collection',
    dateOfFirstDelinquency: '2019-05-01',
  });
  const card = planItemStrategy({ item, pass: 1, personalInfo: { state: 'CA', ssn: '', address: '', city: '' } });
  assert.ok(card.explainWhy.length >= 3);
  assert.ok(card.legalProfile.itemId === item.id);
  assert.equal(getDebtTypeStrategyForItem(item).debtClass, 'collections');
});

test('score simulator always returns a range + disclaimer', () => {
  const items = [
    mkItem({ typeOfNegative: 'Collection', balance: 500 }),
    mkItem({ typeOfNegative: 'Charge-off', balance: 900 }),
  ];
  const sim = simulateRemovals(items);
  assert.ok(sim.high >= sim.mid && sim.mid >= sim.low);
  assert.match(sim.disclaimer, /not a FICO/i);
});

test('inquiry classifier separates obsolete hard pulls', () => {
  const item = mkItem({
    typeOfNegative: 'Hard Inquiry',
    dateOpened: '2020-01-01',
  });
  assert.equal(isInquiryItem(item), true);
  const profile = classifyInquiry(item, new Date('2026-07-23'));
  assert.equal(profile.strategy, 'obsolete_removal');
  assert.equal(profile.blockFromTradelineBatch, true);
});

test('AIG builds link groups for OC+CA without auto-merge edge', () => {
  const oc = mkItem({
    id: 'g_oc',
    creditorName: 'Capital One',
    typeOfNegative: 'Charge-off',
    balance: 800,
    dateOfFirstDelinquency: '2019-01-01',
    creditBureau: ['TransUnion'],
  });
  const ca = mkItem({
    id: 'g_ca',
    creditorName: 'LVNV Funding',
    typeOfNegative: 'Collection',
    balance: 850,
    dateOpened: '2020-01-01',
    creditBureau: ['Equifax'],
  });
  const graph = buildAccountIdentityGraph([oc, ca]);
  assert.ok(graph.linkGroups.some((g) => g.includes('g_oc') && g.includes('g_ca')));
  assert.equal(graph.mergeGroups.length, 0);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(48)}`);
console.log(`Phase 2 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

```

## Patch 23 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (265)
```
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';

// ─── Tiny harness ─────────────────────────────────────────────────────────────
```
### NEW (1003)
```
import { validateAndEnrich } from '../src/services/creditReportParser/postValidator';
import type { AcquiredText, AIEnhancedAccount } from '../src/services/creditReportParser/types';
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategyForItem } from '../src/services/debtTypeStrategyLibrary';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import { creditorsAreAliasMatch } from '../src/data/creditorAliasMatrix';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { simulateRemovals } from '../src/services/scoreImpactSimulator';
import { buildAccountIdentityGraph } from '../src/services/accountIdentityGraph';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';

// ─── Tiny harness ─────────────────────────────────────────────────────────────
```

## Patch 24 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\scripts\phase2-tests.ts`
### OLD (855)
```
group('Apex — Legal Intelligence + Debt Type');
import { buildLegalProfile } from '../src/services/legalIntelligenceEngine';
import { classifyDebtType, getDebtTypeStrategyForItem } from '../src/services/debtTypeStrategyLibrary';
import { detectOCCARelationship } from '../src/services/ocCaRelationshipDetector';
import { creditorsAreAliasMatch } from '../src/data/creditorAliasMatrix';
import { guardLetterAgainstFabrication } from '../src/services/antiFabricationGuard';
import { planItemStrategy } from '../src/services/itemStrategyPlanner';
import { simulateRemovals } from '../src/services/scoreImpactSimulator';
import { buildAccountIdentityGraph } from '../src/services/accountIdentityGraph';
import { classifyInquiry, isInquiryItem } from '../src/services/inquiryDisputeEngine';

test('classifies collection debt type and SOL/FCRA anchors', () => {
```
### NEW (117)
```
group('Apex — Legal Intelligence + Debt Type');

test('classifies collection debt type and SOL/FCRA anchors', () => {
```
