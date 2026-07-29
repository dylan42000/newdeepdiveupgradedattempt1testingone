import type { NegativeItem } from '../types';
import type { UnifiedTradeline } from './tradelineMerger';
import { isAccountNumberIncomplete, resolvePostProcessedAccountNumber } from './tradelineMerger';

export type LetterGeometry = 'bullets' | 'numbered' | 'narrative';

export interface Metro2Finding {
  field: string;
  issue: string;
  reportedValue?: string;
  expectedValue?: string;
}

export interface DisputePromptRequest {
  tradeline: Pick<UnifiedTradeline, 'creditorName' | 'accountNumber' | 'balance' | 'dateOpened' | 'dateOfFirstDelinquency'> | NegativeItem;
  bureau: 'Equifax' | 'Experian' | 'TransUnion' | string;
  pass: 1 | 2 | 3 | 4 | 5 | 6;
  factualNarrative: string;
  metro2Findings: Metro2Finding[];
  previousDisputeSummary?: string;
  geometry?: LetterGeometry;
  /**
   * When true on Pass 1, force Verification-of-Information / Disclosure Demand
   * instead of a standard accuracy challenge (masked or incomplete account number).
   */
  disclosurePivot?: boolean;
}

const geometries: LetterGeometry[] = ['bullets', 'numbered', 'narrative'];

/** Shared policy appended to every LLM letter-generation system instruction. */
export const DISPUTE_PROMPT_SYSTEM_POLICY = `
Write as the named consumer in first-person singular. Lead with account-specific facts and the exact disputed field. Legal citations may appear where naturally useful, but paragraph ordering is a style preference and never a reason to discard an accurate draft.
Discuss only supplied Metro 2 evidence; never invent a field violation or expected value.
Do not claim a complaint, lawsuit, telephone contact, or external action occurred unless supplied history confirms it.
Use the selected geometry and vary factual order without changing meaning. Prioritize clarity, truthful specificity, and an investigation-ready request.`.trim();

/**
 * Pass 1 Account Disclosure Pivot — Verification of Information Demand.
 * Applied when the post-stitch account string still contains masks or lacks 4 trailing digits.
 */
export const PASS1_DISCLOSURE_PIVOT_POLICY = `
PASS 1 PIVOT — VERIFICATION OF INFORMATION / DISCLOSURE DEMAND (NOT a standard accuracy challenge):
- NO-LAW FIRST PARAGRAPH: Paragraph one must be a strictly factual consumer opening narrative. Forbidden in paragraph one: any statute cite, "Pursuant to", "15 U.S.C.", "FCRA", or the "§" symbol.
- PARAGRAPH TWO (MANDATORY): Explicitly include language substantially equivalent to:
  "I am attempting to review my credit file, but the account number for [Creditor Name] has been truncated/masked to [Insert Masked String]. I cannot legally identify, audit, or verify a record that is hidden from me. Provide unmasked documentation or delete this unidentifiable entry immediately."
- Demand unmasked identifying documentation sufficient for the consumer to audit the tradeline, or immediate deletion of the unidentifiable entry.
- Do not frame this as a routine accuracy dispute about balance or status; the core defect is the truncated/masked account identifier.
- Passes 2–6 will resume the planned legal escalation matrix after this Pass 1 opener; do not preempt those later strategies here.`.trim();

export function selectLetterGeometry(random = Math.random): LetterGeometry {
  return geometries[Math.floor(random() * geometries.length)] ?? 'narrative';
}

function resolveAccountNumber(
  account: DisputePromptRequest['tradeline'],
): string {
  if ('accountNumber' in account && account.accountNumber) return String(account.accountNumber);
  if ('fullAccountNumber' in account && account.fullAccountNumber) return String(account.fullAccountNumber);
  return '';
}

/** Whether Pass 1 should automatically pivot to disclosure/verification for this item. */
export function shouldPivotPass1ToDisclosure(
  item: NegativeItem | { accountNumber?: string | null; fullAccountNumber?: string | null },
  pass: number,
): boolean {
  if (pass !== 1) return false;
  const token = 'id' in item && typeof (item as NegativeItem).id === 'string'
    ? resolvePostProcessedAccountNumber(item as NegativeItem)
    : String(
      (item as { fullAccountNumber?: string | null }).fullAccountNumber
      || (item as { accountNumber?: string | null }).accountNumber
      || '',
    );
  return isAccountNumberIncomplete(token);
}

/**
 * Constructs provider-neutral instructions.  It deliberately requires verifiable,
 * record-specific statements and tells the model not to turn a Metro 2 observation
 * into a claim unless supplied by the audit layer.
 */
export function buildDisputePrompt(request: DisputePromptRequest): { system: string; user: string; geometry: LetterGeometry } {
  const geometry = request.geometry ?? selectLetterGeometry();
  const account = request.tradeline;
  const accountNumber = resolveAccountNumber(account);
  const disclosurePivot = Boolean(request.disclosurePivot) && request.pass === 1;
  const findings = request.metro2Findings.length
    ? request.metro2Findings.map((finding, index) => `${index + 1}. ${finding.field}: ${finding.issue}${finding.reportedValue ? ` (reported: ${finding.reportedValue})` : ''}${finding.expectedValue ? ` (expected: ${finding.expectedValue})` : ''}`).join('\n')
    : 'No Metro 2 finding was supplied. Do not invent one.';
  const layout = geometry === 'bullets'
    ? 'Use concise bullet points for the disputed data fields.'
    : geometry === 'numbered'
      ? 'Use a numbered list for the disputed data fields.'
      : 'Use connected narrative paragraphs; do not use a list.';

  const passSpecificSystem = disclosurePivot
    ? PASS1_DISCLOSURE_PIVOT_POLICY
    : `PARAGRAPH TWO: Discuss only the supplied Metro 2 findings. When present, frame L22/DOFD re-aging, Account Status Code conflicts, and K1-segment omissions as reported-data discrepancies requiring review; do not fabricate field values. Later paragraphs may state applicable rights in accurate, restrained language.`;

  const system = `You draft a precise first-person consumer credit-report dispute letter from supplied facts only. Do not make legal conclusions, promise results, threaten litigation, or state that a complaint was filed unless the supplied record says so.

OPENING (NO-LAW FIRST PARAGRAPH): Prefer an account-specific factual opening. Paragraph one must NOT cite statutes, use "Pursuant to", or include the "§" symbol. A useful, accurate draft must not fail solely because a restrained citation appears early — but for Pass 1 disclosure pivots the No-Law rule is strict.

${passSpecificSystem}

VARIABLE GEOMETRY: ${layout} Do not blend geometries. Use fresh wording, a distinct factual ordering, and account-specific details. Do not try to evade or bypass any review system; clarity and factual specificity are required.

${DISPUTE_PROMPT_SYSTEM_POLICY}`;

  const pivotUserBlock = disclosurePivot
    ? `
PASS 1 DISCLOSURE PIVOT ACTIVE:
Creditor Name: ${account.creditorName}
Masked Account String: ${accountNumber || 'fully masked / not supplied'}
Paragraph two MUST include language like: "I am attempting to review my credit file, but the account number for ${account.creditorName} has been truncated/masked to ${accountNumber || '[masked]'}. I cannot legally identify, audit, or verify a record that is hidden from me. Provide unmasked documentation or delete this unidentifiable entry immediately."
`
    : '';

  const user = `Recipient bureau: ${request.bureau}
Pass: ${request.pass} of 6
Creditor: ${account.creditorName}
Account reference: ${accountNumber ? `ending ${accountNumber.slice(-4)} (full token: ${accountNumber})` : 'not supplied'}
Balance: ${account.balance ?? 'not supplied'}
Date opened: ${account.dateOpened ?? ('originalOpeningDate' in account ? account.originalOpeningDate : null) ?? 'not supplied'}
DOFD: ${account.dateOfFirstDelinquency ?? ('originalDateOfDelinquency' in account ? account.originalDateOfDelinquency : null) ?? 'not supplied'}
${pivotUserBlock}
Factual consumer narrative for paragraph one:
${request.factualNarrative}

Metro 2 audit findings for paragraph two${disclosurePivot ? ' (secondary to the mandatory disclosure/verification language)' : ''}:
${findings}

Prior-dispute context:
${request.previousDisputeSummary ?? 'No prior-dispute context supplied.'}

Write the letter body only.`;
  return { system, user, geometry };
}

/**
 * Dedicated Pass 1 disclosure/verification prompt pair for AutoPilot intercept routing.
 */
export function buildPass1DisclosurePivotPrompt(params: {
  creditorName: string;
  maskedAccountNumber: string;
  bureau: string;
  factualNarrative: string;
  balance?: number | null;
  dateOpened?: string | null;
}): { system: string; user: string } {
  const { system, user } = buildDisputePrompt({
    tradeline: {
      creditorName: params.creditorName,
      accountNumber: params.maskedAccountNumber,
      balance: params.balance ?? null,
      dateOpened: params.dateOpened ?? null,
      dateOfFirstDelinquency: null,
    },
    bureau: params.bureau,
    pass: 1,
    factualNarrative: params.factualNarrative,
    metro2Findings: [],
    disclosurePivot: true,
  });
  return { system, user };
}
