import { routeAIRequest } from './aiRouter';
import { apiQueueManager } from './apiQueueManager';
import { assertFactualAnchorsPresent } from './letterValidator';
import { getPersonaForItem, buildPersonaSystemPrompt } from './personaMatrix';
import { buildDisclosureDemandPrompt } from './disclosurePromptBuilder';
import type { HealedAccount } from './accountHealingEngine';
import type { Metro2Flag } from './metro2AuditService';
import { buildLetterDNA12, type LetterDNA } from './letterDNA';
import { buildFactBlock, type LetterFactBlock } from './letterFactInjector';
import { selectCitation } from './bureauCitationBank';
import { generateEntropyMix, type EntropyMix } from './entropyLetterMixer';
import type { NegativeItem } from '../types';
import { DISPUTE_PROMPT_SYSTEM_POLICY, buildPass1DisclosurePivotPrompt } from './disputePromptBuilder';
import { CONSUMER_VOICE_POLICY, normalizeConsumerVoice, validateConsumerVoice } from './consumerVoicePolicy';
import { guardLetterAgainstFabrication } from './antiFabricationGuard';
import { stripLetterBodyPreamble } from './letterBodySanitizer';

export type DisputePass = 1 | 2 | 3 | 4 | 5 | 6;

export interface DisputeLetterRequest {
  account: HealedAccount;
  item?: NegativeItem;
  profileId?: string;
  metro2Flags: Metro2Flag[];
  passNumber: DisputePass;
  bureau: 'experian' | 'equifax' | 'transunion';
  consumerName: string;
  consumerAddress: string;
  todayDate: string;
  cycleNumber?: number;
}

export interface GeneratedLetter {
  body: string;
  persona: string;
  passNumber: DisputePass;
  bureau: string;
  metro2FlagsUsed: Metro2Flag[];
  requiresDisclosure: boolean;
  generatedAt: string;
}

// ─── Pass Strategy Matrix ─────────────────────────────────────────────────────

const PASS_STRATEGY_MATRIX: Record<DisputePass, {
  posture: string;
  legalAnchors: string[];
  tone: string;
  objectiveInstruction: string;
}> = {
  1: {
    posture: 'Round 1 — Specific Accuracy Dispute',
    legalAnchors: ['15 U.S.C. §1681i(a)(1)'],
    tone: 'Professional, first-person, concise, and fact-specific.',
    objectiveInstruction: 'Identify the exact account token and disputed field, quote the reported value, explain the consumer\'s basis, and request investigation and correction or deletion if the information cannot be verified as accurate. Do not threaten, over-cite, or demand documents unrelated to the specific issue.',
  },
  2: {
    posture: 'Round 2 — Response-Specific Reinvestigation',
    legalAnchors: ['15 U.S.C. §1681i(a)(1)', '15 U.S.C. §1681i(a)(6)'],
    tone: 'Firm, chronological, first-person, and focused on what remains unresolved.',
    objectiveInstruction: 'Reference the prior dispute/result only when supplied. Identify the field or relevant information the result did not address and add a genuine material difference such as a new report value, cross-bureau conflict, or consumer clarification. Never create a cosmetic rewrite.',
  },
  3: {
    posture: 'Round 3 — Direct Furnisher and Data Integrity',
    legalAnchors: ['15 U.S.C. §1681s-2(a)(8)', '12 C.F.R. §1022.43'],
    tone: 'First-person, specific, evidence-aware, and measured.',
    objectiveInstruction: 'Address the data furnisher when scope and address are validated. Identify the account, specific disputed information, basis, and reasonably available supporting information. Request investigation, correction, and notice to affected CRAs. Do not claim missing documents automatically require deletion.',
  },
  4: {
    posture: 'Round 4 — Procedure and Unresolved Investigation',
    legalAnchors: ['15 U.S.C. §1681i(a)(6)', '15 U.S.C. §1681i(a)(7)'],
    tone: 'Firm first-person follow-up tied to documented history.',
    objectiveInstruction: 'Identify the response-specific omission, relevant information previously supplied, or documented deadline event. Request the appropriate description of procedure and resolution of the exact remaining inaccuracy. Do not infer willfulness or automated processing without evidence.',
  },
  5: {
    posture: 'Round 5 — Regulatory Packet',
    legalAnchors: ['CFPB Complaint Authority'],
    tone: 'First-person, chronological, compact, and evidence-backed.',
    objectiveInstruction: 'Prepare a consumer complaint-ready narrative and timeline only when history supports it. Never state a complaint has been filed unless a confirmed event says so. Generate for consumer confirmation before external submission.',
  },
  6: {
    posture: 'Round 6 — Final Consumer and Legal-Review Package',
    legalAnchors: ['FCRA §616', 'FCRA §617', 'FCRA §611', 'FCRA §623', '15 U.S.C. § 1681n', '15 U.S.C. § 1681o'],
    tone: 'Measured, first-person, final, and suitable for qualified legal review.',
    objectiveInstruction: 'Summarize only confirmed prior events and the unresolved issue. Request final written resolution and preservation of relevant records. State that the consumer may seek qualified legal advice; do not calculate damages, promise a lawsuit, or claim remedies are exhausted unless supplied history proves it.',
  },
};

// ─── Directive 1: Stochastic Syntactic Entropy Engine ────────────────────────
// Produces a randomized set of structural directives that vary every generation.
// This prevents e-OSCAR OCR from detecting letter templates by structural fingerprint.

const LEGAL_SYNONYM_POOLS = {
  reinvestigation: [
    'reinvestigation', 'comprehensive audit', 'statutory verification',
    'evidentiary review', 'independent validation', 'compliance examination',
  ],
  inaccurate: [
    'inaccurate', 'erroneous', 'materially false', 'factually unsupported',
    'demonstrably incorrect', 'unverifiable', 'defective',
  ],
  demand: [
    'demand', 'formally require', 'mandate', 'compel', 'direct',
    'hereby require', 'formally demand',
  ],
  violation: [
    'violation', 'breach', 'noncompliance', 'infringement',
    'contravention', 'statutory failure', 'regulatory breach',
  ],
  immediately: [
    'immediately', 'forthwith', 'without delay', 'within the statutory period',
    'within 30 days of receipt', 'without further delay',
  ],
};

const STRUCTURE_FORMATS = [
  'BULLET GEOMETRY: Present the disputed facts as standalone bullet points. Do not number them. Each bullet must combine a fact, its defect, and the required correction.',
  'NUMBERED GEOMETRY: Present the disputed facts as a numbered list using 1., 2., 3. Do not use bullets. Vary sentence length and place legal support in different positions.',
  'NARRATIVE GEOMETRY: Present all disputed facts in flowing prose paragraphs. Do not use bullets, numbered lists, or inline enumeration.',
] as const;

const FACT_ORDER_VARIANTS = [
  ['status', 'balance', 'date opened', 'date of first delinquency', 'account number', 'Metro 2 findings'],
  ['date of first delinquency', 'account number', 'Metro 2 findings', 'balance', 'status', 'date opened'],
  ['Metro 2 findings', 'date opened', 'status', 'account number', 'balance', 'date of first delinquency'],
  ['balance', 'date of first delinquency', 'status', 'Metro 2 findings', 'date opened', 'account number'],
] as const;

const CITATION_SEQUENCES = [
  'Cite the substantive FCRA section establishing the right first, then the furnisher ' +
    'obligation section that was violated.',
  'Cite the procedural deadline section first, then the civil liability section ' +
    'that gives it teeth.',
  'Cite the consumer rights section first, then immediately cite the compliance standard ' +
    'the respondent violated.',
  'Open each allegation paragraph with the statutory citation before the factual claim — ' +
    'law anchors fact, not the reverse.',
] as const;

const OPENING_CATEGORIES = [
  'Begin with the specific account data that is factually incorrect — state what is ' +
    'reported versus what is accurate in the opening paragraph. Save every citation for paragraph 2.',
  'Begin with the account number, reported status, and disputed balance, then explain the ' +
    'documented mismatch without naming any law or legal standard in the opening paragraph.',
  'Begin with the prior dispute date and the concrete response failure. Keep the opening ' +
    'paragraph entirely factual; introduce statutory consequences only in later paragraphs.',
] as const;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildEntropySystemAddendum(): string {
  // Controlled style diversity is selected before drafting. Accuracy, first-person
  // authorship, and factual stability take priority over adversarial mutation.
  return `
CONTROLLED CONSUMER STYLE DIVERSITY
Write original account-specific prose in first-person singular. Vary paragraph geometry and
sentence cadence without changing any fact, account token, date, amount, disputed field, or
requested remedy. Ordinary consumer wording is allowed. Do not imitate a law firm, attempt to
"defeat" automated systems, invent communications, or add legal claims solely for uniqueness.
${CONSUMER_VOICE_POLICY}
`.trim();

  /* Legacy entropy data remains below for migration comparison only. */
  const synonymSet = {
    reinvestigation: pickRandom(LEGAL_SYNONYM_POOLS.reinvestigation),
    inaccurate: pickRandom(LEGAL_SYNONYM_POOLS.inaccurate),
    demand: pickRandom(LEGAL_SYNONYM_POOLS.demand),
    violation: pickRandom(LEGAL_SYNONYM_POOLS.violation),
    immediately: pickRandom(LEGAL_SYNONYM_POOLS.immediately),
  };
  const structureFormat = pickRandom(STRUCTURE_FORMATS);
  const factOrder = pickRandom(FACT_ORDER_VARIANTS);

  return `
=== ANTI-TEMPLATE ENTROPY DIRECTIVES (MANDATORY — NON-NEGOTIABLE) ===

Generate original, account-specific prose. Reusing a stock opening, paragraph order,
fact order, demand sequence, or closing from prior letters is a generation failure.

ABSOLUTE OPENING BAN:
The first sentence MUST NOT begin with or paraphrase any of these constructions:
  - "Pursuant to 15 U.S.C."
  - "Pursuant to the FCRA"
  - "I am writing to dispute"
  - "I am writing regarding"
  - "This letter is to dispute"
  - "This is a formal dispute"
  - "I hereby dispute"
  - "Please investigate"
Start with a concrete account fact, a documented inconsistency, a missed prior-round
obligation, or a deadline-specific consequence. Put legal citations after that opening fact.

DIRECTIVE A — MANDATORY LEGAL SYNONYMS FOR THIS GENERATION:
You MUST use the following terms instead of their generic equivalents throughout this letter:
  - Use "${synonymSet.reinvestigation}" instead of "investigation" or "review"
  - Use "${synonymSet.inaccurate}" instead of "wrong" or "incorrect"
  - Use "${synonymSet.demand}" instead of "request" or "ask"
  - Use "${synonymSet.violation}" instead of "error" or "problem"
  - Use "${synonymSet.immediately}" instead of "now" or "promptly"

DIRECTIVE B — STRUCTURAL FORMAT FOR THIS GENERATION:
${structureFormat}
This selected geometry is exclusive. Do not mix it with either of the other two geometries.

DIRECTIVE C — FACT ORDER FOR THIS GENERATION:
Address available facts in this order: ${factOrder.join(' -> ')}.
Skip unavailable facts, but do not revert to the source brief's order.

DIRECTIVE D — CITATION SEQUENCING FOR THIS GENERATION:
${pickRandom(CITATION_SEQUENCES)}

DIRECTIVE E — OPENING CONSTRAINT FOR THIS GENERATION:
${pickRandom(OPENING_CATEGORIES)}

DIRECTIVE F — CITATION RANDOMIZATION:
Do NOT cite legal sections in the same order they appear in the brief. Reorder citations ' +
'within each paragraph to create a unique citation fingerprint. The legal argument must ' +
'hold together regardless of citation order.

DIRECTIVE G — PARAGRAPH ARCHITECTURE:
No two paragraphs may begin with the same word or phrase. Vary sentence length ' +
'aggressively — mix short declarative sentences with longer compound-complex legal ' +
'constructions. This creates a unique syntactic fingerprint that defeats OCR pattern matching.

DIRECTIVE H — THREE-ROUND ESCALATION:
  - Round 1 is a Method of Verification and documentary-record demand. Build the record without litigation threats.
  - Round 2 is a compliance warning tied to the prior response, missing MOV, and failed reasonable reinvestigation.
  - Round 3 is a pre-litigation notice preserving claims, evidence, deadlines, and regulatory escalation.
Never blend the posture of one round into another.

DIRECTIVE I — COMMUNICATION PREFERENCE (OPTIONAL):
Only include a short written-communication preference when it is relevant to a furnisher or
collector contact and supported by the request. It is not required in a credit-bureau dispute.
Never invent prior calls, texts, consent, or revocation facts.
`.trim();
}

// ─── Directive 2: Bureau-Specific Legal Payload ───────────────────────────────
// Injects bureau-specific historical compliance failures and legal obligations.
// This proves to e-OSCAR that the letter is account-specific, not a template.

function buildBureauPayload(bureau: DisputeLetterRequest['bureau']): string {
  const displayName = bureau === 'equifax' ? 'Equifax' : bureau === 'experian' ? 'Experian' : 'TransUnion';
  return `
=== BUREAU-SPECIFIC ROUTING ===
Address this letter to ${displayName}. Keep the substance limited to the consumer's supplied
report data, dispute history, and attachments. Ask for a reasonable reinvestigation and written
results. Do not insert enforcement-history claims, bureau-specific accusations, identity-theft
blocking rules, or assumptions about e-OSCAR unless the request contains facts that make them
directly relevant. Treat cross-bureau differences as leads to investigate, not automatic proof
that any one bureau violated the law.
`.trim();
}

// ─── Directive 3: Dynamic Metro 2 Targeting ───────────────────────────────────
// Targets the specific Metro 2 fields most likely to be defective based on account type.
// Collection and Charge-off have fundamentally different vulnerable fields.

function buildMetro2TargetingLayer(
  typeOfNegative: string,
  metro2Flags: Metro2Flag[]
): string {
  const type = typeOfNegative.toLowerCase();
  const isCollection = /collection/.test(type);
  const isChargeOff = /charge.?off|charged.?off/.test(type);
  const isLate = /late|past.?due|delinquent/.test(type);

  const existingFlagCodes = metro2Flags.map(f => f.fieldCode);

  let targeting = '\n=== DYNAMIC METRO 2 FIELD TARGETING ===\n';
  targeting += 'Based on the account type, the following Metro 2 fields are the primary compliance attack vectors. ';
  targeting += 'These are mathematically constrained fields — if the data in one field is as reported, ';
  targeting += 'it creates logical impossibilities in the related fields below.\n\n';

  if (isCollection) {
    targeting += `ACCOUNT TYPE: Collection — Primary Attack Vector: Chain of Custody Integrity

FIELD 21 (Original Creditor Name): When a debt is sold or assigned, the Original Creditor field ' +
'must reflect the entity that ORIGINATED the account — not the current collector. If this field ' +
'contains the collection agency\'s name or is blank, it is a Metro 2 violation. DEMAND: Furnisher ' +
'must produce the chain-of-assignment documentation proving they are legally authorized to report ' +
'and collect this debt.

FIELD 17A (Date of First Delinquency): This is the most commonly manipulated field in collection ' +
'accounts. Under FCRA §605(a), the 7-year reporting clock begins from the DOFD with the ORIGINAL ' +
'creditor — not from the date the debt was sold to a collector. Collectors frequently re-report ' +
'or fail to accurately carry over the original DOFD, effectively re-aging the account. DEMAND: ' +
'Furnisher must provide documentation from the original creditor establishing the DOFD.

ACCOUNT STATUS CODE: Must be code "DA" (Collection Account). If the status code is anything ' +
'else (e.g., "11" for current, or "64" for collection), the Account Status field is non-compliant.

PAYMENT HISTORY PROFILE (Field 17): For a collection account, the 24-month payment history ' +
'string must reflect the delinquency trajectory accurately. Any "OK" codes after the charge-off ' +
'or collection date represent a Metro 2 violation.`;

    if (!existingFlagCodes.includes('F21')) {
      targeting += '\n\nNOTE: No Metro 2 flag was provided for Field 21 (Original Creditor). ' +
        'The letter should still demand documentation of the chain of assignment as a factual challenge.';
    }
  } else if (isChargeOff) {
    targeting += `ACCOUNT TYPE: Charge-Off — Primary Attack Vector: Payment History Profile Integrity

FIELD 17 (Payment History Profile): The 24-month payment history string must accurately reflect ' +
'the delinquency escalation. Under Metro 2 guidelines, a charge-off should be preceded by ' +
'escalating delinquency codes (30 → 60 → 90 → 120 → 150 → 180). If the profile shows "OK" ' +
'months immediately followed by a charge-off, the history is fabricated or missing. DEMAND: ' +
'Furnisher must provide the complete 24-month payment history ledger from internal records.

FIELD 4 (Account Status): For a charge-off, this field MUST contain code "97" (Unpaid Charge-Off) ' +
'or "DA" if also in collections. Any other status code is a direct Metro 2 violation.

FIELD 5A (Payment Rating): Must be "L" (120+ days past due — charge-off). If this field shows ' +
'any other payment rating, the account status and payment rating are internally inconsistent ' +
'— an impossible Metro 2 data state.

CHARGE-OFF AMOUNT vs. REPORTED BALANCE: For a charge-off, the Charge-Off Amount must equal ' +
'the original balance at time of charge-off. The current "reported balance" may only increase ' +
'by fees contractually authorized in the original agreement. Any unauthorized balance increase ' +
'post-charge-off is a Metro 2 violation AND a potential FDCPA §807 violation.

DOFD TIMING CONSTRAINT: Under standard credit card agreements (and most consumer credit), ' +
'charge-off occurs no more than 180 days after the Date of First Delinquency (DOFD). If the ' +
'reported charge-off date is more than 180 days after the DOFD, the DOFD has been manipulated.`;
  } else if (isLate) {
    targeting += `ACCOUNT TYPE: Late Payment — Primary Attack Vector: Delinquency Code Accuracy

FIELD 17 (Payment History Profile): The payment history string must accurately reflect which ' +
'specific months were delinquent. A reported 30-day late must appear as code "1" in the month ' +
'it occurred; 60-day late as "2"; 90-day as "3". DEMAND: Furnisher must provide a month-by-month ' +
'payment ledger matching the payment history codes reported.

FIELD 5A (Payment Rating): Must match the worst delinquency in the current reporting period. ' +
'If Field 5A reports 60-day late but Field 17 shows no 60-day delinquency in the relevant ' +
'period, the fields are internally contradictory — a Metro 2 compliance failure.

RE-AGING RISK: Demand confirmation that the Date of First Delinquency (Field 17A) reflects ' +
'the original delinquency date and has not been updated to reflect a more recent date, ' +
'which would constitute illegal re-aging under FCRA §605(a)(4).`;
  } else {
    targeting += `ACCOUNT TYPE: Derogatory Account — General Metro 2 Attack\n\n` +
      `FIELD 4 (Account Status): Must accurately reflect the current account condition. ` +
      `Any status code inconsistent with the reported narrative constitutes a Metro 2 violation.\n\n` +
      `FIELD 17A (Date of First Delinquency): Must reflect the original delinquency date. ` +
      `Demand documentation establishing this date from the original creditor's records.\n\n` +
      `FIELD 7 (Compliance Condition Code): If this account was disputed, code "XB" must be ` +
      `present while the dispute is pending. Absence of this code during an active dispute ` +
      `period is an independent Metro 2 violation.`;
  }

  return targeting;
}

// ─── Directive 4: Frivolous Pre-Emption (Passes 1–3) ─────────────────────────
// Strips the bureau's §1681i(a)(3) "frivolous" loophole by explicitly satisfying
// every element required to be non-frivolous in the letter itself.

function buildFrivolousPreemption(passNumber: DisputePass): string {
  if (passNumber > 3) return '';

  return `
=== MANDATORY FRIVOLOUS-DESIGNATION PRE-EMPTION ===
The letter MUST include the following paragraph verbatim or in equivalent legal language ' +
'as a standalone paragraph near the end of the letter body, before the closing demand:

"Notice: Under 15 U.S.C. § 1681i(a)(3)(A), a consumer reporting agency may only deem a ' +
'dispute frivolous or irrelevant if the consumer fails to provide sufficient information to ' +
'investigate the disputed information. This dispute provides: (1) the specific account number ' +
'and creditor name identifying the disputed tradeline; (2) the specific data fields that are ' +
'inaccurate and the statutory basis for each dispute; and (3) explicit demand for the specific ' +
'corrective action required. This dispute is legally complete. Any determination that this ' +
'dispute is frivolous — without first conducting a reasonable reinvestigation — would itself ' +
'constitute a violation of § 1681i(a)(3)(B), which requires written notice to the consumer ' +
'within 5 business days of such determination, including the reasons for the determination ' +
'and identifying any additional information needed. Proceeding without notice would be an ' +
'independent statutory violation subject to civil liability under § 1681n and § 1681o."

This paragraph must appear in every Pass 1, 2, and 3 letter. Do not paraphrase into something ' +
'weaker. You may integrate it naturally into the prose but all substantive elements must be preserved.
`.trim();
}

// ─── World-Class §4.2: 3-Part Dispute Letter Structural Wording Blueprint ─────
// Resolves the historical "First Paragraph Rule" contradiction: Paragraph 1 is
// strictly Factual Identification + Reported Error Narrative; Paragraphs 2–3
// carry Statutory Duties and Method-of-Verification demands. Body-only output.

export function buildWorldClassSystemPrompt(passNumber: number, bureau: string): string {
  return `
You are an expert consumer credit report auditor drafting a formal, highly customized
direct dispute letter. The author and sender of this letter is the individual consumer
writing in the first-person singular ("I", "me", "my").

=== MANDATORY STRUCTURAL REQUIREMENT: THE 3-PART DISPUTE NARRATIVE ===

Your output must be structured into exactly three logical parts:

PART 1: ACCOUNT IDENTIFICATION & FACTUAL DISCREPANCY (Paragraph 1)
- Identify the exact creditor name, the reported account token/suffix, and the
  target credit bureau (${bureau.toUpperCase()}).
- Describe the specific accuracy, completeness, or Metro 2 reporting error using
  ONLY the verified facts supplied.
- Do NOT cite any statutes or U.S.C. codes in this opening paragraph.
  State the clear factual error.

PART 2: STATUTORY DUTY & INVESTIGATION DEMAND (Paragraphs 2 & 3)
- Invoke the controlling statutory authority appropriate for Dispute Pass ${passNumber}:
    * Pass 1: 15 U.S.C. § 1681i(a)(1) (CRA duty to conduct a reasonable
      reinvestigation of disputed items).
    * Pass 2: 15 U.S.C. § 1681i(a)(7) & FCRA § 611(a)(3)(B) (Demand for the
      specific Method of Verification documentation).
    * Pass 3 (Furnisher): 15 U.S.C. § 1681s-2(a)(8)(D) (Direct furnisher
      investigation duty) & Metro 2 Condition Code XB demand.
    * Pass 4–6: Formal notice of non-compliance and preservation of records for
      regulatory review (CFPB/FTC) and FCRA § 616/617 civil liability.
- Require the bureau/furnisher to audit underlying physical account agreements
  and ledgers rather than relying on automated e-OSCAR / ACDV verification pings.

PART 3: EXPLICIT REMEDY DEMAND & CONSENT REVOCATION (Closing Paragraph)
- Demand correction of inaccurate fields OR immediate deletion of unverified
  reporting within 30 days.
- Include a freshly worded revocation of telephone consent: expressly revoke
  consent for all automated telephone dialing systems, artificial/prerecorded
  voice calls, and SMS messages concerning this tradeline; direct all future
  communications to be in writing.

=== EXCLUSIVE FORMATTING DIRECTIVES ===
1. OUTPUT ONLY THE LETTER BODY TEXT. Do not generate date headers, sender or
   recipient address blocks, greeting lines ("Dear Bureau:"), or closing
   signatures ("Sincerely,").
2. Never begin the letter with "Pursuant to," "I am writing to formally dispute,"
   "To Whom It May Concern," or "This letter serves as." Start directly with the
   factual account narrative.
3. Preserve all verified dollar amounts, dates, and account suffixes exactly as
   provided. Never invent or round balances.
`.trim();
}

export function buildWorldClassUserPrompt(
  req: DisputeLetterRequest,
  factBlock: LetterFactBlock,
  metro2Narrative: string,
): string {
  return `
=== VERIFIED ACCOUNT FACTS (IMMUTABLE — USE EXACTLY AS SHOWN) ===
Creditor Name: ${factBlock.creditorName}
Account Display Token: ${factBlock.accountDisplay}
Account Suffix / Last 4: ${factBlock.accountSuffix || '[Not Reported]'}
Target Bureau: ${req.bureau.toUpperCase()}
Reported Account Status: ${factBlock.status || 'Not Reported'}
Reported Balance: ${factBlock.balance == null ? 'Not Reported' : `$${factBlock.balance.toLocaleString()}`}
Date Opened: ${factBlock.dateOpened ?? 'Not Reported'}
Date of First Delinquency (DOFD): ${factBlock.dateOfFirstDelinquency ?? 'Not Reported'}
Dispute Pass / Round: ${req.passNumber}

=== METRO 2 COMPLIANCE & CROSS-BUREAU DISCREPANCY AUDIT ===
${metro2Narrative || 'No additional Metro 2 formatting violations detected; focus on baseline accuracy and verification of the reported balance and status.'}

=== INSTRUCTIONS FOR THIS DRAFT ===
Draft the complete 3-part dispute letter body now. Ensure the account suffix
(${factBlock.accountSuffix || 'as reported'}) and creditor name
(${factBlock.creditorName}) appear explicitly in the text.
`.trim();
}

// ─── World-Class §5.1: Cross-Bureau Metro 2 Discrepancy Narrative ─────────────
// Converts Golden Ticket v5 cross-bureau violations (e.g. Equifax reporting
// $2,430 / Charge-Off while Experian reports $0 / Paid for the same account)
// into an authoritative legal paragraph grounded in FCRA §607(b) duty of
// maximum possible accuracy — without triggering anti-fabrication gates,
// because every violation comes from the parser's verified compliance report.

export interface CrossBureauViolation {
  field: string;
  description: string;
  bureausInvolved: string[];
}

export function buildMetro2CrossBureauNarrative(
  creditorName: string,
  violations: CrossBureauViolation[],
): string {
  if (!violations || violations.length === 0) return '';

  const bulletPoints = violations
    .map(
      (v) =>
        `- [Metro 2 Field Violation - ${v.field}]: ${v.description} ` +
        `(Observed across: ${v.bureausInvolved.map((b) => b.toUpperCase()).join(', ')})`,
    )
    .join('\n');

  return `
CROSS-BUREAU METRO 2 DISCREPANCY NARRATIVE (USE IN PART 1 / PART 2):
The reporting of ${creditorName} exhibits fatal formatting and cross-bureau data
integrity violations under industry-standard Metro 2 Consumer Reporting specifications:

${bulletPoints}

Under FCRA § 607(b) (15 U.S.C. § 1681e(b)), consumer reporting agencies are mandated
to follow reasonable procedures to assure maximum possible accuracy. Reporting
conflicting balances, dates, or status codes for the identical tradeline across
reporting agencies demonstrates that the data has not been audited against original
furnisher records.
`.trim();
}

/**
 * Merge every verified source of Metro 2 / cross-bureau violations for an item:
 *   1. Golden Ticket v5 parser output (item.metro2Violations / metro2Snapshot), and
 *   2. The per-request Metro2AuditService flags.
 * All violations are parser-verified facts — safe for letters and for the
 * anti-fabrication gate.
 */
function collectCrossBureauViolations(req: DisputeLetterRequest): CrossBureauViolation[] {
  const out: CrossBureauViolation[] = [];
  const seen = new Set<string>();
  const push = (v: CrossBureauViolation) => {
    const key = `${v.field}|${v.description}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  };

  const item: any = req.item ?? null;
  const parserViolations: any[] =
    item?.metro2Violations ??
    item?.crossBureauViolations ??
    item?.metro2Report?.violations ??
    [];
  for (const v of parserViolations) {
    if (!v || typeof v !== 'object') continue;
    push({
      field: String(v.field ?? v.fieldCode ?? 'Metro 2'),
      description: String(v.description ?? v.legalBasis ?? ''),
      bureausInvolved:
        Array.isArray(v.bureausInvolved) && v.bureausInvolved.length > 0
          ? v.bureausInvolved.map(String)
          : Array.isArray(item?.creditBureau) ? item.creditBureau.map(String) : [req.bureau],
    });
  }

  for (const flag of req.metro2Flags ?? []) {
    push({
      field: flag.fieldCode,
      description: flag.description,
      bureausInvolved: [req.bureau],
    });
  }

  return out.filter((v) => v.description.trim().length > 0);
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function generateDisputeLetter(req: DisputeLetterRequest): Promise<GeneratedLetter> {
  const taskId = `dispute-${req.account.id}-${req.bureau}-pass${req.passNumber}`;

  // World-Class §6.1: exhausted AI retries resolve null → orchestrator's
  // deterministic Metro 2 fallback renders the letter (Net-100% guarantee).
  return apiQueueManager.enqueue<GeneratedLetter>(taskId, async (attempt) => {
    if (req.account.requiresDisclosureRequest) {
      const disclosureBody = await generateDisclosureLetter(req, attempt);
      return {
        body: disclosureBody,
        persona: 'disclosure_demand',
        passNumber: req.passNumber,
        bureau: req.bureau,
        metro2FlagsUsed: [],
        requiresDisclosure: true,
        generatedAt: new Date().toISOString(),
      };
    }

    // Derive account type for Directive 3 targeting
    const typeOfNegative =
      req.item?.typeOfNegative ||
      req.account.status ||
      '';

    // DNA + Entropy Mixer pipeline
    const dnaItem = req.item ?? ({
          id: req.account.id,
          accountNumber: req.account.reconstructedAccountNumber ?? '',
          creditorName: req.account.creditorName,
          balance: req.account.balance,
          originalDateOfDelinquency: req.account.dateOfFirstDelinquency ?? null,
          dateOfLastReporting: null,
          originalOpeningDate: req.account.dateOpened ?? null,
          status: req.account.status,
          typeOfNegative,
          creditBureau: [req.bureau],
          additionalInfo: '',
          disputeRound: req.passNumber,
          disputeStatus: 'Undisputed',
          lastDisputeDate: null,
          disputeDeadline: null,
          priorityScore: 0,
          estimatedScoreImpact: null,
          notes: [],
          solDropDate: null,
        } as NegativeItem);
    const dna = buildLetterDNA12(dnaItem, req.profileId ?? 'default', req.passNumber, req.bureau, req.cycleNumber ?? 1, Date.now());
    const factBlock = buildFactBlock(dnaItem, req.bureau);
    const citation = selectCitation(req.bureau, req.passNumber);

    const entropyMix = generateEntropyMix(dna, req.passNumber);

    const persona = getPersonaForItem(req.account.id, req.passNumber);
    const strategy = PASS_STRATEGY_MATRIX[req.passNumber];

    // ── World-Class §4.2: 3-Part Structural Wording Blueprint ──────────────
    // The blueprint is the authoritative system prompt. Paragraph roles are now
    // explicit (¶1 facts only → ¶2–3 statutory demands → closing remedy/consent
    // revocation), eliminating the historical "First Paragraph Rule"
    // contradiction that banned citations while demanding legal framing.
    const entropyAddendum = buildEntropySystemAddendum();
    const systemPrompt = [
      buildWorldClassSystemPrompt(req.passNumber, req.bureau),
      buildPersonaSystemPrompt(persona),
      DISPUTE_PROMPT_SYSTEM_POLICY,
      entropyAddendum,
    ].join('\n\n');

    // ── World-Class §5.1: Cross-bureau Metro 2 discrepancy injection ───────
    const crossBureauViolations = collectCrossBureauViolations(req);
    const metro2Narrative = buildMetro2CrossBureauNarrative(
      factBlock.creditorName,
      crossBureauViolations,
    );

    // Retained strategic layers (pre-World-Class behavior preserved):
    const bureauPayload = buildBureauPayload(req.bureau);
    const metro2TargetingLayer = (req.passNumber === 3 || req.metro2Flags.length > 0)
      ? buildMetro2TargetingLayer(typeOfNegative, req.metro2Flags)
      : '';
    const frivolousPreemption = buildFrivolousPreemption(req.passNumber);

    // User prompt = canonical 3-part blueprint + retained strategic layers
    // (verified violation detail, geometry/fact order, citation rotation, and
    // the mandatory account-specific opening hook).
    const metro2FlagDetail = req.metro2Flags.length > 0
      ? `\n=== VERIFIED METRO 2 FINDINGS — REFERENCE EACH IN PART 1 OR PART 2 ===\n` +
        req.metro2Flags.map((flag, i) =>
          `Finding ${i + 1}: Field "${flag.fieldCode}" — ${flag.description} (Severity: ${flag.severity}; FCRA basis: ${flag.fcraReference})`
        ).join('\n')
      : '';
    const dataPointsSection = dna.specificDataPoints.length > 0
      ? `\n=== MANDATORY DATA POINTS — WEAVE EVERY ITEM INTO THE BODY ===\n` +
        dna.specificDataPoints.map((dp) => `- ${dp}`).join('\n')
      : '';
    const userPrompt = [
      buildWorldClassUserPrompt(req, factBlock, metro2Narrative),
      `=== ESCALATION POSTURE (PASS ${req.passNumber}) ===\n${strategy.posture}\n${strategy.objectiveInstruction}`,
      `=== ACCOUNT-SPECIFIC OPENING HOOK (MANDATORY) ===\nOpen on this verified factual hook or a concrete fact adjacent to it — never a statute, never "I am writing": "${dna.uniqueOpeningHook}"`,
      metro2FlagDetail || null,
      dataPointsSection || null,
      `=== GEOMETRY & CADENCE FOR THIS GENERATION ===\nTarget ${entropyMix.paragraphCount} body paragraphs. Closing demand phrasing style: "${entropyMix.demandPhrasing}". ${entropyMix.legalCitationFormat === 'parenthetical' ? 'Place citations parenthetically after claims.' : 'Weave citations inline into sentences.'}`,
      `=== CITATION ROTATION ===\nUse ${citation.citation} (${citation.proseForm}) where legally relevant. Account suffix ${factBlock.accountSuffix || 'unavailable'} and creditor ${factBlock.creditorName} must appear in the body.`,
      bureauPayload || null,
      metro2TargetingLayer || null,
      frivolousPreemption || null,
      `=== CONSUMER / DATE CONTEXT (DO NOT PRINT IN BODY) ===\nConsumer: ${req.consumerName} · ${req.consumerAddress} · Date: ${req.todayDate} · Cross-Bureau Confidence: ${req.account.confidenceScore}%${req.account.healingFlags.length ? ` · Healing Flags: ${req.account.healingFlags.join(', ')}` : ''}`,
    ].filter((section): section is string => Boolean(section)).join('\n\n');

    const rawBody = await routeAIRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        taskType: 'letter',
        // World-Class Stage 3: controlled temperature band 0.60–0.70.
        // Retries must NOT escalate temperature — higher creativity breeds
        // hallucination and repeat style traps (Roadmap §1.1).
        temperature: Math.min(0.7, Math.max(0.6, 0.65 + (attempt - 1) * 0.05)),
        maxTokens: 1600,
      }
    );

    // Head-Chopper Failsafe: strip common boilerplate openings AND closings
    let cleanBody = rawBody
      .replace(/^(I am writing to formally dispute|I am writing to dispute|I am writing regarding|This letter is to|I am contacting you|I am hereby).*?\n/i, '')
      .replace(/^(Dear .*?:|To Whom It May Concern:|Re:|RE:).*?\n/i, '')
      .trim();
    // Strip boilerplate closings that models add despite explicit instructions
    cleanBody = cleanBody
      .replace(/\n(Sincerely|Respectfully|Thank you for your attention|I look forward to|Please feel free to contact|Yours truly|Best regards)[^\n]*/gi, '')
      .trim();

    cleanBody = normalizeConsumerVoice(cleanBody);
    cleanBody = stripLetterBodyPreamble(cleanBody);

    // Best-effort first-person voice repair — NON-TERMINAL (Roadmap §1.1/§2.1).
    // The old throw-and-abort chain (voice → length → citations → boilerplate →
    // anchors → fabrication, each a fatal exception) is replaced by the
    // LetterGenerationOrchestrator's Stage-5 diagnostics + Stage-6 targeted
    // repair + Stage-7 deterministic fallback. This generator returns its best
    // draft; the orchestrator owns pass/fail.
    const voiceIssues = validateConsumerVoice(cleanBody).filter(issue => issue.severity !== 'hard_block');
    if (voiceIssues.length > 0) {
      try {
        cleanBody = await repairConsumerVoice(cleanBody, voiceIssues.map(issue => issue.message));
      } catch (repairErr) {
        console.warn('[LetterGeneratorV2] Best-effort voice repair unavailable; returning unrepaired draft to orchestrator.', repairErr);
      }
    }

    // Soft, non-fatal telemetry only — the orchestrator re-evaluates every gate.
    const anchorCheck = assertFactualAnchorsPresent(cleanBody, factBlock, req.passNumber);
    if (!anchorCheck.ok) {
      console.warn('[LetterGeneratorV2] Missing factual anchors (orchestrator will repair):', anchorCheck.missingAnchors);
    }
    assertLegalCitations(cleanBody, strategy.legalAnchors);
    if (req.item) {
      const fab = guardLetterAgainstFabrication({ letterText: cleanBody, item: req.item });
      if (!fab.ok) {
        console.warn('[LetterGeneratorV2] Anti-fabrication findings (orchestrator will hard-block/fallback):',
          fab.findings.filter((f) => f.severity === 'block').map((f) => f.message));
      }
    }

    return {
      body: cleanBody,
      persona: persona.id,
      passNumber: req.passNumber,
      bureau: req.bureau,
      metro2FlagsUsed: req.metro2Flags,
      requiresDisclosure: false,
      generatedAt: new Date().toISOString(),
    };
  }, { resolveNullOnExhaustion: true });
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function generateDisclosureLetter(req: DisputeLetterRequest, attempt: number): Promise<string> {
  const maskedToken = req.account.reconstructedAccountNumber || '[masked / not supplied]';
  const isPass1Pivot = req.passNumber === 1;

  const pivot = isPass1Pivot
    ? buildPass1DisclosurePivotPrompt({
        creditorName: req.account.creditorName,
        maskedAccountNumber: maskedToken,
        bureau: req.bureau,
        factualNarrative:
          `The tradeline reported for ${req.account.creditorName} appears on my ${req.bureau.toUpperCase()} file, ` +
          `but the account number is truncated or masked as ${maskedToken}. Without a complete identifier I cannot ` +
          `audit, verify, or meaningfully challenge the entry as reported.`,
        balance: req.account.balance,
        dateOpened: req.account.dateOpened ?? null,
      })
    : null;

  const systemContent = pivot
    ? `${pivot.system}\n\n${CONSUMER_VOICE_POLICY}`
    : 'Draft a first-person consumer file-disclosure request using only supplied facts. ' +
      `${CONSUMER_VOICE_POLICY} Keep the request concise and specific.`;

  const userContent = pivot?.user ?? buildDisclosureDemandPrompt(req);

  const rawBody = await routeAIRequest(
    [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent },
    ],
    {
      taskType: 'legal_demand',
      temperature: 0.5 + (attempt - 1) * 0.05,
      maxTokens: 1200,
    }
  );
  const normalized = normalizeConsumerVoice(rawBody);
  if (validateConsumerVoice(normalized).length > 0) {
    return repairConsumerVoice(normalized, ['Use first-person consumer voice and remove representative wording.']);
  }
  return normalized.trim();
}

async function repairConsumerVoice(text: string, issues: string[]): Promise<string> {
  const repaired = await routeAIRequest(
    [
      { role: 'system', content: `${CONSUMER_VOICE_POLICY}\nRewrite only to fix the listed voice issues. Preserve every supplied fact, account token, date, amount, and requested remedy. Output only the repaired body.` },
      { role: 'user', content: `ISSUES:\n${issues.map(issue => `- ${issue}`).join('\n')}\n\nDRAFT:\n${text}` },
    ],
    { taskType: 'letter', temperature: 0.1, maxTokens: 1800 },
  );
  return normalizeConsumerVoice(repaired);
}

function assertMinimumLength(text: string, minChars: number): void {
  if (text.trim().length < minChars) {
    throw new Error(`Letter too short: ${text.trim().length} chars (minimum ${minChars})`);
  }
}

function assertNonGenericOpening(text: string): void {
  const firstSentence = text.trim().split(/(?<=[.!?])\s+|\n+/)[0] ?? '';
  if (
    /^(?:pursuant to (?:15\s*u\.?s\.?c\.?|the (?:fcra|fair credit reporting act))|i am writing(?: to| regarding)|this letter (?:is|serves)|this is (?:a|my) formal dispute|i hereby dispute|please investigate)/i
      .test(firstSentence)
  ) {
    throw new Error(`Template-regression opener detected: "${firstSentence.slice(0, 120)}"`);
  }
}

function assertNoLawInOpeningParagraph(text: string): void {
  const openingParagraph = text.trim().split(/\n\s*\n/)[0] ?? '';
  if (
    /\bpursuant\b|§|\b(?:15\s+)?u\.?\s*s\.?\s*c\.?\b|\bFCRA\b|\bFair Credit Reporting Act\b|\bstatut(?:e|ory)\b/i
      .test(openingParagraph)
  ) {
    throw new Error(
      `Law or statutory citation detected in opening paragraph: "${openingParagraph.slice(0, 160)}"`
    );
  }
}

function assertTelephoneConsentRevocation(text: string): void {
  const hasRevocation = /\b(revoke|withdraw|rescind|terminate)\b/i.test(text);
  const coversCalls = /\b(call|calls|calling|telephone|phone|voice)\b/i.test(text);
  const coversAutomatedContact = /\b(automated|autodialed|prerecorded|artificial voice|text|sms)\b/i.test(text);
  const requiresWriting = /\b(in writing|written communications?|mail)\b/i.test(text);
  if (!hasRevocation || !coversCalls || !coversAutomatedContact || !requiresWriting) {
    throw new Error('Telephone-consent revocation is missing or incomplete.');
  }
}

function assertLegalCitations(text: string, requiredAnchors: string[]): void {
  const hasAnyCitation = requiredAnchors.some((anchor) =>
    text.toLowerCase().includes(anchor.toLowerCase().replace('§', ''))
  );
  if (!hasAnyCitation) {
    console.warn('[CitationCheck] Letter generated without expected legal anchors:', requiredAnchors);
  }
}

// ─── Task 4: Section 623 Direct-to-Furnisher Capability ──────────────────────
// Generates a dispute letter directed at the creditor/furnisher directly,
// bypassing the bureaus entirely. Cites 15 U.S.C. § 1681s-2(a)(8).

export interface FurnisherLetterRequest {
  account: HealedAccount;
  furnisherName: string;         // e.g. "LVNV Funding LLC"
  furnisherAddress: string;
  furnisherCity: string;
  furnisherState: string;
  furnisherZip: string;
  bureau: 'experian' | 'equifax' | 'transunion';
  consumerName: string;
  consumerAddress: string;
  todayDate: string;
  passNumber?: 1 | 2 | 3;       // Optional escalation round (defaults to 1)
  profileId?: string;
}

export interface FurnisherLetterResult {
  body: string;
  furnisherName: string;
  bureau: string;
  passNumber: number;
  generatedAt: string;
}

function buildFurnisherPrompt(req: FurnisherLetterRequest): string {
  const pass = req.passNumber ?? 1;
  const typeOfNegative = req.account.status || 'derogatory account';

  const escalationLayer =
    pass === 1
      ? `ROUND 1 POSTURE: Discovery and demand. Cite §1681s-2(a)(8) to open the direct-dispute channel. ` +
        `This is the consumer's first direct dispute with the furnisher. Tone: firm and procedural.`
      : pass === 2
      ? `ROUND 2 POSTURE: Attack furnisher's failure to investigate Round 1 dispute. ` +
        `Under §1681s-2(b)(1)(A), upon receiving notice of a dispute from a CRA, the furnisher ` +
        `must conduct an investigation and report results. Demand written proof the investigation ` +
        `occurred and the source documents reviewed. Tone: accusatory, compliance-audit language.`
      : `ROUND 3 POSTURE: Pre-litigation final demand. All furnisher remedies exhausted. ` +
        `Reference both prior direct dispute rounds. State intent to file CFPB complaint and civil action ` +
        `under §1681n within 15 days absent written confirmation of correction or deletion. ` +
        `Tone: concise, precise, first-person consumer follow-up.`;

  const entropyAddendum = buildEntropySystemAddendum();

  return `
=== DIRECT FURNISHER DISPUTE — 15 U.S.C. § 1681s-2(a)(8) ===
ROUND: ${pass} of 3
DATE: ${req.todayDate}
CONSUMER: ${req.consumerName}
ADDRESS: ${req.consumerAddress}
FURNISHER / CREDITOR TARGET: ${req.furnisherName.toUpperCase()}

=== ACCOUNT DATA (VERIFIED) ===
Creditor / Furnisher: ${req.account.creditorName}
Account Number: ${req.account.reconstructedAccountNumber ?? '[MASKED — DEMAND FULL ACCOUNT NUMBER IN RESPONSE]'}
Account Type: ${typeOfNegative}
Reported Balance: ${req.account.balance}
Account Status: ${req.account.status}
Date Opened: ${req.account.dateOpened ?? 'Not Reported'}
DOFD: ${req.account.dateOfFirstDelinquency ?? 'Not Reported'}
Bureau Reporting To: ${req.bureau.toUpperCase()}

=== YOUR OBJECTIVE ===
This is a Direct Dispute letter addressed to the creditor/furnisher — NOT to a credit reporting
agency. The controlling statute is 15 U.S.C. § 1681s-2(a)(8), which grants consumers the right
to dispute information directly with the furnisher. You MUST structure the letter around these
mandatory demands:

1. SECOND-PARAGRAPH STATUTORY PIVOT: After a fact-only opening paragraph, invoke
   15 U.S.C. § 1681s-2(a)(8)(D) — the furnisher's duty to conduct a reasonable investigation
   of direct disputes and correct or delete inaccurate information within 30 days of receipt.

2. PRODUCTION DEMAND — OR DELETE: Demand that the furnisher produce, within 30 days:
   (a) The original signed credit agreement or contract bearing the consumer's signature;
   (b) A complete payment history ledger from account inception to charge-off or last activity,
       including each payment date, amount, and resulting balance;
   (c) The chain-of-assignment documentation if the debt was sold or transferred (each assignment
       agreement naming buyer and seller, and the balance transferred);
   (d) Documentation establishing the Date of First Delinquency (DOFD) with the original creditor.
   State explicitly: if the furnisher CANNOT produce all four documents above, the information is
   unverifiable and must be IMMEDIATELY deleted from all credit reporting databases under
   § 1681s-2(a)(8)(E)(i).

3. CEASE REPORTING DEMAND: Until the furnisher completes the investigation and produces the
   required documentation, it must mark this tradeline with Metro 2 Compliance Condition Code "XB"
   (account in dispute). Continued reporting without this code during an active dispute is an
   independent violation of § 1681s-2(a)(1)(A).

4. DOFD VERIFICATION: Demand specific documentation proving the Date of First Delinquency has
   not been re-aged. The 7-year reporting clock under FCRA § 605(a) runs from the DOFD with the
   original creditor — not from any subsequent sale or assignment date.

5. BALANCE VERIFICATION: For charge-off accounts, demand the original charge-off amount and
   documentation of every fee or interest amount added post-charge-off, and the contractual
   authority for each addition. Any unauthorized post-charge-off balance increase is a potential
   FDCPA § 807 violation.

${escalationLayer}

${entropyAddendum}

=== STRUCTURAL REQUIREMENTS ===
1. Open with a concrete account fact or prior-round failure. Never begin with "Pursuant to,"
   "I am writing," "This letter," or "This is a formal dispute."
2. Follow the single bullet, numbered, or narrative geometry selected by the entropy directives.
   Do not force numbering when another geometry was selected.
3. Close with a hard 30-day deadline with explicit consequences for non-response.
4. Include a newly worded revocation of consent to calls, prerecorded/artificial-voice calls,
   and automated texts concerning this account; require future communication in writing.
5. Letter body only — no date headers, no address blocks, no signature lines.
6. Never use the words "request" or "ask" — use "demand," "require," or "direct."

Generate the direct furnisher dispute letter body now. Raw letter content only.
`.trim();
}

export async function generateFurnisherLetter(
  req: FurnisherLetterRequest
): Promise<FurnisherLetterResult> {
  const taskId = `furnisher-${req.account.id}-${req.furnisherName}-pass${req.passNumber ?? 1}`;

  // World-Class §6.1: exhausted AI retries resolve null → deterministic fallback via orchestrator.
  return apiQueueManager.enqueue(taskId, async (attempt) => {
    const systemPrompt =
      'Draft a first-person consumer direct dispute to a creditor or data furnisher. ' +
      `${CONSUMER_VOICE_POLICY} ` +
      'The letter creates a clear record of the consumer\'s specific dispute and requested correction. ' +
      'Output is formal legal document body text only. No boilerplate. No hedging. No courtesy language. ' +
      "FIRST PARAGRAPH RULE: You are strictly FORBIDDEN from citing ANY laws, statutes, or U.S.C. codes in the opening paragraph. Do not use the word 'Pursuant' or the '§' symbol in the introduction. The first paragraph MUST ONLY contain the factual narrative of the error and the account details. You may unleash the legal citations (15 U.S.C., FCRA, etc.) heavily in paragraphs 2 and 3 to enforce the escalation matrix. " +
      'Every sentence must serve a legal or evidentiary purpose. Generic openers are forbidden: ' +
      'never begin with "Pursuant to," "I am writing," "This letter," or "This is a formal dispute." ' +
      'Follow the generation-specific geometry and fact order, preserve the Round 1/2/3 escalation posture, ' +
      'and include a freshly worded revocation of telephone and automated-text consent.';

    const userPrompt = buildFurnisherPrompt(req);

    const rawBody = await routeAIRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        taskType: 'legal_demand',
        temperature: 0.6 + (attempt - 1) * 0.05,
        maxTokens: 1600,
      }
    );

    let cleanBody = rawBody
      .replace(/^(I am writing to|This letter is to|Dear .*?:|To Whom It May Concern:).*?\n/i, '')
      .replace(/\n(Sincerely|Respectfully|Thank you|I look forward|Best regards)[^\n]*/gi, '')
      .trim();

    cleanBody = normalizeConsumerVoice(cleanBody);
    const furnisherVoiceIssues = validateConsumerVoice(cleanBody);
    if (furnisherVoiceIssues.length > 0) {
      cleanBody = await repairConsumerVoice(cleanBody, furnisherVoiceIssues.map(issue => issue.message));
    }
    assertMinimumLength(cleanBody, 250);
    assertLegalCitations(cleanBody, [
      '1681s-2', '§ 1681s', 'section 623', '1681s', 'direct dispute',
    ]);

    return {
      body: cleanBody,
      furnisherName: req.furnisherName,
      bureau: req.bureau,
      passNumber: req.passNumber ?? 1,
      generatedAt: new Date().toISOString(),
    };
  }, { resolveNullOnExhaustion: true }) as Promise<FurnisherLetterResult>;
}
