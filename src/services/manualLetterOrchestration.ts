/**
 * manualLetterOrchestration.ts — World-Class §2.3 Manual UI Adapter
 *
 * Routes the manual Dispute Letters UI through the same
 * LetterGenerationOrchestrator pipeline AutoPilot uses, so manually generated
 * letters get the identical:
 *   - Stage-4 preamble stripping + first-person voice normalization
 *   - Stage-5 non-terminal diagnostics (anchors, voice, boilerplate, fabrication)
 *   - Stage-6 targeted JSON repair pass
 *   - Stage-7 deterministic fallback (Net-100% guarantee), TARGET-AWARE:
 *     a furnisher-selected letter falls back to a furnisher-direct factual
 *     letter — never a mismatched credit-bureau template.
 *
 * Multi-item selections are treated as a §5.2 Grouped Bureau Letter: sibling
 * items' facts are whitelisted in the anti-fabrication gate and enumerated in
 * the fallback's Part-1 numbered fact list.
 */

import type { DisputeRound, LetterTemplateType, NegativeItem } from '../types';
import type { HealedAccount } from './accountHealingEngine';
import {
  orchestrateLetterGeneration,
  type OrchestratedLetterResult,
} from './letterGenerationOrchestrator';
import type {
  DisputeLetterRequest,
  DisputePass,
  GeneratedLetter,
} from './letterGeneratorV2';
import { generateDisputeLetter } from './geminiService';
import { getResolvedAccountNumber } from './tradelineMerger';

const BUREAU_KEYS = ['experian', 'equifax', 'transunion'] as const;
type BureauKey = (typeof BUREAU_KEYS)[number];

function normalizeBureauKey(raw: string, fallbackItem?: NegativeItem): BureauKey {
  const lower = (raw || '').toLowerCase();
  for (const key of BUREAU_KEYS) {
    if (lower.includes(key)) return key;
  }
  const fromItem = (fallbackItem?.creditBureau?.[0] || '').toLowerCase();
  for (const key of BUREAU_KEYS) {
    if (fromItem.includes(key)) return key;
  }
  return 'equifax';
}

/**
 * True when the manual composer target is one of the three nationwide CRAs
 * (as opposed to a direct furnisher / collector target).
 */
export function isBureauTarget(target: string): boolean {
  const lower = (target || '').toLowerCase();
  return BUREAU_KEYS.some((key) => lower.includes(key));
}

// ─── Target-Aware Deterministic Fallback Renderer ─────────────────────────────

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'not clearly stated';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function roundParagraph(passNumber: number): string {
  if (passNumber === 1) return 'This is my initial written dispute concerning these specific reported fields.';
  if (passNumber === 2) return 'My earlier dispute did not resolve these specific reporting concerns. I am requesting a new review focused on the unresolved fields described above and a written explanation of the result.';
  if (passNumber === 3) return 'Prior reporting reviews have not resolved the identified discrepancy. Please investigate the underlying account-level data and notify every consumer reporting company to which an inaccurate value was furnished.';
  if (passNumber === 4) return 'The prior result did not explain how the unresolved fields were determined to be accurate. Please provide the appropriate description of the procedure used and correct or delete any information that cannot be verified.';
  if (passNumber === 5) return 'I have preserved my prior correspondence and results. I am requesting a final documented review before I decide whether to submit the complete record to the appropriate consumer-protection agency.';
  return 'This is my final written effort to resolve the documented reporting issue. Please preserve the account and dispute records and provide written confirmation of the accurate resolution. I may seek qualified legal advice if the issue remains unresolved.';
}

function itemFactLine(item: NegativeItem, index?: number): string {
  const token = getResolvedAccountNumber(item) || 'as displayed on my credit report';
  const prefix = index != null ? `${index}. ` : '';
  return (
    `${prefix}${item.creditorName} — account identifier ${token}, ` +
    `reported status "${item.status || 'not clearly stated'}"${item.typeOfNegative ? `, item type "${item.typeOfNegative}"` : ''}, ` +
    `balance ${money(item.balance)}`
  );
}

/**
 * Render a first-person, fact-grounded dispute letter for ANY manual target —
 * a nationwide CRA or a direct furnisher. No AI, no placeholders, no invented
 * facts: every figure comes from the parsed items. When several items were
 * selected, Part 1 enumerates them per the §5.2 Grouped Bureau Letter
 * formatting rule (numbered fact list, up to 5 items per letter).
 */
export function renderTargetedDeterministicLetter(
  req: DisputeLetterRequest,
  targetName: string,
  relatedItems: NegativeItem[] = [],
): GeneratedLetter {
  const allItems = [req.item, ...relatedItems].filter((i): i is NegativeItem => Boolean(i));
  const primary = req.item;
  const bureauTarget = isBureauTarget(targetName);
  const primaryToken = primary ? getResolvedAccountNumber(primary) : 'as displayed on my credit report';

  const identification = bureauTarget
    ? `My ${req.bureau} credit file reports ${req.account.creditorName} under account identifier ${primaryToken}.`
    : `You furnish information about me to the consumer reporting agencies under the name ${req.account.creditorName}, account identifier ${primaryToken}.`;

  const groupedFactList = allItems.length > 1
    ? `This letter covers ${allItems.length} reported items. The specific items I dispute are:\n${allItems
        .slice(0, 5)
        .map((it, i) => itemFactLine(it, i + 1))
        .join('\n')}`
    : '';

  const metro2Flag = req.metro2Flags[0];
  let issueParagraph: string;
  if (metro2Flag) {
    issueParagraph =
      `The specific issue I dispute is ${metro2Flag.description.replace(/\.$/, '')}. ` +
      'I am asking you to investigate that reported field using the underlying account records and correct it to the accurate value. ' +
      'If the information cannot be verified as accurate and complete, please delete the inaccurate information from my file.';
  } else if (allItems.length > 1) {
    issueParagraph =
      'I dispute the accuracy and completeness of each item listed above, including every reported status and balance shown. ' +
      'Please compare each disputed field with the underlying account records and correct any value that is inaccurate or incomplete. ' +
      'If any information cannot be verified as accurate and complete, please delete the affected reporting.';
  } else {
    const status = req.item?.status || req.account.status || 'the reported negative status';
    const balance = req.item?.balance ?? req.account.balance;
    const details = req.item?.additionalInfo?.trim();
    issueParagraph =
      `I dispute the accuracy and completeness of the reported status (${status}) and balance (${money(balance)})` +
      `${details ? ` because my report also states: ${details}` : ''}. ` +
      'Please compare each disputed field with the underlying account records and correct any value that is inaccurate or incomplete. ' +
      'If the information cannot be verified as accurate and complete, please delete the affected reporting.';
  }

  const furnisherDemand = !bureauTarget
    ? 'As the data furnisher, please investigate my dispute under 15 U.S.C. § 1681s-2(a)(8), correct any inaccurate or incomplete information, and notify every consumer reporting company to which you furnished it of the results.'
    : '';

  const closing =
    'Please send me the written results of your investigation and an updated credit report if the reporting changes. ' +
    'I am keeping a copy of this correspondence and its enclosures for my records.' +
    ' I revoke consent for automated telephone dialing systems, artificial or prerecorded voice calls, and SMS messages concerning this account; please direct all future communications to me in writing.';

  const body = [
    identification,
    groupedFactList || null,
    issueParagraph,
    furnisherDemand || null,
    roundParagraph(req.passNumber),
    closing,
  ].filter((p): p is string => Boolean(p)).join('\n\n');

  return {
    body,
    persona: bureauTarget ? 'consumer_factual_fallback' : 'consumer_factual_fallback_furnisher',
    passNumber: req.passNumber,
    bureau: req.bureau,
    metro2FlagsUsed: req.metro2Flags,
    requiresDisclosure: false,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Manual Generation Entry Point ────────────────────────────────────────────

export interface ManualLetterParams {
  items: NegativeItem[];
  mapped: { name: string; address: string; ssn: string; dob: string };
  templateType: LetterTemplateType;
  targetBureau: string;
  round: DisputeRound;
  extraInstructions?: string;
}

/**
 * Generate a manual dispute letter with the full orchestrator guarantee.
 * Throws only on programmer-contract violations (empty selection); AI or
 * provider failures NEVER throw — they resolve through Stage-6 repair or the
 * Stage-7 target-aware deterministic fallback.
 */
export async function generateManualDisputeLetterOrchestrated(
  params: ManualLetterParams,
): Promise<OrchestratedLetterResult> {
  const { items, mapped, templateType, targetBureau, round, extraInstructions = '' } = params;
  const primaryItem = items[0];
  if (!primaryItem) throw new Error('No item selected for letter generation.');

  const bureau = normalizeBureauKey(targetBureau, primaryItem);
  const passNumber = Math.min(6, Math.max(1, Number(round) || 1)) as DisputePass;

  const healedAccount: HealedAccount = {
    id: primaryItem.id,
    creditorName: primaryItem.creditorName,
    reconstructedAccountNumber:
      primaryItem.fullAccountNumber || primaryItem.accountNumber || '',
    balance: primaryItem.balance ?? 0,
    status: primaryItem.status ?? '',
    dateOpened: primaryItem.dateOpened ?? primaryItem.originalOpeningDate ?? undefined,
    dateOfFirstDelinquency:
      primaryItem.dateOfFirstDelinquency ?? primaryItem.originalDateOfDelinquency ?? undefined,
    confidenceScore: 100,
    healingFlags: [],
    requiresDisclosureRequest: false,
  };

  const req: DisputeLetterRequest = {
    account: healedAccount,
    item: primaryItem,
    metro2Flags: [],
    passNumber,
    bureau,
    consumerName: mapped.name,
    consumerAddress: mapped.address,
    todayDate: new Date().toISOString().split('T')[0],
  };

  const relatedItems = items.slice(1);

  return orchestrateLetterGeneration(
    req,
    async (): Promise<GeneratedLetter> => {
      const raw = await generateDisputeLetter(
        items,
        mapped,
        templateType,
        targetBureau,
        round,
        extraInstructions,
      );
      if (!raw || !raw.trim()) {
        // Queue fail-safe resolved null (AI retries exhausted) — engage Stage 7.
        throw new Error('Manual AI generation returned no usable draft (providers exhausted).');
      }
      return {
        body: raw,
        persona: `manual_${templateType}`,
        passNumber,
        bureau,
        metro2FlagsUsed: [],
        requiresDisclosure: false,
        generatedAt: new Date().toISOString(),
      };
    },
    {
      fallbackRenderer: (r) => renderTargetedDeterministicLetter(r, targetBureau, relatedItems),
      relatedItems,
    },
  );
}
