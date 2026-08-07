import {
  getEligibleItems,
  getAutoAdvanceRound,
  resolveResponseOutcome,
} from "../src/services/autopilotEngine";
import type {
  NegativeItem,
  DisputeRound,
  DisputeItemStatus,
  AutopilotCampaign,
} from "../src/types";

const ALLOWED_STATUSES: Set<DisputeItemStatus> = new Set([
  "Undisputed",
  "Round1-Pending",
  "Round1-Verified",
  "Round2-Pending",
  "Round2-Verified",
  "Round3-Pending",
  "Round3-Verified",
  "Round4-Legal",
  "Round4-Verified",
  "Round5-CFPB",
  "Round5-Verified",
  "Round6-PreLit",
  "Deleted",
  "Won",
]);

function assertCheck(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function makeItem(id: number): NegativeItem {
  return {
    id: `item-${id}`,
    creditorName: `Creditor ${id}`,
    accountNumber: `0000${id}`,
    balance: 1200,
    typeOfNegative: "Collection",
    originalDateOfDelinquency: "2022-01-10",
    dateOfLastReporting: "2026-03-15",
    originalOpeningDate: "2018-06-01",
    status: "Collection",
    creditBureau: ["Equifax", "Experian", "TransUnion"],
    additionalInfo: "Cadence test item",
    disputeRound: 1,
    disputeStatus: "Undisputed",
    lastDisputeDate: null,
    disputeDeadline: null,
    priorityScore: 50,
    estimatedScoreImpact: null,
    notes: [],
    solDropDate: null,
  };
}

function markRoundPending(item: NegativeItem, round: DisputeRound): NegativeItem {
  const pendingStatus: Record<number, DisputeItemStatus> = {
    1: "Round1-Pending",
    2: "Round2-Pending",
    3: "Round3-Pending",
    4: "Round4-Legal",
    5: "Round5-CFPB",
    6: "Round6-PreLit",
  };

  return {
    ...item,
    disputeRound: round,
    disputeStatus: pendingStatus[round],
    disputeDeadline: "2026-04-01T00:00:00.000Z",
  };
}

function applyOutcome(item: NegativeItem, outcome: "Verified" | "Updated" | "Deleted" | "NoResponse"): NegativeItem {
  const resolved = resolveResponseOutcome(item, outcome);
  assertCheck(ALLOWED_STATUSES.has(resolved.newStatus), `Invalid status emitted: ${resolved.newStatus}`);
  return {
    ...item,
    disputeRound: resolved.newRound,
    disputeStatus: resolved.newStatus,
    lastDisputeDate: "2026-04-20T00:00:00.000Z",
  };
}

function runCadenceScenario(): void {
  const campaign: AutopilotCampaign = {
    id: "campaign-cadence",
    name: "Cadence Validation Campaign",
    startDate: "2026-04-01T00:00:00.000Z",
    totalItems: 6,
    resolvedItems: 0,
    currentRound: 1,
    status: "Active",
    batches: [],
  };

  let items = Array.from({ length: 6 }, (_, i) => makeItem(i + 1));

  const initialEligible = getEligibleItems(items, 1);
  assertCheck(initialEligible.length === 6, `Expected 6 round-1 eligible items, got ${initialEligible.length}`);
  assertCheck(getAutoAdvanceRound(campaign, items) === null, "Campaign should not auto-advance while items are undisputed");

  // Cycle 1: partial round-1 dispatch
  items = items.map((item, idx) => (idx < 2 ? markRoundPending(item, 1) : item));
  assertCheck(getAutoAdvanceRound(campaign, items) === null, "Campaign advanced with undisputed backlog (should not)");

  // Responses come in for cycle 1
  items = items.map((item, idx) => {
    if (idx === 0) return applyOutcome(item, "Verified");
    if (idx === 1) return applyOutcome(item, "NoResponse");
    return item;
  });
  assertCheck(getAutoAdvanceRound(campaign, items) === null, "Campaign advanced before all round-1 items completed");

  // Cycle 2 and 3: remaining items complete round 1
  items = items.map((item, idx) => (idx >= 2 && idx < 4 ? markRoundPending(item, 1) : item));
  items = items.map((item, idx) => (idx >= 2 && idx < 4 ? applyOutcome(item, "Verified") : item));
  assertCheck(getAutoAdvanceRound(campaign, items) === null, "Campaign advanced with remaining undisputed items still present");

  items = items.map((item, idx) => (idx >= 4 ? markRoundPending(item, 1) : item));
  items = items.map((item, idx) => (idx >= 4 ? applyOutcome(item, "Verified") : item));

  const nextRound = getAutoAdvanceRound(campaign, items);
  assertCheck(nextRound === 2, `Expected auto-advance to round 2, got ${String(nextRound)}`);

  // Move campaign to round 2 and ensure pending items block advancement until complete
  campaign.currentRound = 2;
  const round2Eligible = getEligibleItems(items, 2);
  assertCheck(round2Eligible.length === 6, `Expected all 6 items eligible for round 2, got ${round2Eligible.length}`);

  items = items.map((item) => markRoundPending(item, 2));
  assertCheck(getAutoAdvanceRound(campaign, items) === null, "Campaign advanced while round-2 responses still pending");

  items = items.map((item, idx) => (idx < 5 ? applyOutcome(item, "Verified") : item));
  assertCheck(getAutoAdvanceRound(campaign, items) === null, "Campaign advanced before final round-2 item completed");

  items[5] = applyOutcome(items[5], "NoResponse");
  const nextAfterRound2 = getAutoAdvanceRound(campaign, items);
  assertCheck(nextAfterRound2 === 3, `Expected auto-advance to round 3 after full round-2 completion, got ${String(nextAfterRound2)}`);

  console.log("PASS: Autopilot cadence validated. Round advancement waits for complete current-round completion.");
  console.log(`Round1 eligible initially: ${initialEligible.length}`);
  console.log(`Round2 eligible after full round1 completion: ${round2Eligible.length}`);
  console.log(`Auto-advance checkpoints: R1->${nextRound}, R2->${nextAfterRound2}`);
}

try {
  runCadenceScenario();
} catch (error) {
  console.error("FAIL: Autopilot cadence validation failed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
