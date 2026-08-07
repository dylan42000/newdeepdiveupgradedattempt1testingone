/**
 * bureauCalibrationEngine.ts — Bureau-Specific Letter Calibration
 * GAP-I FIX: Each credit bureau has unique internal policies, response patterns,
 * and tolerance thresholds. This engine generates bureau-specific prompt directives
 * that are appended to AI letter generation calls to maximize acceptance rates
 * and minimize "frivolous dispute" rejections.
 *
 * Based on aggregated dispute outcome data from industry practitioners:
 *   Equifax   → Responds to Metro 2 field-level challenges and technical accuracy
 *   Experian  → Responds to consumer rights framing and FCRA statute citations
 *   TransUnion → Responds to precise legal language and formal procedural arguments
 *
 * Each bureau calibration also adjusts by pass number — early passes use softer
 * language; later passes escalate tone and legal pressure proportionally.
 */

import { PassNumber } from '../types/creditRepair';

// ─── Types ────────────────────────────────────────────────────────────────────

export type BureauName = 'Equifax' | 'Experian' | 'TransUnion';

export interface BureauProfile {
  name: BureauName;
  /** Primary tone strategy for letters to this bureau */
  preferredTone: 'technical' | 'consumer-rights' | 'formal';
  /** Average calendar days this bureau takes to respond */
  averageResponseDays: number;
  /**
   * Minimum evidence/argument quality below which bureau issues a "frivolous" determination.
   * Lower = more lenient. Higher = bureau requires more substantiation.
   */
  frivolousThreshold: 'low' | 'medium' | 'high';
  /** Legal arguments this bureau is known to respond well to */
  highValueArguments: string[];
  /** Legal arguments that consistently fail with this bureau */
  lowValueArguments: string[];
  /** Known formatting preferences */
  formattingNotes: string;
}

export interface BureauCalibrationDirective {
  bureau: BureauName;
  passNumber: PassNumber;
  /** Full text appended to AI letter generation prompt */
  promptDirective: string;
  /** Expected tone of the generated letter */
  expectedTone: string;
  /** Primary legal strategy for this bureau+pass combination */
  primaryStrategy: string;
}

// ─── Bureau profiles ──────────────────────────────────────────────────────────

const BUREAU_PROFILES: Record<BureauName, BureauProfile> = {
  Equifax: {
    name: 'Equifax',
    preferredTone: 'technical',
    averageResponseDays: 28,
    frivolousThreshold: 'medium',
    highValueArguments: [
      'Metro 2 field-level inaccuracy (specific field name and expected value)',
      'FCRA §623(a)(1) — furnisher obligation to report accurate data',
      'FCRA §611(a)(1) — bureau must independently verify, not rely on furnisher confirmation',
      'Date of first delinquency cannot be re-aged (FCRA §605(c))',
      'Balance reporting must reflect most recent statement cycle',
      'Tradeline account type code mismatch (Metro 2 field 2 vs. actual account type)',
    ],
    lowValueArguments: [
      'Vague "I did not recognize this account" without specifics',
      'Emotional language or threats without legal basis',
      'Citations to FDCPA §807 (wrong law for bureau disputes)',
    ],
    formattingNotes:
      'Equifax responds best to structured letters with numbered dispute points. ' +
      'Each disputed field should be listed separately with: (1) current reported value, ' +
      '(2) correct value, (3) Metro 2 field name, (4) legal authority requiring correction.',
  },

  Experian: {
    name: 'Experian',
    preferredTone: 'consumer-rights',
    averageResponseDays: 25,
    frivolousThreshold: 'high',
    highValueArguments: [
      'FCRA §609(a)(1) — right to disclosure of all information in consumer file',
      'FCRA §611(a)(1) — investigation must be completed within 30 calendar days',
      'FCRA §611(a)(6)(B) — consumer is entitled to written results of investigation',
      'FACTA §312 — free annual report rights and accuracy requirements',
      'CFPB guidance on "reasonable reinvestigation" standard (exceeds rubber-stamp verification)',
      'Consumer has provided documentation establishing the inaccuracy (exhibit references)',
    ],
    lowValueArguments: [
      'Metro 2 technical formatting complaints (Experian handles internally)',
      'Demands for "original signed contract" without identifying specific inaccuracy',
    ],
    formattingNotes:
      'Experian responds best to consumer-rights framing. Open with a clear statement ' +
      'of consumer\'s rights under the FCRA. Reference any attached documentation early. ' +
      'The investigation request should be specific about what data is wrong and why. ' +
      'Experian has a higher frivolous threshold — generic letters are routinely dismissed.',
  },

  TransUnion: {
    name: 'TransUnion',
    preferredTone: 'formal',
    averageResponseDays: 30,
    frivolousThreshold: 'medium',
    highValueArguments: [
      'FCRA §611 — precise citation of the investigation procedure requirements',
      'FCRA §616 — civil liability for willful noncompliance ($1,000–$1,000 statutory + actual damages)',
      'FCRA §617 — negligent noncompliance exposes bureau to actual damages',
      'Furnisher CANNOT verify using the same disputed data — bureau must independently investigate',
      'Previous dispute responses do not constitute "investigation" if no new evidence reviewed',
      'Specific account number, date range, and dollar figure that is inaccurate',
    ],
    lowValueArguments: [
      'Non-specific balance disputes without supporting documentation',
      'Complaints about "negative" reporting without identifying a specific inaccuracy',
    ],
    formattingNotes:
      'TransUnion responds best to formal, legally precise correspondence. ' +
      'Use formal legal citation format (e.g., 15 U.S.C. § 1681i(a)(1)(A)). ' +
      'Avoid conversational language. State the specific statutory violation clearly. ' +
      'TransUnion\'s investigators are trained to look for procedural hooks — give them one.',
  },
};

// ─── Pass-level tone escalation ───────────────────────────────────────────────

type PassToneDescriptor = {
  tone: string;
  escalationLevel: string;
  openingInstruction: string;
};

function getPassTone(bureau: BureauName, pass: PassNumber): PassToneDescriptor {
  // Shared escalation logic with bureau-specific flavor
  const escalations: Record<PassNumber, PassToneDescriptor> = {
    1: {
      tone: 'professional and cooperative',
      escalationLevel: 'Initial dispute — non-confrontational',
      openingInstruction:
        'Open with a cooperative tone. This is the first dispute. The letter should be professional, ' +
        'fact-based, and non-accusatory. The goal is resolution through investigation.',
    },
    2: {
      tone: 'firm and persistent',
      escalationLevel: 'Second dispute — direct and evidence-backed',
      openingInstruction:
        'Reference the prior dispute and the bureau\'s response. Note that the inaccuracy persists. ' +
        'Tone should be firm but professional. Include a demand for documentary verification evidence.',
    },
    3: {
      tone: 'assertive with legal pressure',
      escalationLevel: 'Third dispute — legal rights emphasized',
      openingInstruction:
        'Escalate tone to assertive. Explicitly invoke FCRA §611 investigation standards. ' +
        'Note that two prior disputes have failed to produce proper reinvestigation. ' +
        'Demand written explanation of investigation methodology per FCRA §611(a)(7).',
    },
    4: {
      tone: 'escalated — pre-litigation warning',
      escalationLevel: 'Fourth dispute — civil liability referenced',
      openingInstruction:
        'This is a pre-litigation warning letter. Reference FCRA §616 and §617 civil liability explicitly. ' +
        'Note that continued willful or negligent non-compliance may result in legal action. ' +
        'Tone should be formal, serious, and legally precise. Include a deadline for resolution (14 days).',
    },
    5: {
      tone: 'maximum pressure — regulatory escalation',
      escalationLevel: 'Fifth dispute — CFPB/AG referral implied',
      openingInstruction:
        'This is the final pre-action letter. State that the CFPB complaint has been or will be filed. ' +
        'Reference state Attorney General consumer protection authority. ' +
        'Demand compliance within 7 days or consumer will seek all available remedies including actual, ' +
        'statutory, and punitive damages under FCRA §616.',
    },
    6: {
      tone: 'pre-litigation statutory demand — cold and precise',
      escalationLevel: 'Sixth dispute — statutory damages exposure cited, 15-day deadline',
      openingInstruction:
        'This is a pre-litigation statutory demand letter. Cite FCRA §616 ($100–$1,000 per willful violation) ' +
        'and FCRA §617 (actual damages for negligent violation) explicitly. All five prior dispute rounds are exhausted. ' +
        'Give the respondent a strict 15-day compliance deadline. Tone should be cold, formal, and legally precise — ' +
        'not angry, but conveying inevitability of legal action if unresolved.',
    },
  };

  // Bureau-specific flavor overlays
  const flavor: Partial<Record<BureauName, Partial<Record<PassNumber, Partial<PassToneDescriptor>>>>> = {
    Equifax: {
      3: { openingInstruction: escalations[3].openingInstruction + ' Request Metro 2 field-level compliance audit.' },
      4: { openingInstruction: escalations[4].openingInstruction + ' Specifically cite that Equifax\'s reinvestigation failed to address the Metro 2 reporting discrepancy raised in prior disputes.' },
    },
    Experian: {
      2: { openingInstruction: escalations[2].openingInstruction + ' Remind Experian that the "reasonable reinvestigation" standard requires more than a forwarded dispute to the furnisher.' },
      3: { openingInstruction: escalations[3].openingInstruction + ' Reference the CFPB\'s published guidance on what constitutes a reasonable reinvestigation.' },
    },
    TransUnion: {
      4: { openingInstruction: escalations[4].openingInstruction + ' Use formal U.S.C. citation format for all statute references.' },
      5: { openingInstruction: escalations[5].openingInstruction + ' Reference TransUnion, LLC v. [relevant state case if applicable] to establish litigation risk awareness.' },
    },
  };

  const base = escalations[pass];
  const bureauFlavor = flavor[bureau]?.[pass];
  return { ...base, ...bureauFlavor };
}

// ─── Core calibration engine ──────────────────────────────────────────────────

/**
 * Get the calibration directive for a specific bureau + pass combination.
 * The returned directive is appended to the AI letter generation prompt.
 *
 * @param bureau - Target bureau name
 * @param passNumber - Current dispute pass (1-5)
 * @returns BureauCalibrationDirective with full prompt text
 */
export function getBureauCalibrationDirective(
  bureau: BureauName,
  passNumber: PassNumber
): BureauCalibrationDirective {
  const profile = BUREAU_PROFILES[bureau];
  const passTone = getPassTone(bureau, passNumber);

  const highValueArgs = profile.highValueArguments
    .map((arg, i) => `  ${i + 1}. ${arg}`)
    .join('\n');

  const lowValueArgs = profile.lowValueArguments
    .map((arg, i) => `  ${i + 1}. ${arg}`)
    .join('\n');

  const promptDirective = `
BUREAU-SPECIFIC CALIBRATION DIRECTIVE — ${bureau.toUpperCase()} PASS ${passNumber}
═══════════════════════════════════════════════════════════════

TARGET BUREAU: ${bureau}
PREFERRED TONE: ${profile.preferredTone}
AVERAGE RESPONSE DAYS: ${profile.averageResponseDays}
FRIVOLOUS REJECTION THRESHOLD: ${profile.frivolousThreshold.toUpperCase()}
ESCALATION LEVEL: ${passTone.escalationLevel}

LETTER TONE: ${passTone.tone}

OPENING INSTRUCTION:
${passTone.openingInstruction}

HIGH-VALUE ARGUMENTS FOR ${bureau.toUpperCase()} (USE THESE):
${highValueArgs}

AVOID THESE ARGUMENTS WITH ${bureau.toUpperCase()} (INEFFECTIVE):
${lowValueArgs}

FORMATTING NOTES FOR ${bureau.toUpperCase()}:
${profile.formattingNotes}

CALIBRATION COMPLIANCE CHECK (verify before generating):
✓ Does the letter use ${profile.preferredTone} language?
✓ Are at least 2 high-value arguments cited with full statutory references?
✓ Is the letter specific about which data field is inaccurate and what the correct value is?
✓ Is the tone calibrated to Pass ${passNumber} escalation level?
✓ Are low-value arguments absent from the letter?

IMPORTANT: Do NOT generate a letter that is vague, emotionally charged without legal basis, or that
could be dismissed as frivolous by ${bureau}'s reinvestigation team. Be precise, factual, and legally grounded.
`.trim();

  return {
    bureau,
    passNumber,
    promptDirective,
    expectedTone: passTone.tone,
    primaryStrategy: profile.highValueArguments[0] ?? 'FCRA §611 reinvestigation',
  };
}

/**
 * Get a compact one-line calibration note for dashboard display.
 */
export function getBureauCalibrationSummary(bureau: BureauName, passNumber: PassNumber): string {
  const profile = BUREAU_PROFILES[bureau];
  const passTone = getPassTone(bureau, passNumber);
  return `${bureau}: ${passTone.tone} tone | ${profile.preferredTone} strategy | avg ${profile.averageResponseDays}d response`;
}
