import type { DisputeRound, NegativeItem } from "../types";

export interface Metro2Violation {
  code: string;
  description: string;
}

export interface CrossBureauInconsistency {
  field: string;
  description: string;
}

export type DisputeAngle = {
  code: string;
  description: string;
  legalBasis: string;
  promptAngle: string;
  frivolousRisk: "LOW" | "MEDIUM" | "HIGH";
  bestRound: DisputeRound[];
};

export const DISPUTE_ANGLES: DisputeAngle[] = [
  {
    code: "CANNOT_VERIFY",
    description: "Consumer cannot confirm account accuracy",
    legalBasis: "FCRA §611",
    promptAngle: "Focus on inability to independently verify account accuracy from available records.",
    frivolousRisk: "LOW",
    bestRound: [1, 2],
  },
  {
    code: "DOFD_INACCURATE",
    description: "Date of first delinquency appears inconsistent",
    legalBasis: "FCRA §605(a)(4)",
    promptAngle: "Challenge date of first delinquency inconsistencies and reporting-period implications.",
    frivolousRisk: "LOW",
    bestRound: [1, 2, 3],
  },
  {
    code: "METRO2_VIOLATION",
    description: "Metro 2 coding or field compliance defects",
    legalBasis: "Metro 2 + FCRA §623",
    promptAngle: "Lead with specific Metro 2 format and field-level compliance violations.",
    frivolousRisk: "LOW",
    bestRound: [2, 3, 4],
  },
  {
    code: "CROSS_BUREAU_INCONSISTENCY",
    description: "Conflicting data across bureaus",
    legalBasis: "FCRA §611",
    promptAngle: "Highlight contradictory reporting across bureaus as evidence of inaccuracy.",
    frivolousRisk: "LOW",
    bestRound: [1, 2],
  },
  {
    code: "METHOD_OF_VERIFICATION",
    description: "Demand method of verification details",
    legalBasis: "FCRA §611(a)(6)(7)",
    promptAngle: "Demand names, documents, and investigation methods used for verification.",
    frivolousRisk: "LOW",
    bestRound: [3],
  },
  {
    code: "BALANCE_INACCURACY",
    description: "Reported balance conflicts with records",
    legalBasis: "FCRA §611 + Metro 2",
    promptAngle: "Challenge the specific reported balance as inconsistent with available records.",
    frivolousRisk: "MEDIUM",
    bestRound: [2, 3],
  },
  {
    code: "ACCOUNT_NOT_MINE",
    description: "Consumer does not recognize account",
    legalBasis: "FCRA §611 + §605B",
    promptAngle: "Assert account ownership is unverified and demand documentary proof of ownership.",
    frivolousRisk: "LOW",
    bestRound: [1, 2],
  },
  {
    code: "PAYMENT_STATUS_INACCURATE",
    description: "Payment history codes are inaccurate",
    legalBasis: "FCRA §623 + Metro 2",
    promptAngle: "Challenge inaccurate payment-history coding and status chronology.",
    frivolousRisk: "LOW",
    bestRound: [2, 3, 4],
  },
  {
    code: "CREDITOR_NAME_UNKNOWN",
    description: "Creditor identity is unclear",
    legalBasis: "FCRA §611",
    promptAngle: "Consumer does not recognize creditor identity and demands furnishers be identified.",
    frivolousRisk: "LOW",
    bestRound: [1],
  },
  {
    code: "RE_AGING_VIOLATION",
    description: "Possible unlawful re-aging",
    legalBasis: "FCRA §605(a) + §623(5)",
    promptAngle: "Challenge date progression as potential unlawful re-aging beyond reporting limits.",
    frivolousRisk: "LOW",
    bestRound: [2, 3, 4],
  },
  {
    code: "ORIGINAL_CREDITOR_MISSING",
    description: "Original creditor details absent",
    legalBasis: "Metro 2 + FDCPA §809",
    promptAngle: "Demand original creditor identity and ownership chain documentation.",
    frivolousRisk: "LOW",
    bestRound: [2, 3],
  },
  {
    code: "PROCEDURAL_DEFECT",
    description: "Investigation procedure inadequate",
    legalBasis: "FCRA §611(a)(1)",
    promptAngle: "Challenge procedural adequacy of reinvestigation, not just outcome.",
    frivolousRisk: "LOW",
    bestRound: [3, 4, 5, 6],
  },
];

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function selectNextAngle(
  item: NegativeItem,
  priorRoundAngles: string[],
  currentRound: DisputeRound,
  metro2Violations: Metro2Violation[] = [],
  crossBureauIssues: CrossBureauInconsistency[] = [],
): DisputeAngle {
  const used = new Set(priorRoundAngles);
  const previous = priorRoundAngles[priorRoundAngles.length - 1] || null;

  if (metro2Violations.length > 0) {
    return DISPUTE_ANGLES.find((a) => a.code === "METRO2_VIOLATION") || DISPUTE_ANGLES[0];
  }

  if (crossBureauIssues.length > 0) {
    return DISPUTE_ANGLES.find((a) => a.code === "CROSS_BUREAU_INCONSISTENCY") || DISPUTE_ANGLES[0];
  }

  const byRound = DISPUTE_ANGLES.filter((angle) => angle.bestRound.includes(currentRound));
  const nonRepeated = byRound.filter((angle) => angle.code !== previous);
  const unused = nonRepeated.filter((angle) => !used.has(angle.code));

  const pool = unused.length > 0 ? unused : nonRepeated.length > 0 ? nonRepeated : byRound;

  if (pool.length === 0) {
    return DISPUTE_ANGLES[0];
  }

  const deterministic = hashString(`${item.id}|${item.creditorName}|${currentRound}|${priorRoundAngles.length}`);
  return pool[deterministic % pool.length];
}

export function getAngleByCode(code: string): DisputeAngle | null {
  return DISPUTE_ANGLES.find((angle) => angle.code === code) || null;
}
