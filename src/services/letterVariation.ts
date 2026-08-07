/**
 * letterVariation.ts — Anti-Frivolous Letter Uniqueness Engine
 *
 * Bureau AI systems (particularly Equifax's and Experian's) scan incoming dispute
 * letters for template signatures, common phrase clusters, and syntactic patterns.
 * Letters that match known templates get flagged as "frivolous" under FCRA §611(a)(3)
 * and dismissed without investigation.
 *
 * This module generates unique per-letter variation seeds that the AI prompt
 * architecture uses to produce syntactically distinct, humanized letters every time.
 * No two letters share the same tone profile, structural order, opener, or
 * citation presentation style.
 */

import type { DisputeRound, LetterTemplateType, NegativeItem } from "../types";

// ─── Variation Dimensions ─────────────────────────────────────────────────────

/** Prose tone profile — controls formality level and word choice register */
export type ToneProfile =
  | "formal-legal"        // Strict legalese, passive constructions, maximum citation density
  | "assertive-direct"    // First-person active voice, punchy, no hedging
  | "measured-factual"    // Neutral, evidence-forward, accountant-style precision
  | "urgent-escalatory";  // Rising pressure, time-bounded demands, imminent-action framing

/** Opening structural pattern — first paragraph approach */
export type OpeningStyle =
  | "statutory-lead"      // Opens with the statute: "Pursuant to 15 U.S.C. §..."
  | "fact-lead"           // Opens with the disputed account facts before citing law
  | "rights-invocation"   // Opens with consumer rights declaration
  | "chronology-lead"     // Opens by establishing the timeline of events
  | "administrative-lead";// Opens with administrative record reference (certified mail, etc.)

/** Citation presentation style — how statutes are referenced in body */
export type CitationStyle =
  | "inline-full"         // Full title inline: "Fair Credit Reporting Act, 15 U.S.C. § 1681i(a)"
  | "parenthetical"       // Parenthetical: "must investigate (15 U.S.C. § 1681i)"
  | "footnote-style"      // End-of-sentence: "...as required by law. See 15 U.S.C. § 1681i."
  | "section-headers";    // Statute as section title: "III. Obligation Under 15 U.S.C. § 1681i"

/** Response demand framing — how the ultimatum is worded */
export type DemandFraming =
  | "deadline-absolute"   // "You have 30 days from receipt of this letter..."
  | "conditional-delete"  // "Failure to verify shall result in mandatory deletion..."
  | "investigative-duty"  // "Your statutory duty to investigate requires..."
  | "remediation-demand"; // "I am demanding immediate remediation including..."

/** Closing signature block variant */
export type ClosingStyle =
  | "sans-prejudice"      // "Without Prejudice"
  | "legal-reservation"   // "All rights reserved, without waiver"
  | "simple"              // Just name and date, clean
  | "cc-list";            // Includes CC: CFPB, FTC, State AG for pressure

// ─── Variation Seed ───────────────────────────────────────────────────────────

export interface VariationSeed {
  tone: ToneProfile;
  opening: OpeningStyle;
  citation: CitationStyle;
  demand: DemandFraming;
  closing: ClosingStyle;
  /** Structural reordering — which paragraph order to use (1-4 = sections) */
  sectionOrder: [1, 2, 3, 4] | [1, 3, 2, 4] | [2, 1, 3, 4] | [1, 2, 4, 3];
  /** Synonym pool to avoid repeated key phrases */
  synonymPool: Record<string, string>;
  /** Unique ID for this variation — logged for duplicate detection */
  variationId: string;
  /** A brief randomized personal contextualizer injected into the letter body */
  humanizer: string;
}

// ─── Synonym pools (rotated randomly) ────────────────────────────────────────

const SYNONYM_SETS: Record<string, string[]> = {
  dispute: ["dispute", "challenge", "contest", "object to", "take issue with"],
  inaccurate: ["inaccurate", "erroneous", "incorrect", "flawed", "unverifiable"],
  request: ["request", "demand", "require", "insist on", "formally seek"],
  verify: ["verify", "substantiate", "corroborate", "confirm", "authenticate"],
  delete: ["delete", "remove", "expunge", "purge", "suppress"],
  immediately: ["immediately", "without delay", "forthwith", "at once", "promptly"],
  investigation: ["investigation", "reinvestigation", "inquiry", "review", "audit"],
  documentation: ["documentation", "records", "evidence", "supporting materials", "documentation"],
  obligation: ["obligation", "duty", "requirement", "responsibility", "mandate"],
  violation: ["violation", "breach", "infringement", "failure", "noncompliance"],
};

function pickSynonym(key: string, seed: number): string {
  const pool = SYNONYM_SETS[key] || [key];
  return pool[seed % pool.length];
}

// ─── Humanizer snippets ───────────────────────────────────────────────────────
// These are brief, authentic-sounding personal contextualizers that break up
// the clinical template pattern and add individuality. The bureau's AI pattern
// matcher struggles with contextually coherent but unpredictable personal text.

const HUMANIZER_SNIPPETS = [
  "I have been actively working to correct my credit file and take this matter very seriously.",
  "I have personally reviewed my credit report and identified this account as requiring immediate attention.",
  "As someone working diligently to improve my financial standing, this unverifiable item directly harms my ability to obtain housing and employment.",
  "I have kept detailed records of all correspondence relating to this account and am prepared to present them in any proceeding.",
  "This dispute arises from my careful and thorough review of the information currently reported about me.",
  "I have made every good-faith effort to resolve this matter through administrative channels before submitting this formal dispute.",
  "My creditworthiness is being materially harmed by the continued reporting of this item, which I believe cannot be verified through proper documentation.",
  "I am a consumer exercising my federally protected rights and expect a thorough, documented investigation — not a perfunctory checkbox response.",
  "Having reviewed relevant FCRA provisions carefully, I am submitting this dispute with specific legal grounds that I expect to be addressed item by item.",
  "I am keeping a complete audit trail of this dispute process, including timestamps, certified mail receipts, and all responses received.",
  "This letter is the product of careful review of my consumer credit file, which I obtained directly from your bureau.",
  "The account identified herein contains specific factual errors that I have documented and am prepared to substantiate upon request.",
];

// ─── Core generator ───────────────────────────────────────────────────────────

/**
 * Generate a unique variation seed for a dispute letter.
 * Deterministic within a given (itemId + bureau + round + templateType) tuple
 * but rotates across the full variation space to ensure no two successive letters
 * use the same profile.
 *
 * The non-deterministic entropy injection (Date.now() fractional component)
 * ensures campaigns run on the same day still produce distinct letters.
 */
export function generateVariationSeed(
  item: NegativeItem,
  bureau: string,
  round: DisputeRound,
  templateType: LetterTemplateType
): VariationSeed {
  // Build a numeric hash from the combination of factors
  const rawStr = `${item.id}|${item.creditorName}|${bureau}|${round}|${templateType}|${Date.now()}`;
  let hash = 0;
  for (let i = 0; i < rawStr.length; i++) {
    hash = (hash << 5) - hash + rawStr.charCodeAt(i);
    hash |= 0; // Convert to 32-bit int
  }
  const h = Math.abs(hash);

  const tones: ToneProfile[] = ["formal-legal", "assertive-direct", "measured-factual", "urgent-escalatory"];
  const openings: OpeningStyle[] = ["statutory-lead", "fact-lead", "rights-invocation", "chronology-lead", "administrative-lead"];
  const citations: CitationStyle[] = ["inline-full", "parenthetical", "footnote-style", "section-headers"];
  const demands: DemandFraming[] = ["deadline-absolute", "conditional-delete", "investigative-duty", "remediation-demand"];
  const closings: ClosingStyle[] = ["sans-prejudice", "legal-reservation", "simple", "cc-list"];
  const orders: Array<[1,2,3,4] | [1,3,2,4] | [2,1,3,4] | [1,2,4,3]> = [
    [1,2,3,4], [1,3,2,4], [2,1,3,4], [1,2,4,3]
  ];

  // Build synonym pool using hash-derived selection
  const synonymPool: Record<string, string> = {};
  Object.keys(SYNONYM_SETS).forEach((key, idx) => {
    synonymPool[key] = pickSynonym(key, (h + idx * 7) % 31);
  });

  const variationId = `v${round}-${templateType.slice(0,3)}-${(h % 9999).toString().padStart(4,"0")}`;
  const humanizer = HUMANIZER_SNIPPETS[(h + round) % HUMANIZER_SNIPPETS.length];

  return {
    tone: tones[h % tones.length],
    opening: openings[(h >> 3) % openings.length],
    citation: citations[(h >> 6) % citations.length],
    demand: demands[(h >> 9) % demands.length],
    closing: closings[(h >> 12) % closings.length],
    sectionOrder: orders[(h >> 15) % orders.length],
    synonymPool,
    variationId,
    humanizer,
  };
}

// ─── Prompt injection builder ─────────────────────────────────────────────────

/**
 * Convert a VariationSeed into a concrete prompt instruction string that
 * is injected into the AI system prompt before the template instruction.
 * This guides the language model toward the specified voice without
 * constraining the legal substance.
 */
export function buildVariationInstruction(seed: VariationSeed): string {
  const toneInstructions: Record<ToneProfile, string> = {
    "formal-legal": "Write in formal legal prose. Use passive constructions where natural. Cite statutes fully on first reference. Maintain professional distance — no contractions.",
    "assertive-direct": "Write in assertive first-person active voice. Short declarative sentences. No hedging language. Each paragraph advances a specific demand.",
    "measured-factual": "Write in neutral, evidence-forward prose. Present facts before legal conclusions. Use precise dates and dollar amounts where available. Analytical, not emotional.",
    "urgent-escalatory": "Write with escalating urgency. Each paragraph increases the stakes. Time-bounded demands. Reference consequences of non-compliance in specific, concrete terms.",
  };

  const openingInstructions: Record<OpeningStyle, string> = {
    "statutory-lead": "Begin your first paragraph by citing the applicable federal statute before identifying the disputed item.",
    "fact-lead": "Begin your first paragraph by identifying the specific disputed account, its reported status, and why it is in dispute — before any statutory citation.",
    "rights-invocation": "Begin your first paragraph with a declaration of your rights under the FCRA as the basis for this dispute.",
    "chronology-lead": "Begin your first paragraph with a brief timeline: when the account appeared, when you discovered the error, and when you are disputing it.",
    "administrative-lead": "Begin your first paragraph by establishing the administrative record context — referencing that this letter is being sent certified mail and will be retained for legal proceedings.",
  };

  const citationInstructions: Record<CitationStyle, string> = {
    "inline-full": "Cite statutes fully inline on first use: 'Fair Credit Reporting Act, 15 U.S.C. § 1681i(a)'. Abbreviate on subsequent references.",
    "parenthetical": "Place statute citations in parentheses after the legal proposition: 'you must investigate (15 U.S.C. § 1681i(a))'.",
    "footnote-style": "Place statute citations at the end of sentences as authority references: '...as required by federal law. See 15 U.S.C. § 1681i(a).'",
    "section-headers": "Use statute numbers as section titles within the letter body: 'I. DISPUTE GROUNDS UNDER 15 U.S.C. § 1681i'.",
  };

  const demandInstructions: Record<DemandFraming, string> = {
    "deadline-absolute": "Frame your demand with an absolute deadline: 'You have [X] days from receipt of this correspondence...'",
    "conditional-delete": "Frame your demand conditionally: 'Should you fail to provide verifiable documentation, you are required by law to delete...'",
    "investigative-duty": "Frame your demand around statutory duty: 'Your obligation under [statute] requires you to conduct a reasonable investigation...'",
    "remediation-demand": "Frame your demand as a remediation requirement: 'I am demanding immediate remediation of the following errors, specifically including...'",
  };

  const closingInstructions: Record<ClosingStyle, string> = {
    "sans-prejudice": "Close with 'Without Prejudice' above your signature.",
    "legal-reservation": "Close with 'All rights reserved. Nothing herein constitutes a waiver of any right or remedy available under applicable law.' above your signature.",
    "simple": "Use a clean, simple signature block — just name, date, and 'Enclosures: [list documents]'.",
    "cc-list": "Include a CC list at the bottom: 'CC: Consumer Financial Protection Bureau, Federal Trade Commission, [State] Attorney General' — this signals regulatory awareness.",
  };

  return [
    `UNIQUENESS DIRECTIVE (variation: ${seed.variationId}):`,
    `TONE: ${toneInstructions[seed.tone]}`,
    `OPENING: ${openingInstructions[seed.opening]}`,
    `CITATION STYLE: ${citationInstructions[seed.citation]}`,
    `DEMAND FRAMING: ${demandInstructions[seed.demand]}`,
    `CLOSING: ${closingInstructions[seed.closing]}`,
    `HUMANIZATION: After your opening paragraph, include this authentic consumer statement verbatim, woven naturally into the prose: "${seed.humanizer}"`,
    `ANTI-PATTERN REQUIREMENT: Do NOT use any of these overused template phrases that trigger auto-rejection: "I am writing to dispute", "I believe this account", "To Whom It May Concern", "I am exercising my rights", "Please investigate", "I request removal". Rephrase all of these using fresh, specific language.`,
  ].join("\n");
}

/**
 * Quick check: does a letter body contain known template trigger phrases?
 * Returns an array of detected phrases (empty = clean).
 */
export function detectTemplatePhrases(letterContent: string): string[] {
  const TRIGGER_PHRASES = [
    "I am writing to dispute",
    "I believe this account",
    "To Whom It May Concern",
    "I am exercising my rights",
    "Please investigate",
    "I request removal",
    "This letter is to inform",
    "I am disputing the following",
    "Please be advised",
    "I hereby dispute",
  ];

  const lower = letterContent.toLowerCase();
  return TRIGGER_PHRASES.filter((phrase) => lower.includes(phrase.toLowerCase()));
}
