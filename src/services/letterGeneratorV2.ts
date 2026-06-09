import { routeAIRequest } from './aiRouter';
import { apiQueueManager } from './apiQueueManager';
import { assertNoBoilerplate } from './letterValidator';
import { getPersonaForItem, buildPersonaSystemPrompt } from './personaMatrix';
import { buildDisclosureDemandPrompt } from './disclosurePromptBuilder';
import type { HealedAccount } from './accountHealingEngine';
import type { Metro2Flag } from './metro2AuditService';
import { buildLetterDNA, type LetterDNA } from './letterDNA';
import { generateEntropyMix, type EntropyMix } from './entropyLetterMixer';
import type { NegativeItem } from '../types';

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
    posture: 'Factual Challenge',
    legalAnchors: ['FCRA §611(a)(1)', 'FCRA §623(b)', 'FDCPA §809(b)'],
    tone: 'Direct, assertive, evidence-focused. No hedging.',
    objectiveInstruction:
      'Challenge the factual accuracy of the reported information. Demand the furnisher ' +
      'provide the original source documents — original signed agreement, payment history ledger, ' +
      'and charge-off notice — that verify each disputed data point. For collection accounts, ' +
      'additionally invoke FDCPA §809(b) to demand written debt validation within 30 days. ' +
      'Frame every disputed field as a specific, numbered allegation. Include the account number, ' +
      'reported balance, and status in each allegation.',
  },
  2: {
    posture: 'Procedural Pressure',
    legalAnchors: ['FCRA §611(a)(2)', 'FCRA §611(a)(5)', 'FCRA §623(b)(1)', 'FCRA §611(a)(1)'],
    tone: 'Methodical, legalistic, unyielding. Reference prior dispute explicitly.',
    objectiveInstruction:
      'Invoke the 30-day reinvestigation deadline and demand evidence it was met. ' +
      'Challenge whether the CRA conducted a "reasonable reinvestigation" as required by ' +
      '§611(a)(1) — the standard requires more than forwarding the dispute to the furnisher. ' +
      'Demand: (1) the names and contact information of all persons contacted during reinvestigation; ' +
      '(2) a copy of any documentation provided by the furnisher; ' +
      '(3) the method of verification used. Reference the prior dispute date and note that the ' +
      'account remains unresolved.',
  },
  3: {
    posture: 'Metro 2 Technical Audit',
    legalAnchors: ['FCRA §623(a)(1)', 'FCRA §623(a)(2)', 'CDIA Metro 2 Format Reporting Guidelines'],
    tone: 'Technical, field-specific, compliance-audit language. No emotional language.',
    objectiveInstruction:
      'Lead with each Metro 2 violation as a numbered compliance finding. Cite the specific ' +
      'Metro 2 field code and the CDIA reporting standard violated. Demand field-level correction ' +
      'with a specific correction for each field. Note that furnishers must report with maximum ' +
      'possible accuracy under §623(a)(1). This is a technical audit notice — treat every demand ' +
      'as a numbered finding with a corrective action required.',
  },
  4: {
    posture: 'FCRA Maximum Pressure',
    legalAnchors: ['FCRA §611(a)(6)', 'FCRA §611(a)(7)', 'FCRA §616', 'FCRA §617', 'FCRA §623(a)(2)'],
    tone: 'Firm, formal, escalatory. Signal clear awareness of legal remedies without explicit threats.',
    objectiveInstruction:
      'Invoke the furnisher\'s obligation to correct and update inaccurate information per §623(a)(2). ' +
      'Reference §611(a)(6) — the consumer\'s right to a description of the procedure used to determine ' +
      'accuracy. Cite §611(a)(7) — the right to a notice of reinvestigation results. Explicitly note ' +
      'that continued reporting of disputed inaccurate information after notice constitutes willful ' +
      'noncompliance under §616. If DOFD suggests this account is approaching the 7-year reporting ' +
      'window, note the re-aging risk and cite the prohibition on re-aging under FCRA §605(a)(4). ' +
      'Demand written confirmation of corrective action within 15 days.',
  },
  5: {
    posture: 'Legal Ultimatum + CFPB Complaint Notice',
    legalAnchors: ['FCRA §616', 'FCRA §617', 'FCRA §621', 'CFPB Complaint Authority', 'FTC Guidelines'],
    tone: 'Cold, precise, final notice language. Zero emotional content. Enumerate statutory damages explicitly.',
    objectiveInstruction:
      'This is the final demand before regulatory and legal escalation. Enumerate statutory damages: ' +
      '§616 provides $100–$1,000 per willful violation plus punitive damages and attorney fees; ' +
      '§617 provides actual damages for negligent noncompliance. State that a CFPB complaint has ' +
      'been filed or will be filed within 5 business days and that the relevant state attorney general ' +
      'has been notified. Reference all prior dispute rounds and the failure to resolve. Give a 30-day ' +
      'final response deadline. Do not threaten — state remedies as matter-of-fact.',
  },
  6: {
    posture: 'Pre-Litigation Statutory Demand',
    legalAnchors: ['FCRA §616', 'FCRA §617', 'FCRA §611', 'FCRA §623', '15 U.S.C. § 1681n', '15 U.S.C. § 1681o'],
    tone: 'Surgical, cold, attorney-like. Every sentence is a legal statement of fact. Zero filler.',
    objectiveInstruction:
      'Pre-litigation statutory demand. All administrative remedies exhausted through five prior ' +
      'dispute rounds. Cite the specific dates of each round. Calculate and state potential statutory ' +
      'damages: §1681n(a)(1) — $100 to $1,000 per willful violation per occurrence; §1681n(a)(2) — ' +
      'punitive damages as the court deems appropriate; §1681n(a)(3) — costs and reasonable attorney\'s ' +
      'fees. Give a firm 15-day deadline for written confirmation of deletion or correction. State that ' +
      'failure to respond will result in referral to legal counsel for federal civil action. Include a ' +
      'demand for preservation of all records related to this account.',
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
  'Use standalone em-dash bullet points (—) for each demand item, with no sub-numbering. ' +
    'Each bullet must be a complete, self-contained legal statement.',
  'Use a strict numbered list (1. 2. 3.) for all demands, with lettered sub-items ' +
    '(a. b.) for supporting facts. The hierarchy must be visually clear.',
  'Use inline numbered demands woven into prose paragraphs — not as a separate list. ' +
    'Each demand is embedded as "(1) ... (2) ... (3) ..." within the sentence.',
  'Use a hybrid: prose for the opening violation statement, then a compact numbered ' +
    'demand list, then prose for the closing statutory notice.',
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
  'Begin with a direct statement of the specific statutory violation — name the exact ' +
    'statute section and the specific data field that violates it in the opening sentence.',
  'Begin with the specific account data that is factually incorrect — state what is ' +
    'reported versus what is accurate in the opening sentence, then anchor it to statute.',
  'Begin with the legal right being invoked — state the specific code section and the ' +
    'right it grants the consumer before any factual allegation.',
] as const;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildEntropySystemAddendum(): string {
  const synonymSet = {
    reinvestigation: pickRandom(LEGAL_SYNONYM_POOLS.reinvestigation),
    inaccurate: pickRandom(LEGAL_SYNONYM_POOLS.inaccurate),
    demand: pickRandom(LEGAL_SYNONYM_POOLS.demand),
    violation: pickRandom(LEGAL_SYNONYM_POOLS.violation),
    immediately: pickRandom(LEGAL_SYNONYM_POOLS.immediately),
  };

  return `
=== ANTI-TEMPLATE ENTROPY DIRECTIVES (MANDATORY — NON-NEGOTIABLE) ===

These directives exist to ensure this letter is structurally and lexically unique. ' +
'e-OSCAR OCR systems flag duplicate structural patterns as frivolous. Violating these ' +
'directives will cause this letter to fail its purpose.

DIRECTIVE A — MANDATORY LEGAL SYNONYMS FOR THIS GENERATION:
You MUST use the following terms instead of their generic equivalents throughout this letter:
  - Use "${synonymSet.reinvestigation}" instead of "investigation" or "review"
  - Use "${synonymSet.inaccurate}" instead of "wrong" or "incorrect"
  - Use "${synonymSet.demand}" instead of "request" or "ask"
  - Use "${synonymSet.violation}" instead of "error" or "problem"
  - Use "${synonymSet.immediately}" instead of "now" or "promptly"

DIRECTIVE B — STRUCTURAL FORMAT FOR THIS GENERATION:
${pickRandom(STRUCTURE_FORMATS)}

DIRECTIVE C — CITATION SEQUENCING FOR THIS GENERATION:
${pickRandom(CITATION_SEQUENCES)}

DIRECTIVE D — OPENING CONSTRAINT FOR THIS GENERATION:
${pickRandom(OPENING_CATEGORIES)}

DIRECTIVE E — CITATION RANDOMIZATION:
Do NOT cite legal sections in the same order they appear in the brief. Reorder citations ' +
'within each paragraph to create a unique citation fingerprint. The legal argument must ' +
'hold together regardless of citation order.

DIRECTIVE F — PARAGRAPH ARCHITECTURE:
No two paragraphs may begin with the same word or phrase. Vary sentence length ' +
'aggressively — mix short declarative sentences with longer compound-complex legal ' +
'constructions. This creates a unique syntactic fingerprint that defeats OCR pattern matching.
`.trim();
}

// ─── Directive 2: Bureau-Specific Legal Payload ───────────────────────────────
// Injects bureau-specific historical compliance failures and legal obligations.
// This proves to e-OSCAR that the letter is account-specific, not a template.

function buildBureauPayload(bureau: DisputeLetterRequest['bureau']): string {
  switch (bureau) {
    case 'equifax':
      return `
=== EQUIFAX-SPECIFIC COMPLIANCE BURDEN ===
This dispute is directed to Equifax, which operates under heightened compliance obligations ' +
'established through federal enforcement actions. Specifically:

1. CFPB Enforcement History: Equifax has been subject to multiple CFPB enforcement actions ' +
'regarding its failure to maintain reasonable procedures for assuring maximum possible accuracy ' +
'of consumer credit information. These actions establish that "reasonable reinvestigation" under ' +
'FCRA §611(a)(1) requires Equifax to do more than forward the dispute to the furnisher via e-OSCAR ' +
'and accept the furnisher\'s unverified response.

2. Heightened Verification Standard: Following prior federal consent orders, Equifax is required ' +
'to maintain procedures that independently verify disputed information — not merely relay it. ' +
'A "verified" response that consists solely of the furnisher confirming its own data does not ' +
'satisfy the reasonable reinvestigation standard.

3. Data Accuracy Obligation: Under FCRA §607(b), Equifax must follow reasonable procedures to ' +
'assure maximum possible accuracy. The disputed account data below demonstrates a failure of ' +
'this obligation that creates independent liability under §616 and §617.

The letter below should reference Equifax\'s specific obligation to conduct an independent ' +
'verification — not a forwarded e-OSCAR query — in response to this dispute.
`.trim();

    case 'experian':
      return `
=== EXPERIAN-SPECIFIC COMPLIANCE BURDEN ===
This dispute is directed to Experian, which carries specific statutory obligations distinct ' +
'from other consumer reporting agencies:

1. Mandatory 4-Business-Day Blocking Obligation: Under FCRA §611(a)(5)(B), if a consumer ' +
'disputes information and provides documentation that the information is the result of ' +
'identity theft or is demonstrably inaccurate, Experian must block that information within ' +
'4 business days of receipt. Failure to comply is an independent violation under §616.

2. Unverifiable Information Standard: Experian\'s own internal procedures, as documented in ' +
'prior FTC advisory opinions, acknowledge that information that cannot be independently ' +
'verified by the furnisher must be deleted under §611(a)(5)(A). This letter demands ' +
'Experian invoke this provision if the furnisher cannot produce original source documentation.

3. e-OSCAR Auto-Verify Prohibition: Experian\'s use of e-OSCAR automated dispute processing ' +
'does not satisfy "reasonable reinvestigation" when the furnisher\'s verification consists ' +
'solely of affirming the data already in its system without producing the underlying source ' +
'documents demanded in this dispute.

The letter below should reference Experian\'s §611(a)(5) blocking obligation and the ' +
'4-business-day deadline as a specific, actionable demand.
`.trim();

    case 'transunion':
      return `
=== TRANSUNION-SPECIFIC COMPLIANCE BURDEN ===
This dispute is directed to TransUnion, which has documented compliance deficiencies ' +
'relevant to this account:

1. Mixed-File and Matching Criteria Failures: TransUnion has been repeatedly cited by ' +
'federal regulators for insufficient consumer-matching criteria — specifically, the use of ' +
'partial SSN matching and name-variant matching that result in files containing accounts ' +
'belonging to other consumers. This dispute demands that TransUnion confirm the matching ' +
'criteria used to associate this account with the consumer\'s file.

2. SCOTUS Civil Liability Precedent: In TransUnion LLC v. Ramirez, 594 U.S. 413 (2021), ' +
'the Supreme Court affirmed that consumers with inaccurate FCRA data in their credit files ' +
'that is furnished to third parties have standing for civil claims. This account\'s continued ' +
'reporting creates concrete injury establishing standing for federal civil action.

3. Reasonable Reinvestigation Standard: CFPB examination findings have documented ' +
'TransUnion\'s reliance on furnisher affirmations through e-OSCAR without independent ' +
'verification of underlying records. The reinvestigation demanded below requires TransUnion ' +
'to obtain and review the actual source documents — not merely query the furnisher ' +
'through automated dispute processing.

The letter below should reference TransUnion\'s matching criteria obligation and the ' +
'TransUnion v. Ramirez civil liability context.
`.trim();
  }
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

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildDisputePrompt(
  req: DisputeLetterRequest,
  strategy: typeof PASS_STRATEGY_MATRIX[DisputePass],
  dna: LetterDNA,
  entropyMix: EntropyMix,
  typeOfNegative: string,
): string {
  const metro2Section = req.metro2Flags.length > 0
    ? `\n\n=== METRO 2 COMPLIANCE VIOLATIONS (VERIFIED) ===\n` +
      req.metro2Flags.map((flag, i) =>
        `Finding ${i + 1}: Field "${flag.fieldCode}" — ${flag.description}\n` +
        `Severity: ${flag.severity} | FCRA Basis: ${flag.fcraReference}\n` +
        `Dispute Language: ${flag.disputeArgument}`
      ).join('\n\n')
    : '';

  const accountSection = `
=== ACCOUNT DATA (VERIFIED) ===
Creditor: ${req.account.creditorName}
Account Number: ${req.account.reconstructedAccountNumber ?? '[MASKED — §609 DISCLOSURE PATH]'}
Account Type / Negative Category: ${typeOfNegative || req.account.status}
Bureau: ${req.bureau.toUpperCase()}
Reported Balance: ${req.account.balance}
Account Status: ${req.account.status}
Date Opened: ${req.account.dateOpened ?? 'Not Reported'}
DOFD: ${req.account.dateOfFirstDelinquency ?? 'Not Reported'}
Cross-Bureau Confidence Score: ${req.account.confidenceScore}%
Healing Flags: ${req.account.healingFlags.join(', ') || 'None'}
${metro2Section}
`.trim();

  const dataPointsSection = dna.specificDataPoints.length > 0
    ? `\n=== MANDATORY DATA POINTS — WEAVE EVERY ITEM BELOW INTO THE BODY PARAGRAPHS ===\n` +
      dna.specificDataPoints.map((dp) => `- ${dp}`).join('\n')
    : '';

  const legalCitationFormatInstruction = entropyMix.legalCitationFormat === 'parenthetical'
    ? 'Parenthetical citation format: place citations in parentheses after the claim.'
    : 'Inline citation format: weave citations directly into the sentence.';

  // Directive 2: Bureau payload
  const bureauPayload = buildBureauPayload(req.bureau);

  // Directive 3: Dynamic Metro 2 targeting
  const metro2TargetingLayer = (req.passNumber === 3 || req.metro2Flags.length > 0)
    ? buildMetro2TargetingLayer(typeOfNegative, req.metro2Flags)
    : '';

  // Directive 4: Frivolous pre-emption (Passes 1–3 only)
  const frivolousPreemption = buildFrivolousPreemption(req.passNumber);

  return `
=== DISPUTE GENERATION BRIEF ===
PASS: ${req.passNumber} of 6
LEGAL POSTURE: ${strategy.posture}
CONTROLLING LAW: ${strategy.legalAnchors.join(', ')}
BUREAU TARGET: ${req.bureau.toUpperCase()}
DATE: ${req.todayDate}
CONSUMER: ${req.consumerName}
ADDRESS: ${req.consumerAddress}

DNA FINGERPRINT: ${dna.accountFingerprint}
NARRATIVE PERSONA: ${dna.narrativePersona}
LEGAL ANGLE: ${dna.legalAngle}

=== YOUR OBJECTIVE ===
${strategy.objectiveInstruction}

=== MANDATORY OPENING PROTOCOL ===

You are strictly forbidden from announcing that you are writing a letter.

You MUST start your very first sentence with one of these aggressive legal hooks:

- "${dna.uniqueOpeningHook}"
- "Pursuant to 15 U.S.C..."
- "This is a formal compliance demand regarding..."
- "I am exercising my statutory rights under..."
- "Notice of FCRA ${strategy.legalAnchors[0]} violation:..."

=== TONE AND STYLE MANDATE ===

${strategy.tone}

STRICT TONE ENFORCEMENT: The letter must read as "${dna.tonePitch}" for this entire document. Do not drift into courtesy, hedging, or neutral language.

- No introductory pleasantries, greetings, or sign-offs.
- Every factual claim must be anchored to the account data provided below.
- Every legal citation must appear in the exact format: FCRA §[section] or Metro 2 Field [code].
- ${legalCitationFormatInstruction}
- Target paragraph count: ${entropyMix.paragraphCount} body paragraphs (excluding opening/closing one-liners).

=== STRUCTURAL REQUIREMENTS ===
1. Open immediately with the specific legal violation or factual discrepancy — no preamble.
2. Each disputed item must be formatted as a numbered allegation with:
   a. The specific field or data point in dispute
   b. What is being reported
   c. Why it is inaccurate, incomplete, or in violation
   d. The specific legal or regulatory basis
   e. The exact corrective action demanded
3. Close with a specific, deadline-anchored demand for written response — no pleasantries.
   STRICT CLOSING PHRASING: "${entropyMix.demandPhrasing}"
4. Letter body only — no date headers, no address blocks, no signature lines.

${bureauPayload}

${metro2TargetingLayer}

${frivolousPreemption}

${accountSection}

${dataPointsSection}

Generate the dispute letter body now. Raw letter content only.
`.trim();
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function generateDisputeLetter(req: DisputeLetterRequest): Promise<GeneratedLetter> {
  const taskId = `dispute-${req.account.id}-${req.bureau}-pass${req.passNumber}`;

  return apiQueueManager.enqueue(taskId, async (attempt) => {
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
    const dna = req.item && req.profileId
      ? buildLetterDNA(req.item, req.passNumber, req.profileId)
      : buildLetterDNA({
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
        } as NegativeItem, req.passNumber, req.profileId ?? 'default');

    const entropyMix = generateEntropyMix(dna, req.passNumber);

    const persona = getPersonaForItem(req.account.id, req.passNumber);
    const strategy = PASS_STRATEGY_MATRIX[req.passNumber];

    // Directive 1: Combine persona system prompt with entropy addendum
    const baseSystemPrompt = buildPersonaSystemPrompt(persona);
    const entropyAddendum = buildEntropySystemAddendum();
    const systemPrompt = `${baseSystemPrompt}\n\n${entropyAddendum}`;

    const userPrompt = buildDisputePrompt(req, strategy, dna, entropyMix, typeOfNegative);

    const rawBody = await routeAIRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        taskType: 'letter',
        temperature: 0.7 + (attempt - 1) * 0.05,
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

    assertNoBoilerplate(cleanBody);
    assertMinimumLength(cleanBody, 200);
    assertLegalCitations(cleanBody, strategy.legalAnchors);

    return {
      body: cleanBody,
      persona: persona.id,
      passNumber: req.passNumber,
      bureau: req.bureau,
      metro2FlagsUsed: req.metro2Flags,
      requiresDisclosure: false,
      generatedAt: new Date().toISOString(),
    };
  }) as Promise<GeneratedLetter>;
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

async function generateDisclosureLetter(req: DisputeLetterRequest, attempt: number): Promise<string> {
  const prompt = buildDisclosureDemandPrompt(req);
  const rawBody = await routeAIRequest(
    [
      {
        role: 'system',
        content:
          'You are a consumer rights attorney drafting a §609 full-file disclosure demand. ' +
          'Your output is a formal legal document. No boilerplate. No hedging. No courtesy language. ' +
          'Every sentence must serve a legal purpose.',
      },
      { role: 'user', content: prompt },
    ],
    {
      taskType: 'legal_demand',
      temperature: 0.5 + (attempt - 1) * 0.05,
      maxTokens: 1000,
    }
  );
  assertNoBoilerplate(rawBody);
  return rawBody.trim();
}

function assertMinimumLength(text: string, minChars: number): void {
  if (text.trim().length < minChars) {
    throw new Error(`Letter too short: ${text.trim().length} chars (minimum ${minChars})`);
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
