import {
  buildTradelineMergePlan,
  decideMergeTier,
  stitchAccountNumbers,
  type MergeDecisionTier,
} from '../src/services/tradelineMerger';
import { mergeGoldenCases, type MergeGoldenCase } from '../src/services/__fixtures__/merge/goldenCases';

function decisionAllowed(actual: MergeDecisionTier, expected: MergeDecisionTier | MergeDecisionTier[]): boolean {
  const allowed = Array.isArray(expected) ? expected : [expected];
  return allowed.includes(actual);
}

function assertPairCase(testCase: MergeGoldenCase): string[] {
  const errors: string[] = [];
  const [leftIdx, rightIdx] = testCase.pairIndex ?? [0, 1];
  const left = testCase.items[leftIdx];
  const right = testCase.items[rightIdx];
  const candidate = decideMergeTier(left, right);

  if (!decisionAllowed(candidate.decision, testCase.expectedDecision)) {
    errors.push(
      `[${testCase.id}] expected decision ${JSON.stringify(testCase.expectedDecision)}, got ${candidate.decision} (confidence=${candidate.confidence.toFixed(3)})`,
    );
  }

  if (testCase.forbidAutoMerge && candidate.decision === 'AUTO_MERGE') {
    errors.push(`[${testCase.id}] forbidden AUTO_MERGE but received AUTO_MERGE`);
  }

  if (testCase.expectStitchedEndsWith || testCase.expectStitchedContains) {
    const stitched = stitchAccountNumbers(testCase.items);
    if (testCase.expectStitchedEndsWith && !stitched.accountNumber.endsWith(testCase.expectStitchedEndsWith)) {
      errors.push(
        `[${testCase.id}] stitched account "${stitched.accountNumber}" does not end with "${testCase.expectStitchedEndsWith}"`,
      );
    }
    for (const fragment of testCase.expectStitchedContains ?? []) {
      if (!stitched.accountNumber.includes(fragment)) {
        errors.push(
          `[${testCase.id}] stitched account "${stitched.accountNumber}" missing fragment "${fragment}"`,
        );
      }
    }
  }

  return errors;
}

function assertPlanShape(testCase: MergeGoldenCase): string[] {
  const errors: string[] = [];
  if (!testCase.expectAutoGroupSize) return errors;

  const plan = buildTradelineMergePlan(testCase.items);
  if (plan.autoMerged.length !== 1) {
    errors.push(`[${testCase.id}] expected one auto-merged group, got ${plan.autoMerged.length}`);
  } else if (plan.autoMerged[0].sourceItems.length !== testCase.expectAutoGroupSize) {
    errors.push(
      `[${testCase.id}] expected ${testCase.expectAutoGroupSize} items in auto-merged group, got ${plan.autoMerged[0].sourceItems.length}`,
    );
  }

  return errors;
}

function main(): void {
  const failures: string[] = [];
  let passed = 0;

  for (const testCase of mergeGoldenCases) {
    const errors = [...assertPairCase(testCase), ...assertPlanShape(testCase)];
    if (errors.length) failures.push(...errors);
    else passed++;
  }

  console.log(`Merge golden fixtures: ${passed}/${mergeGoldenCases.length} passed`);
  if (failures.length) {
    console.error('\nFailures:');
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log('All merge golden fixtures passed.');
}

main();
