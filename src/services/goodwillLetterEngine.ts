/**
 * goodwillLetterEngine.ts — 6-Strategy Goodwill Letter Engine (v5.1.0)
 *
 * Generates compassionate, human-first appeal letters to creditors for paid accounts.
 * Goodwill letters operate on emotional/relationship appeals — NOT legal demands.
 *
 * Best candidates: paid charge-offs, paid collections, isolated late payments.
 * Strategy selection is automatic based on account characteristics.
 *
 * Legal note: Creditors CAN voluntarily delete accurate information under FCRA.
 * This engine maximizes the probability they will exercise that discretion.
 */

import type { NegativeItem } from '../types';
import type { PersonalInfo } from '../types';

// ─── STRATEGY TYPES ──────────────────────────────────────────────────────────

export type GoodwillStrategy =
  | 'HARDSHIP_APPEAL'
  | 'LONG_RELATIONSHIP'
  | 'PANDEMIC_COVID_RELIEF'
  | 'MEDICAL_EMERGENCY'
  | 'FIRST_TIME_OFFENSE'
  | 'FULL_PAYMENT_MADE';

export interface GoodwillLetterParams {
  item: NegativeItem;
  personalInfo: PersonalInfo;
  strategy: GoodwillStrategy;
  hardshipContext?: string;
  relationshipLength?: number;
}

export interface GoodwillEligibilityResult {
  eligible: boolean;
  strategy: GoodwillStrategy | null;
  reason: string;
}

// ─── ELIGIBILITY CHECKER ─────────────────────────────────────────────────────

/**
 * Determine if an item is a good candidate for a goodwill letter and which
 * strategy is most likely to succeed.
 */
export function isGoodwillEligible(item: NegativeItem): GoodwillEligibilityResult {
  const type = (item.typeOfNegative ?? '').toLowerCase();
  const paid = item.balance === 0 || item.balance === null;

  // Paid late payments — prime goodwill candidates
  if (paid && type.includes('late')) {
    return {
      eligible: true,
      strategy: 'FULL_PAYMENT_MADE',
      reason: 'Paid account with late payment history — prime goodwill candidate',
    };
  }

  // Paid charge-offs
  if (paid && (type.includes('charge') || type.includes('charge-off'))) {
    return {
      eligible: true,
      strategy: 'FULL_PAYMENT_MADE',
      reason: 'Paid charge-off — goodwill request for removal appropriate',
    };
  }

  // Paid collections
  if (paid && type.includes('collection')) {
    return {
      eligible: true,
      strategy: 'FULL_PAYMENT_MADE',
      reason: 'Paid collection — goodwill and/or PFD (Pay For Delete) approach',
    };
  }

  // Isolated single late payment with otherwise good history
  if (type.includes('late 30') && !type.includes('late 60') && !type.includes('late 90')) {
    return {
      eligible: true,
      strategy: 'FIRST_TIME_OFFENSE',
      reason: 'Single 30-day late — isolated incident is highly goodwill-eligible',
    };
  }

  return {
    eligible: false,
    strategy: null,
    reason: 'Active balance with derogatory status — use dispute letters, not goodwill',
  };
}

// ─── PROMPT BUILDER ──────────────────────────────────────────────────────────

/**
 * Builds a full AI prompt for generating a goodwill letter using the selected strategy.
 * The prompt enforces the "human appeal" rules that make goodwill letters succeed.
 */
export function buildGoodwillPrompt(params: GoodwillLetterParams): string {
  const { item, personalInfo, strategy, hardshipContext, relationshipLength } = params;

  const strategyGuides: Record<GoodwillStrategy, string> = {
    HARDSHIP_APPEAL: `
STRATEGY: Compassionate hardship appeal to the HUMAN reading this letter.
- Acknowledge the late payment(s) honestly and directly
- Explain the specific, temporary hardship (${hardshipContext ?? 'financial hardship'})
- Emphasize this was a one-time situation, not a pattern
- Reference that the account was eventually brought current or paid off
- Appeal to the creditor's discretion to remove as a goodwill gesture
- DO NOT cite legal violations — this is an emotional appeal, not a legal demand
- Tone: humble, sincere, grateful, human
    `,
    LONG_RELATIONSHIP: `
STRATEGY: Loyalty and relationship appeal.
- Lead with appreciation for the ${relationshipLength ?? 'long'}-year relationship
- Briefly acknowledge the late payment(s) with honest context
- Emphasize the overall positive payment history and loyalty
- Point out this late payment as an anomaly in an otherwise excellent record
- Request removal as recognition of customer loyalty
- Tone: warm, respectful, relationship-focused
    `,
    FULL_PAYMENT_MADE: `
STRATEGY: Post-payment goodwill removal request.
- State clearly that the account has been fully paid/settled
- Note that the negative item now only serves to harm without any informational purpose
- Request that the creditor exercise their right to request deletion as goodwill
- Reference that furnishers CAN voluntarily delete accurate information under FCRA
- Tone: professional, appreciative, forward-looking
    `,
    MEDICAL_EMERGENCY: `
STRATEGY: Medical hardship appeal.
- Reference that the delinquency occurred during a documented medical event
- Note the involuntary, non-financial nature of the situation
- Reference CFPB guidelines encouraging creditors to consider medical hardship
- Request goodwill deletion as recognition of extenuating medical circumstances
- Tone: vulnerable, honest, non-confrontational
    `,
    FIRST_TIME_OFFENSE: `
STRATEGY: Isolated incident appeal.
- Highlight the single nature of this negative item against the overall credit record
- Provide brief context for the specific incident
- Appeal to the creditor's fairness and discretion
- Reference that many creditors honor first-time removal requests
- Tone: honest, confident, brief
    `,
    PANDEMIC_COVID_RELIEF: `
STRATEGY: COVID/disaster hardship appeal.
- Reference the documented nationwide economic impact during the relevant period
- Note that federal programs (CARES Act) acknowledged financial hardship
- Acknowledge the late payment resulted from this specific documented hardship
- Note many creditors granted relief under CARES Act provisions during this period
- Tone: factual, compassionate, referencing broader documented context
    `,
  };

  const accountDesc = item.balance === 0
    ? 'PAID IN FULL'
    : `Balance: $${item.balance ?? 0}`;

  const dofdDisplay = item.dateOfFirstDelinquency ?? item.originalDateOfDelinquency ?? 'approximately 2-3 years ago';

  return `
Write a sincere, first-person goodwill letter from a consumer to their creditor.
This is NOT a legal dispute — it is a human appeal for compassionate treatment.

CONSUMER: ${personalInfo.firstName} ${personalInfo.lastName}
CREDITOR: ${item.creditorName}
NEGATIVE ITEM: ${item.typeOfNegative} from ${dofdDisplay}
ACCOUNT STATUS: ${accountDesc}
RELATIONSHIP LENGTH: ${relationshipLength ?? 'Several'} years

${strategyGuides[strategy]}

CRITICAL RULES FOR GOODWILL LETTERS (MUST FOLLOW — THESE MAXIMIZE SUCCESS RATE):
1. DO NOT threaten legal action or cite FCRA violation sections
2. DO NOT use dispute terminology: "dispute", "investigation", "validation"
3. DO use human language — first person, emotional, personal
4. DO acknowledge the negative item honestly — do not deny it
5. DO make a specific, clear, polite ask: "I respectfully request you remove..."
6. CLOSE with genuine appreciation regardless of outcome
7. Length: 200-300 words maximum — short, sincere letters outperform long ones
8. Final paragraph: "I understand this is at your discretion and appreciate any consideration you can give this request."

FORMAT:
- Address it to: "Customer Relations Department"
- Open with: "Re: Goodwill Request — Account [ending in ${(item.accountNumber ?? '').slice(-4) || 'XXXX'}]"
- Do NOT include sender/recipient address blocks

Write the goodwill letter now.
  `.trim();
}

// ─── STRATEGY AUTO-SELECTOR ──────────────────────────────────────────────────

/**
 * Automatically select the best goodwill strategy based on item characteristics.
 * Used when the user has not manually specified a strategy.
 */
export function autoSelectGoodwillStrategy(
  item: NegativeItem,
  context?: {
    hadMedicalEvent?: boolean;
    hadCovidImpact?: boolean;
    relationshipYears?: number;
    hardshipContext?: string;
  }
): GoodwillStrategy {
  if (context?.hadMedicalEvent) return 'MEDICAL_EMERGENCY';
  if (context?.hadCovidImpact) return 'PANDEMIC_COVID_RELIEF';
  if (context?.relationshipYears && context.relationshipYears >= 3) return 'LONG_RELATIONSHIP';
  if (context?.hardshipContext) return 'HARDSHIP_APPEAL';

  const type = (item.typeOfNegative ?? '').toLowerCase();
  if (type.includes('late 30') && !type.includes('late 60')) return 'FIRST_TIME_OFFENSE';
  if (item.balance === 0) return 'FULL_PAYMENT_MADE';

  return 'HARDSHIP_APPEAL';
}
