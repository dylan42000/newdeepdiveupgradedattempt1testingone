/**
 * Regression checks for FINAL-WORLD-CLASS orchestrator path (§5 / §7 / §8 / §11 / §13).
 * Runs without IndexedDB — exercises pure helpers + in-memory hashing/gates.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computePriority, evaluateGates } from '../src/services/casePlanService';
import { PacketAssembler } from '../src/services/packetAssembler';
import { buildCanonicalAccountKey } from '../src/services/caseRepository';
import { ResponseIntakeService } from '../src/services/responseIntakeService';
import type { NegativeItem } from '../src/types';
import type { AutopilotCase } from '../src/types/autopilotCase';

const baseItem: NegativeItem = {
  id: 'eq-orch-1',
  creditorName: 'Capital One Bank USA NA',
  accountNumber: '1234****7788',
  balance: 842,
  typeOfNegative: 'Charge-Off',
  originalDateOfDelinquency: '2022-01-01',
  dateOfLastReporting: '2026-06-01',
  originalOpeningDate: '2019-03-01',
  status: 'Charge-off',
  creditBureau: ['Equifax'],
  additionalInfo: 'Balance differs across reports',
  disputeRound: 1,
  disputeStatus: 'Undisputed',
  lastDisputeDate: null,
  disputeDeadline: null,
  priorityScore: 70,
  estimatedScoreImpact: null,
  notes: [],
  solDropDate: null,
  accountType: 'Revolving',
};

// Stable canonical key survives cosmetic creditor rename
const keyA = buildCanonicalAccountKey(baseItem, 'Equifax');
const keyB = buildCanonicalAccountKey(
  { ...baseItem, creditorName: 'CAPITAL ONE' },
  'Equifax',
);
assert.equal(keyA.split('::')[1], keyB.split('::')[1], 'Account tail must be stable across alias names');
assert.ok(keyA.includes('equifax'), 'Canonical key must include bureau');

// Priority weights bounded + evidence blocked → Not currently actionable territory
const strong = computePriority({
  item: baseItem,
  evidenceTier: 'STRONG',
  evidenceScore: 75,
  onHold: false,
  missingFacts: 0,
  strategyFit: 60,
});
assert.ok(strong.total >= 40 && strong.total <= 100, 'Priority must stay bounded');

const blocked = computePriority({
  item: baseItem,
  evidenceTier: 'BLOCKED',
  evidenceScore: 10,
  onHold: true,
  missingFacts: 2,
  strategyFit: 20,
});
assert.ok(blocked.total < strong.total, 'Blocked/held cases must rank below ready cases');
assert.ok(blocked.riskPenalty > 0, 'Risk penalties must apply');

const caseRecord: AutopilotCase = {
  id: 'case-1',
  profileId: 'default',
  canonicalAccountKey: keyA,
  bureau: 'Equifax',
  creditorName: baseItem.creditorName,
  accountDisplay: '****7788',
  negativeItemId: baseItem.id,
  linkedNegativeItemIds: [baseItem.id],
  state: 'ELIGIBLE',
  passNumber: 1,
  priorityScore: strong.total,
  priorityLabel: 'Promising',
  evidenceTier: 'BASIC',
  riskFlags: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastTransitionAt: new Date().toISOString(),
};

const gates = evaluateGates({
  profileId: 'default',
  item: baseItem,
  caseRecord,
  vaultDocs: [],
  missingFacts: ['userRecognizesAccount'],
});
assert.ok(gates.every((g) => g.gate), 'Every gate must be named');
assert.equal(gates.length, 12, 'Ordered gate pipeline must include all 12 gates');
const evidenceGate = gates.find((g) => g.gate === 'evidence');
assert.ok(evidenceGate && evidenceGate.passed === false, 'Empty vault must fail evidence gate');
assert.ok(evidenceGate?.remediation?.taskType === 'add', 'Failed evidence gate must create Add task');

// Content hash is deterministic and sensitive to letter edits
const hash1 = PacketAssembler.computeContentHash({
  letterContent: 'I dispute the Capital One account ending in 7788.',
  recipientName: 'Equifax',
  recipientAddress: 'P.O. Box 740256',
  accountReference: '****7788',
  attachmentIds: ['id-1'],
  planId: 'plan-1',
  factVersion: 'fv_1',
});
const hash2 = PacketAssembler.computeContentHash({
  letterContent: 'I dispute the Capital One account ending in 7788.',
  recipientName: 'Equifax',
  recipientAddress: 'P.O. Box 740256',
  accountReference: '****7788',
  attachmentIds: ['id-1'],
  planId: 'plan-1',
  factVersion: 'fv_1',
});
const hash3 = PacketAssembler.computeContentHash({
  letterContent: 'I dispute the Capital One account ending in 7788. UPDATED',
  recipientName: 'Equifax',
  recipientAddress: 'P.O. Box 740256',
  accountReference: '****7788',
  attachmentIds: ['id-1'],
  planId: 'plan-1',
  factVersion: 'fv_1',
});
assert.equal(hash1, hash2, 'Identical packets must share content hash');
assert.notEqual(hash1, hash3, 'Edited letter must invalidate prior content hash');

// Response intake granular classification
const deleted = ResponseIntakeService.classifyText(
  'Equifax has deleted the Capital One account ending in 7788 from your credit file.',
);
assert.equal(deleted.outcome, 'deleted');
assert.equal(deleted.sender, 'Equifax');

const frivolous = ResponseIntakeService.classifyText(
  'We consider this dispute frivolous and will not reinvestigate.',
);
assert.equal(frivolous.outcome, 'frivolous');

const evidenceReq = ResponseIntakeService.classifyText(
  'Please provide proof of identity before we continue the investigation.',
);
assert.equal(evidenceReq.outcome, 'identity_evidence_requested');

// Source inventory — orchestrator is the public entry; V2 remains the engine
const orch = readFileSync(new URL('../src/services/autopilotOrchestrator.ts', import.meta.url), 'utf8');
assert.ok(orch.includes('AutoPilotEngineV2.runCycle'), 'Orchestrator must delegate letter generation to V2');
assert.ok(orch.includes('PacketAssembler.assemble'), 'Orchestrator must assemble approval-bound packets');
assert.ok(orch.includes('AutopilotInboxService'), 'Orchestrator must route failures to inbox');

const idb = readFileSync(new URL('../src/services/indexedDB.ts', import.meta.url), 'utf8');
assert.ok(idb.includes('DB_VERSION = 6'), 'IndexedDB must be on v6 (v5 cases + disputeLettersV2)');
assert.ok(idb.includes('"cases"'), 'cases store required');
assert.ok(idb.includes('"caseFacts"'), 'caseFacts store required');
assert.ok(idb.includes('"packetApprovals"'), 'packetApprovals store required');
assert.ok(idb.includes('"autopilotEvents"'), 'autopilotEvents store required');
assert.ok(idb.includes('"disputeLettersV2"'), 'disputeLettersV2 store required for uniqueness priors');
assert.ok(
  idb.includes('createObjectStore("disputeLettersV2"'),
  'disputeLettersV2 must be created in onupgradeneeded',
);

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.ok(app.includes('useState<AppPage>("autopilot")'), 'AutoPilot must be the default landing page');

process.stdout.write('Orchestrator upgrade regression checks passed.\n');
