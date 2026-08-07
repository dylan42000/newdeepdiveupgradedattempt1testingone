import type { NegativeItem } from "../types";
import type { DisputeGenealogy } from "./disputeGenealogyService";
import type { ReInsertionAlert } from "./reInsertionMonitor";

export interface AttorneyReferralInput {
  item: NegativeItem;
  genealogy: DisputeGenealogy;
  reInsertionAlerts: ReInsertionAlert[];
}

export interface AttorneyReferralRecommendation {
  shouldRefer: boolean;
  urgency: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  suggestedClaims: string[];
  evidenceChecklist: string[];
}

export function evaluateAttorneyReferral(input: AttorneyReferralInput): AttorneyReferralRecommendation {
  const reasons: string[] = [];
  const suggestedClaims: string[] = [];
  const evidenceChecklist: string[] = [];

  const rounds = input.genealogy.totalRoundsRequired;
  const finalOutcome = input.genealogy.finalOutcome;

  if (rounds >= 4 && finalOutcome !== "deleted") {
    reasons.push("Four or more dispute rounds without complete deletion.");
    suggestedClaims.push("FCRA §611: unreasonable reinvestigation after repeated disputes.");
  }

  if (input.genealogy.roundHistory.some((node) => node.outcome === "NO_RESPONSE_30_DAYS")) {
    reasons.push("One or more 30-day response deadlines were missed.");
    suggestedClaims.push("FCRA §611(a)(1): failure to complete timely reinvestigation.");
  }

  if (input.reInsertionAlerts.length > 0) {
    reasons.push("Potential unlawful reinsertion detected after prior deletion.");
    suggestedClaims.push("FCRA §611(a)(5)(B): reinsertion notice/certification defects.");
    suggestedClaims.push("FCRA §623(a)(1)(A): inaccurate furnisher reporting.");
  }

  if ((input.item.status || "").toLowerCase().includes("collection") && rounds >= 3) {
    reasons.push("Persistent collection tradeline despite multiple disputes.");
    suggestedClaims.push("FDCPA §807/§808: false or unfair collection reporting practices.");
  }

  if (reasons.length > 0) {
    evidenceChecklist.push("Full dispute letter chain (all rounds).", "Bureau responses and envelopes with postmarks.");
    evidenceChecklist.push("Credit report snapshots before/after each round.");
    evidenceChecklist.push("Proof of certified mailing and delivery status.");
  }

  const urgency: AttorneyReferralRecommendation["urgency"] = input.reInsertionAlerts.length > 0
    ? "HIGH"
    : rounds >= 4
      ? "MEDIUM"
      : "LOW";

  return {
    shouldRefer: reasons.length > 0,
    urgency,
    reasons,
    suggestedClaims: dedupe(suggestedClaims),
    evidenceChecklist: dedupe(evidenceChecklist),
  };
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}
