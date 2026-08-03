import type { NegativeItem, DisputeRound } from "../types";

export interface DeletionProbabilityInput {
  item: NegativeItem;
  round: DisputeRound;
  priorOutcomes: Array<"DELETED" | "UPDATED" | "VERIFIED_ACCURATE" | "NO_RESPONSE_30_DAYS" | "FRIVOLOUS">;
  hasMetro2Violations: boolean;
  hasCrossBureauInconsistency: boolean;
  documentationStrength: "low" | "medium" | "high";
}

export interface DeletionProbabilityResult {
  score: number;
  confidenceBand: "LOW" | "MEDIUM" | "HIGH";
  rationale: string[];
  actionHints: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function statusWeight(status: string): number {
  const normalized = (status || "").toLowerCase();
  if (normalized.includes("collection")) return 12;
  if (normalized.includes("charge")) return 8;
  if (normalized.includes("late")) return 6;
  if (normalized.includes("bankruptcy")) return -8;
  if (normalized.includes("judgment") || normalized.includes("foreclosure")) return -10;
  return 2;
}

function ageWeight(item: NegativeItem): number {
  const sourceDate = item.originalDateOfDelinquency || item.dateOfFirstDelinquency || item.dateOpened;
  if (!sourceDate) return 0;
  const ageDays = Math.max(0, Math.round((Date.now() - new Date(sourceDate).getTime()) / (1000 * 60 * 60 * 24)));
  if (ageDays > 2000) return 12;
  if (ageDays > 1300) return 9;
  if (ageDays > 700) return 5;
  return 0;
}

function roundWeight(round: DisputeRound): number {
  if (round === 1) return 6;
  if (round === 2) return 8;
  if (round === 3) return 7;
  if (round === 4) return 5;
  return 3;
}

function priorOutcomeWeight(
  priorOutcomes: Array<"DELETED" | "UPDATED" | "VERIFIED_ACCURATE" | "NO_RESPONSE_30_DAYS" | "FRIVOLOUS">,
): number {
  let weight = 0;
  for (const outcome of priorOutcomes) {
    if (outcome === "DELETED") weight += 20;
    if (outcome === "UPDATED") weight += 8;
    if (outcome === "NO_RESPONSE_30_DAYS") weight += 10;
    if (outcome === "VERIFIED_ACCURATE") weight -= 8;
    if (outcome === "FRIVOLOUS") weight -= 14;
  }
  return weight;
}

function documentationWeight(level: "low" | "medium" | "high"): number {
  if (level === "high") return 12;
  if (level === "medium") return 5;
  return -3;
}

export function calculateDeletionProbability(input: DeletionProbabilityInput): DeletionProbabilityResult {
  const { item, round, priorOutcomes, hasMetro2Violations, hasCrossBureauInconsistency, documentationStrength } = input;

  let score = 45;
  const rationale: string[] = [];
  const actionHints: string[] = [];

  const statusDelta = statusWeight(item.status);
  score += statusDelta;
  rationale.push(`Status impact: ${statusDelta >= 0 ? "+" : ""}${statusDelta}`);

  const ageDelta = ageWeight(item);
  score += ageDelta;
  rationale.push(`Account age impact: ${ageDelta >= 0 ? "+" : ""}${ageDelta}`);

  const roundDelta = roundWeight(round);
  score += roundDelta;
  rationale.push(`Dispute round impact: +${roundDelta}`);

  const priorDelta = priorOutcomeWeight(priorOutcomes);
  score += priorDelta;
  rationale.push(`Prior outcomes impact: ${priorDelta >= 0 ? "+" : ""}${priorDelta}`);

  if (hasMetro2Violations) {
    score += 11;
    rationale.push("Metro 2 inconsistencies detected: +11");
    actionHints.push("Lead next letter with specific Metro 2 field-level defects.");
  }

  if (hasCrossBureauInconsistency) {
    score += 9;
    rationale.push("Cross-bureau inconsistency detected: +9");
    actionHints.push("Attach side-by-side bureau comparison as exhibit.");
  }

  const docDelta = documentationWeight(documentationStrength);
  score += docDelta;
  rationale.push(`Documentation quality impact: ${docDelta >= 0 ? "+" : ""}${docDelta}`);

  if (!item.accountNumber || item.accountNumber === "Unknown") {
    score += 6;
    rationale.push("Missing account identifier can support unverifiable claim: +6");
    actionHints.push("Demand method of verification and full account ownership chain.");
  }

  if ((item.creditBureau || []).length > 1) {
    score += 4;
    rationale.push("Multi-bureau reporting gives consistency leverage: +4");
  }

  score = clamp(Math.round(score), 1, 99);

  const confidenceBand: DeletionProbabilityResult["confidenceBand"] = score >= 70
    ? "HIGH"
    : score >= 45
      ? "MEDIUM"
      : "LOW";

  if (confidenceBand === "LOW") {
    actionHints.push("Rotate dispute angle and include stronger documentary exhibits.");
  }

  if (confidenceBand === "HIGH") {
    actionHints.push("Escalate with method-of-verification demand if no deletion by next cycle.");
  }

  return {
    score,
    confidenceBand,
    rationale,
    actionHints,
  };
}
