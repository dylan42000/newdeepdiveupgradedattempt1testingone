// ============================================================
// autopilotEngine.ts — WORLD CLASS AUTONOMOUS ENGINE v4.1
// Strategy: Item Verify Approach (base disputes)
// Target: Deletions. Not updates. DELETIONS.
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type {
  NegativeItem,
  DisputeLetter,
  AutopilotCampaign,
  AutopilotBatch,
  AutopilotLogEvent,
  PersonalInfo,
  HistoryEvent,
} from '../types';
import { aiComplete } from './aiRouter';
import { smartFillLetter } from './placeholderService';
import { normalizeConsumerVoice, validateConsumerVoice } from './consumerVoicePolicy';
import { getResolvedAccountNumber } from './tradelineMerger';
import { stripLetterBodyPreamble } from './letterBodySanitizer';

// ── ROUND STRATEGY MAP ──────────────────────────────────────
// These are the base dispute strategies using item-verify approach.
// No evidence required. Legally grounded. Deletion-focused.
export const ROUND_STRATEGY_MAP: Record<number, {
  templateType: string;
  lawBasis: string;
  approach: string;
  tone: 'formal' | 'firm' | 'aggressive' | 'legal_demand';
  targetType: 'bureau' | 'furnisher' | 'dual';
  daysDeadline: number;
  fcraSection: string;
}> = {
  1: {
    templateType: '609-Disclosure',
    lawBasis: '15 U.S.C. §1681g — Consumer File Disclosure',
    approach: 'item_verify',
    tone: 'formal',
    targetType: 'bureau',
    daysDeadline: 30,
    fcraSection: '§609',
  },
  2: {
    templateType: '611-Reinvestigation',
    lawBasis: '15 U.S.C. §1681i — Bureau Reinvestigation Demand',
    approach: 'item_verify',
    tone: 'firm',
    targetType: 'bureau',
    daysDeadline: 30,
    fcraSection: '§611',
  },
  3: {
    templateType: '611a7-MethodOfInvestigation',
    lawBasis: '15 U.S.C. §1681i(a)(7) — Method of Verification',
    approach: 'item_verify',
    tone: 'firm',
    targetType: 'bureau',
    daysDeadline: 30,
    fcraSection: '§611(a)(7)',
  },
  4: {
    templateType: '623-Furnisher',
    lawBasis: '15 U.S.C. §1681s-2(b) — Furnisher Dispute Obligation',
    approach: 'item_verify',
    tone: 'aggressive',
    targetType: 'furnisher',
    daysDeadline: 45,
    fcraSection: '§623',
  },
  5: {
    templateType: 'CFPBComplaintStateAG',
    lawBasis: 'CFPB Complaint + State AG Referral',
    approach: 'regulatory_escalation',
    tone: 'aggressive',
    targetType: 'bureau',
    daysDeadline: 60,
    fcraSection: '§611 + §623',
  },
  6: {
    templateType: 'PreLitigation',
    lawBasis: '15 U.S.C. §1681n + §1681o — Civil Liability',
    approach: 'legal_demand',
    tone: 'legal_demand',
    targetType: 'dual',
    daysDeadline: 10,
    fcraSection: '§616 + §617',
  },
};

// ── Six-pass state machine (local deterministic routing) ────────────────────

export type AutoPilotPass = 1 | 2 | 3 | 4 | 5 | 6;
export type AutoPilotAction =
  | 'accuracy_challenge'
  | 'dual_fire_metro2'
  | 'method_of_verification_demand'
  | 'unreasonable_investigation_notice'
  | 'cfpb_dossier'
  | 'pre_litigation_demand';

export interface AutoPilotRoute {
  pass: AutoPilotPass;
  action: AutoPilotAction;
  target: 'bureau' | 'furnisher' | 'dual';
  skippedPass1: boolean;
  rationale: string;
}

function isDeadAccount(item: NegativeItem): boolean {
  const text = `${item.status ?? ''} ${item.typeOfNegative ?? ''}`.toLowerCase();
  return (text.includes('charge-off') || text.includes('charge off') || text.includes('collection')) &&
    (item.balance ?? 0) < 2500;
}

/**
 * Routes a tradeline without network calls.  A low-balance charge-off or collection
 * starts at Pass 2; all other accounts start at Pass 1. Resolved accounts are not routed.
 */
export function routeAutoPilotPass(item: NegativeItem, requestedPass?: AutoPilotPass): AutoPilotRoute | null {
  if (item.disputeStatus === 'Deleted' || item.disputeStatus === 'Won') return null;
  const skipPass1 = isDeadAccount(item);
  const pass = Math.max(requestedPass ?? item.disputeRound ?? 1, skipPass1 ? 2 : 1) as AutoPilotPass;
  const routes: Record<AutoPilotPass, Omit<AutoPilotRoute, 'pass' | 'skippedPass1'>> = {
    1: { action: 'accuracy_challenge', target: 'bureau', rationale: 'Initial factual accuracy challenge.' },
    2: { action: 'dual_fire_metro2', target: 'dual', rationale: 'Parallel bureau and furnisher dispute focused on documented Metro 2 data discrepancies.' },
    3: { action: 'method_of_verification_demand', target: 'bureau', rationale: 'Request a description of the reinvestigation method after an unresolved dispute.' },
    4: { action: 'unreasonable_investigation_notice', target: 'dual', rationale: 'Notice that documented discrepancies remain unresolved after prior investigation.' },
    5: { action: 'cfpb_dossier', target: 'bureau', rationale: 'Prepare a regulatory dossier only after the direct CRA dispute is no longer pending or the applicable waiting period has elapsed.' },
    6: { action: 'pre_litigation_demand', target: 'dual', rationale: 'Final factual demand; the consumer should seek legal advice before sending.' },
  };
  return { pass, skippedPass1: skipPass1, ...routes[pass] };
}

// ── CONTEXT PASSED TO ENGINE ─────────────────────────────────
export interface AutopilotRunContext {
  negativeItems: NegativeItem[];
  disputeLetters: DisputeLetter[];
  campaigns: AutopilotCampaign[];
  personalInfo: PersonalInfo | null;
  settings: {
    enabled: boolean;
    strategy: string;
    batchFraction: number;
    bureauStagger: boolean;
    dualDispute: boolean;
    aggressivePlus: boolean;
    certifiedMailDefault: boolean;
    autoAdvanceRounds: boolean;
    solPauseGuard: boolean;
    smartLetterMode: boolean;
    smartFollowUp: boolean;
    cfpbAutoEscalate: boolean;
    fatigueDetect: boolean;
  };
  // Callbacks — AppContext methods
  onAddDisputeLetter: (letter: DisputeLetter) => void;
  onUpdateNegativeItem: (id: string, updates: Partial<NegativeItem>) => void;
  onAddCampaign: (campaign: AutopilotCampaign) => void;
  onUpdateCampaign: (id: string, updates: Partial<AutopilotCampaign>) => void;
  onAddBatchToCampaign: (campaignId: string, batch: AutopilotBatch) => void;
  onLog: (entry: AutopilotLogEvent) => void;
  onLogEvent: (event: HistoryEvent) => void;
  onAddXP: (amount: number) => void;
}

export interface AutopilotCycleResult {
  success: boolean;
  lettersGenerated: number;
  itemsProcessed: number;
  campaignId: string;
  batchId: string;
  errors: string[];
  warnings: string[];
  summary: string;
}

export interface AutopilotPreflightResult {
  canRun: boolean;
  errors: string[];
  warnings: string[];
}

function getSsnLast4(ssn: string | undefined): string {
  const digits = (ssn ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : '';
}

export function runAutopilotPreflight(
  personalInfo: PersonalInfo | null | undefined,
  items: NegativeItem[],
  settings: AutopilotRunContext['settings']
): AutopilotPreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!personalInfo) {
    errors.push('FATAL: personalInfo is null. No letters can be generated. Set up your profile first.');
  } else {
    if (!personalInfo.firstName?.trim()) errors.push('Missing: First Name (required for sender block)');
    if (!personalInfo.lastName?.trim()) errors.push('Missing: Last Name (required for sender block)');
    if (!personalInfo.address?.trim()) errors.push('Missing: Street Address (required for sender block)');
    if (!personalInfo.city?.trim()) errors.push('Missing: City (required for sender block)');
    if (!personalInfo.state?.trim()) errors.push('Missing: State (required for sender block)');
    if (!personalInfo.zip?.trim()) errors.push('Missing: ZIP Code (required for sender block)');

    if (!personalInfo.phone?.trim()) warnings.push('Optional: Phone number not set (recommended for letters)');
    if (!personalInfo.email?.trim()) warnings.push('Optional: Email not set');
    if (!getSsnLast4(personalInfo.ssn).trim()) warnings.push('Optional: SSN last 4 not set (some bureaus require verification)');
  }

  const activeItems = items.filter((i) =>
    i.disputeStatus !== 'Deleted' &&
    i.disputeStatus !== 'Won' &&
    i.disputeStatus !== 'Round6-PreLit'
  );

  if (activeItems.length === 0) {
    errors.push('No active disputable items found. Add items before running AutoPilot.');
  }

  if (!settings.enabled) {
    warnings.push('AutoPilot is disabled in settings. Enable it to run automatically.');
  }

  return {
    canRun: errors.length === 0,
    errors,
    warnings,
  };
}

// ── PRIORITY SORT ────────────────────────────────────────────
export function sortItemsByPriority(items: NegativeItem[]): NegativeItem[] {
  return [...items].sort((a, b) => {
    const scoreA = calcFicoImpactScore(a);
    const scoreB = calcFicoImpactScore(b);
    // Higher FICO impact = higher priority
    if (scoreB !== scoreA) return scoreB - scoreA;
    // Tiebreak: items already in dispute get lower priority (let new ones start)
    const aActive = a.disputeStatus !== 'Undisputed';
    const bActive = b.disputeStatus !== 'Undisputed';
    if (aActive !== bActive) return aActive ? 1 : -1;
    // Tiebreak: higher balance
    return (b.balance ?? 0) - (a.balance ?? 0);
  });
}

// ── FICO IMPACT SCORE ────────────────────────────────────────
export function calcFicoImpactScore(item: NegativeItem): number {
  let score = 0;
  const type = (item.typeOfNegative ?? '').toLowerCase();
  const status = (item.status ?? '').toLowerCase();
  const combined = `${type} ${status}`;

  // Base severity
  if (combined.includes('bankruptcy')) score += 55;
  else if (combined.includes('judgment') || combined.includes('tax lien')) score += 52;
  else if (combined.includes('foreclosure')) score += 50;
  else if (combined.includes('repossession') || combined.includes('repo')) score += 47;
  else if (combined.includes('charge') || combined.includes('charged off')) score += 45;
  else if (combined.includes('collection')) score += 42;
  else if (combined.includes('120') || combined.includes('late 120')) score += 35;
  else if (combined.includes('90') || combined.includes('late 90')) score += 30;
  else if (combined.includes('60') || combined.includes('late 60')) score += 22;
  else if (combined.includes('30') || combined.includes('late 30')) score += 15;
  else score += 20;

  // Recency
  const dofd = item.originalDateOfDelinquency ?? item.dateOfFirstDelinquency;
  if (dofd) {
    const monthsOld = monthsSince(dofd);
    if (monthsOld < 12) score += 18;
    else if (monthsOld < 24) score += 12;
    else if (monthsOld < 36) score += 8;
    else if (monthsOld < 60) score += 4;
  }

  // Balance
  const bal = item.balance ?? 0;
  if (bal > 10000) score += 12;
  else if (bal > 5000) score += 8;
  else if (bal > 1000) score += 5;
  else if (bal > 0) score += 2;

  // Bureau spread
  const bureauCount = item.creditBureau?.length ?? 0;
  if (bureauCount >= 3) score += 10;
  else if (bureauCount === 2) score += 5;

  // SOL drop imminent — reduce priority (let it age off)
  if (item.solPaused) score -= 20;
  else {
    const solDate = item.solDropDate;
    if (solDate) {
      const solMonths = monthsUntil(solDate);
      if (solMonths <= 6) score -= 20;
      else if (solMonths <= 12) score -= 10;
    }
  }

  // Double-verified items are urgent
  if (item.doubleVerified || (item.verificationCount ?? 0) >= 2) score += 8;

  return Math.min(100, Math.max(1, Math.round(score)));
}

// ── BATCH SIZE CALC ──────────────────────────────────────────
export function calcBatchSize(totalItems: number, fraction: number): number {
  const raw = Math.ceil(totalItems * Math.min(1, Math.max(0.1, fraction)));
  return Math.min(10, Math.max(1, raw));
}

// ── ELIGIBLE ITEMS FILTER ────────────────────────────────────
export function getEligibleItems(
  items: NegativeItem[],
  letters: DisputeLetter[],
  solPauseGuard: boolean,
): NegativeItem[] {
  const now = new Date();

  return items.filter(item => {
    // Skip deleted/won items
    if (item.disputeStatus === 'Deleted' || item.disputeStatus === 'Won') return false;

    // Skip SOL-paused items if guard is on
    if (solPauseGuard && item.solPaused) return false;

    // Skip items with active pending letters (letter sent but no response yet)
    const activeLetter = letters.find(l =>
      l.negativeItemIds.includes(item.id) &&
      l.status === 'Sent' &&
      !isPastDeadline(l)
    );
    if (activeLetter) return false;

    // Skip items in Round6 PreLit that are resolved accurate
    if (item.disputeStatus === 'Round6-PreLit') return false;

    return true;
  });
}

// ── BUREAU STAGGER ───────────────────────────────────────────
const BUREAU_STAGGER_DAYS: Record<string, number> = {
  'Equifax': 0,
  'Experian': 5,
  'TransUnion': 10,
};

export function getStaggeredSendDate(bureau: string, baseDate: Date = new Date()): Date {
  const offset = BUREAU_STAGGER_DAYS[bureau] ?? 0;
  const d = new Date(baseDate);
  d.setDate(d.getDate() + offset);
  return d;
}

// ── LETTER GENERATION (ITEM VERIFY APPROACH) ────────────────
// This is the core. No evidence. Pure item-verify dispute strategy.
// Legally grounded. Deletion-targeted.
export async function generateItemVerifyLetter(
  item: NegativeItem,
  round: number,
  bureau: string,
  personalInfo: PersonalInfo | null,
  options: {
    aggressivePlus?: boolean;
    smartLetterMode?: boolean;
    certifiedMail?: boolean;
  } = {}
): Promise<string> {
  const strategy = ROUND_STRATEGY_MAP[round] ?? ROUND_STRATEGY_MAP[1];
  const consumerName = personalInfo
    ? `${personalInfo.firstName} ${personalInfo.lastName}`
    : 'Consumer';

  const systemPrompt = buildLetterSystemPrompt(strategy, options.aggressivePlus ?? false);
  const userPrompt = buildLetterUserPrompt({
    item,
    round,
    bureau,
    strategy,
    consumerName,
    personalInfo,
    aggressivePlus: options.aggressivePlus ?? false,
  });

  try {
    const content = stripLetterBodyPreamble(
      normalizeConsumerVoice(await aiComplete(systemPrompt, userPrompt, 'letter')),
    );
    if (validateConsumerVoice(content).length > 0) {
      return stripLetterBodyPreamble(
        buildFallbackLetterContent(item, round, bureau, strategy, consumerName),
      );
    }
    return content;
  } catch (err) {
    // Fallback to high-quality template if AI fails
    return stripLetterBodyPreamble(
      buildFallbackLetterContent(item, round, bureau, strategy, consumerName),
    );
  }
}

function buildLetterSystemPrompt(strategy: typeof ROUND_STRATEGY_MAP[1], aggressive: boolean): string {
  const aggressiveAddOn = aggressive
    ? `\n\nFIRM MODE ACTIVE: Be concise and persistent. Describe only escalation steps the
consumer has actually taken or expressly selected. Do not invent complaints, deadlines,
violations, damages, lawsuits, evidence, or admissions.`
    : '';

  return `Draft a letter in the first person as the named consumer, who will review and sign it.
Never imply that a lawyer, credit-repair company, agent, office, or representative is writing.

Write a specific, good-faith dispute asking for a reasonable reinvestigation of the identified
information. Use only supplied facts. Request deletion or correction when information is inaccurate,
incomplete, or cannot be verified after a reasonable reinvestigation.

STRATEGY: ${strategy.approach} — ${strategy.lawBasis}
LAW BASIS: ${strategy.fcraSection}
TONE: ${strategy.tone}
TARGET: ${strategy.targetType}
DEADLINE: ${strategy.daysDeadline} days for response per FCRA

LETTER REQUIREMENTS:
1. First-person consumer voice throughout (I, me, my).
2. Identify the specific account and disputed fields before citing law.
3. Do not call an item inaccurate merely because documents were not supplied.
4. Do not demand a signed contract, wet signature, physical documents, or a particular investigation method as a universal requirement.
5. Do not claim a complaint was filed, a deadline exists, or litigation will commence unless supplied facts establish it.
6. Keep each follow-up tied to the prior response or unresolved field so it is not repetitive.
7. Do NOT include a salutation or closing — those are added by the template.
8. Output ONLY body paragraphs as HTML <p> tags.${aggressiveAddOn}`;
}

function buildLetterUserPrompt(params: {
  item: NegativeItem;
  round: number;
  bureau: string;
  strategy: typeof ROUND_STRATEGY_MAP[1];
  consumerName: string;
  personalInfo: PersonalInfo | null;
  aggressivePlus: boolean;
}): string {
  const { item, round, bureau, strategy, consumerName, aggressivePlus } = params;

  const dofd = item.originalDateOfDelinquency ?? item.dateOfFirstDelinquency ?? 'Unknown';
  const autoRemoval = item.autoRemovalDate ?? 'Unknown';
  const balance = item.balance != null ? `$${item.balance.toLocaleString()}` : 'Unknown';
  const bureausReporting = item.creditBureau?.join(', ') ?? bureau;

  let roundContext = '';
  if (round === 1) {
    roundContext = `This is the INITIAL dispute. I have never disputed this item before.
I am invoking my rights under ${strategy.fcraSection} to demand full verification
of this account's accuracy, completeness, and legal compliance.`;
  } else if (round === 2) {
    roundContext = `This is my SECOND dispute. The item remains unresolved after the prior response.
I am identifying the unresolved fields and requesting a new reasonable reinvestigation.`;
  } else if (round === 3) {
    roundContext = `This is my THIRD dispute. I am requesting the description of the procedure used
to determine the accuracy and completeness of the disputed information, to the extent applicable.`;
  } else if (round === 4) {
    roundContext = `This is a direct dispute to the furnisher. I ask you to investigate the specific
fields identified and correct or delete information that is inaccurate, incomplete, or cannot be verified.`;
  } else if (round === 5) {
    roundContext = `This is my fifth written effort concerning this item. I am assembling the dispute
history and responses for regulatory review if the identified discrepancies remain unresolved.`;
  } else if (round === 6) {
    roundContext = `This is my sixth written effort. Please review the enclosed chronology, prior
responses, and still-unresolved fields. I request a final substantive response and will consider
appropriate consumer, regulatory, or legal-review options based on the documented outcome.`;
  }

  return `Write a Round ${round} dispute letter body for the following account.

CONSUMER: ${consumerName}
BUREAU: ${bureau}
ROUND: ${round} of 6
STRATEGY: ${strategy.approach}

ACCOUNT DETAILS:
- Creditor/Furnisher: ${item.creditorName}
- Account Number: ${getResolvedAccountNumber(item) ? `xxxx${getResolvedAccountNumber(item).slice(-4)}` : 'Unknown'}
- Account Type: ${item.accountType ?? item.typeOfNegative}
- Negative Status: ${item.typeOfNegative}
- Reported Status: ${item.status}
- Balance Reported: ${balance}
- Date of First Delinquency: ${dofd}
- Date Last Reported: ${item.dateOfLastReporting ?? 'Unknown'}
- Auto-Removal Date (FCRA §605): ${autoRemoval}
- Bureaus Reporting This Item: ${bureausReporting}
- Payment History Notes: ${item.paymentHistory ?? 'Not provided'}

ROUND CONTEXT:
${roundContext}

LEGAL BASIS FOR THIS ROUND:
${strategy.lawBasis}
${strategy.fcraSection}

SPECIFIC DEMANDS FOR THIS LETTER:
${buildRoundSpecificDemands(round, item)}

${aggressivePlus ? 'FIRM MODE: Be direct and concise, but make no unsupported threat or factual assertion.' : ''}

Write 3-5 paragraphs in my first-person consumer voice. Use HTML <p> tags only.
Request correction or deletion based on the documented issue and investigation result.`;
}

function buildRoundSpecificDemands(round: number, item: NegativeItem): string {
  const demands: Record<number, string> = {
    1: `1. Reinvestigate the identified balance, status, dates, ownership, and payment-history fields
2. Correct or delete each field that is inaccurate, incomplete, or cannot be verified
3. Send me the written results and an updated file disclosure`,
    2: `1. Address the specific fields that remain unresolved after the prior response
2. Explain the result for each disputed field
3. Correct or delete inaccurate, incomplete, or unverifiable information`,
    3: `1. Provide the description of the procedure used to determine accuracy and completeness, where applicable
2. Provide the furnisher contact information used in the reinvestigation
3. Reinvestigate any discrepancy that the prior response did not resolve`,
    4: `1. Investigate the identified account fields using your available records
2. Report accurate results to every consumer reporting agency to which you furnished the information
3. Correct or delete information that is inaccurate, incomplete, or cannot be verified`,
    5: `1. Review the attached dispute chronology and prior responses
2. Resolve each documented discrepancy rather than returning a generic verification result
3. Provide a written, field-specific response suitable for the consumer's regulatory record`,
    6: `1. Conduct a final review of the enclosed chronology and unresolved fields
2. Provide the basis for each remaining reported field
3. Correct or delete inaccurate, incomplete, or unverifiable information and send the final results`,
  };

  return demands[round] ?? demands[1];
}

function buildFallbackLetterContent(
  item: NegativeItem,
  round: number,
  bureau: string,
  strategy: typeof ROUND_STRATEGY_MAP[1],
  consumerName: string,
): string {
  const accountNumber = getResolvedAccountNumber(item);
  return `<p>I am disputing the reporting of <strong>${item.creditorName}</strong>, account ${accountNumber ? `ending in ${accountNumber.slice(-4)}` : 'number not fully displayed'}, on my ${bureau} credit file. It is reported as <strong>${item.typeOfNegative}</strong>${item.balance != null ? ` with a balance of $${item.balance.toLocaleString()}` : ''}. I ask that you review the accuracy and completeness of the specific account fields reported.</p>

<p>Please conduct a reasonable reinvestigation under <strong>15 U.S.C. ${strategy.fcraSection}</strong>, including the reported balance, status, dates, ownership, and payment history. Please address each disputed field in the written results rather than returning only a general status.</p>

<p>If any disputed information is inaccurate, incomplete, or cannot be verified through your reinvestigation, please correct or delete it and send me an updated copy of my credit file. I am submitting this request in my own name and ask that all results be sent directly to me.</p>`;
}

// ── MAIN AUTOPILOT CYCLE ─────────────────────────────────────
export async function runAutopilotCycle(ctx: AutopilotRunContext): Promise<AutopilotCycleResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let lettersGenerated = 0;
  let itemsProcessed = 0;

  const log = (msg: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    ctx.onLog({
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      message: msg,
      level,
      type: 'cycle',
    });
  };

  // ── GUARD CHECKS ─────────────────────────────────────────
  if (!ctx.settings.enabled) {
    return { success: false, lettersGenerated: 0, itemsProcessed: 0,
      campaignId: '', batchId: '', errors: ['AutoPilot is disabled'], warnings, summary: 'AutoPilot disabled.' };
  }

  const preflight = runAutopilotPreflight(ctx.personalInfo, ctx.negativeItems, ctx.settings);
  preflight.warnings.forEach((warning) => {
    log(`[PREFLIGHT WARNING] ${warning}`, 'warning');
  });

  if (!preflight.canRun) {
    preflight.errors.forEach((error) => {
      log(`[PREFLIGHT FAILED] ${error}`, 'error');
    });
    throw new Error(`AutoPilot preflight failed: ${preflight.errors.join(' | ')}`);
  }

  log('🚀 AutoPilot cycle starting...', 'info');

  // ── ELIGIBLE ITEMS ────────────────────────────────────────
  const eligible = getEligibleItems(
    ctx.negativeItems,
    ctx.disputeLetters,
    ctx.settings.solPauseGuard,
  );

  if (eligible.length === 0) {
    log('✅ No eligible items to dispute this cycle.', 'success');
    return {
      success: true, lettersGenerated: 0, itemsProcessed: 0,
      campaignId: '', batchId: '',
      errors: [], warnings: ['No eligible items found'],
      summary: 'No items ready for dispute this cycle.',
    };
  }

  log(`📋 Found ${eligible.length} eligible items. Sorting by FICO impact...`, 'info');

  // ── SORT + SELECT BATCH ───────────────────────────────────
  const sorted = sortItemsByPriority(eligible);
  const batchSize = calcBatchSize(sorted.length, ctx.settings.batchFraction);
  const batch = sorted.slice(0, batchSize);

  log(`⚡ Batch selected: ${batch.length} items (${batchSize} of ${sorted.length})`, 'info');

  // ── FIND OR CREATE CAMPAIGN ───────────────────────────────
  let activeCampaign = ctx.campaigns.find(c => c.status === 'Active');
  const campaignId = activeCampaign?.id ?? uuidv4();

  if (!activeCampaign) {
    activeCampaign = {
      id: campaignId,
      name: `AutoPilot Campaign — ${new Date().toLocaleDateString()}`,
      startDate: new Date().toISOString(),
      status: 'Active',
      currentRound: 1,
      totalItems: 0,
      resolvedItems: 0,
      batches: [],
    };
    ctx.onAddCampaign(activeCampaign);
    log(`📁 New campaign created: ${activeCampaign.name}`, 'info');
  }

  const batchId = uuidv4();
  const generatedLetters: DisputeLetter[] = [];

  // ── GENERATE LETTERS ──────────────────────────────────────
  for (const item of batch) {
    const round = getNextRound(item);
    const targetBureaus = item.creditBureau?.length > 0
      ? item.creditBureau
      : ['Equifax', 'Experian', 'TransUnion'];

    for (const bureau of targetBureaus) {
      log(`✍️ Generating Round ${round} letter for ${item.creditorName} @ ${bureau}...`, 'info');

      try {
        const bodyContent = await generateItemVerifyLetter(
          item,
          round,
          bureau,
          ctx.personalInfo,
          {
            aggressivePlus: ctx.settings.aggressivePlus,
            smartLetterMode: ctx.settings.smartLetterMode,
            certifiedMail: ctx.settings.certifiedMailDefault,
          }
        );

        const fillResult = smartFillLetter(
          bodyContent,
          {
            ...ctx.personalInfo!,
            ssn: getSsnLast4(ctx.personalInfo?.ssn),
          },
          item,
          bureau,
          [],
          round,
        );

        const unfilledTokens = [
          ...new Set([
            ...fillResult.remaining.map((r) => r.placeholder),
            ...fillResult.unresolvedTokens,
          ]),
        ];

        if (unfilledTokens.length > 0) {
          log(
            `Letter has ${unfilledTokens.length} unfilled tokens: ${unfilledTokens.join(', ')}`,
            'warning'
          );
        }

        const strategy = ROUND_STRATEGY_MAP[round];
        const sendDate = ctx.settings.bureauStagger
          ? getStaggeredSendDate(bureau)
          : new Date();

        const bureauAddress = getBureauAddress(bureau);
        const deadline = new Date(sendDate);
        deadline.setDate(deadline.getDate() + strategy.daysDeadline);

        const letter: DisputeLetter = {
          id: uuidv4(),
          negativeItemIds: [item.id],
          content: fillResult.filled,
          createdAt: new Date().toISOString(),
          status: 'Draft',
          bureau,
          round: round as 1 | 2 | 3 | 4 | 5 | 6,
          batchId,
          templateType: strategy.templateType as any,
          certifiedMail: ctx.settings.certifiedMailDefault,
          mailed: false,
          disputeStrengthScore: calcLetterStrength(round, ctx.settings.aggressivePlus),
          disputeStrengthReason: `Round ${round} ${strategy.approach} strategy`,
          targetType: strategy.targetType,
        };

        ctx.onAddDisputeLetter(letter);
        generatedLetters.push(letter);
        lettersGenerated++;

        // Update item status
        const newStatus = getNewItemStatus(round);
        ctx.onUpdateNegativeItem(item.id, {
          disputeStatus: newStatus as any,
          disputeRound: round as 1 | 2 | 3 | 4 | 5 | 6,
          lastDisputeDate: new Date().toISOString(),
          disputeDeadline: deadline.toISOString(),
          priorityScore: calcFicoImpactScore(item),
        });

        log(`✅ Letter generated: ${item.creditorName} @ ${bureau} — Round ${round}`, 'success');
        itemsProcessed++;

      } catch (err) {
        const errMsg = `Failed to generate letter for ${item.creditorName} @ ${bureau}: ${err}`;
        errors.push(errMsg);
        log(`❌ ${errMsg}`, 'error');
      }
    }

    // Dual dispute: also generate furnisher letter if enabled and round >= 2
    if (ctx.settings.dualDispute && round >= 2) {
      const furnisherAddress = item.disputeContactAddress;
      if (furnisherAddress) {
        log(`🎯 Dual dispute: Generating furnisher letter for ${item.creditorName}...`, 'info');
        try {
          const furnisherContent = await generateItemVerifyLetter(
            item, 4, item.creditorName, ctx.personalInfo,
            { aggressivePlus: ctx.settings.aggressivePlus }
          );

          const fillResult = smartFillLetter(
            furnisherContent,
            {
              ...ctx.personalInfo!,
              ssn: getSsnLast4(ctx.personalInfo?.ssn),
            },
            item,
            item.creditorName,
            [],
            4,
          );

          const unfilledTokens = [
            ...new Set([
              ...fillResult.remaining.map((r) => r.placeholder),
              ...fillResult.unresolvedTokens,
            ]),
          ];

          if (unfilledTokens.length > 0) {
            log(
              `Furnisher letter has ${unfilledTokens.length} unfilled tokens: ${unfilledTokens.join(', ')}`,
              'warning'
            );
          }

          const furnisherLetter: DisputeLetter = {
            id: uuidv4(),
            negativeItemIds: [item.id],
            content: fillResult.filled,
            createdAt: new Date().toISOString(),
            status: 'Draft',
            bureau: item.creditorName,
            round: 4,
            batchId,
            templateType: '623-Furnisher' as any,
            certifiedMail: ctx.settings.certifiedMailDefault,
            mailed: false,
            disputeStrengthScore: 8,
            targetType: 'furnisher',
          };
          ctx.onAddDisputeLetter(furnisherLetter);
          generatedLetters.push(furnisherLetter);
          lettersGenerated++;
          log(`✅ Furnisher letter generated for ${item.creditorName}`, 'success');
        } catch (e) {
          warnings.push(`Furnisher letter failed for ${item.creditorName}: ${e}`);
        }
      }
    }
  }

  // ── RECORD BATCH ──────────────────────────────────────────
  const batchRecord: AutopilotBatch = {
    id: batchId,
    campaignId,
    createdAt: new Date().toISOString(),
    itemIds: batch.map(i => i.id),
    letterIds: generatedLetters.map(l => l.id),
    round: getNextRound(batch[0]) as 1 | 2 | 3 | 4 | 5 | 6,
    status: 'pending',
    stats: {
      total: generatedLetters.length,
      sent: 0,
      responded: 0,
      deleted: 0,
      verified: 0,
    },
  };

  ctx.onAddBatchToCampaign(campaignId, batchRecord);

  // ── UPDATE CAMPAIGN STATS ─────────────────────────────────
  ctx.onUpdateCampaign(campaignId, {
    totalItems: (activeCampaign.totalItems ?? 0) + itemsProcessed,
    resolvedItems: activeCampaign.resolvedItems ?? 0,
  });

  // ── LOG HISTORY EVENT ─────────────────────────────────────
  ctx.onLogEvent({
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    type: 'autopilot_cycle_run',
    title: `AutoPilot Cycle Run`,
    detail: `AutoPilot generated ${lettersGenerated} letters for ${itemsProcessed} items across ${batch.length} accounts`,
  });

  ctx.onAddXP(lettersGenerated * 50);

  const summary = `✅ AutoPilot cycle complete: ${lettersGenerated} letters generated for ${itemsProcessed} item-bureau pairs across ${batch.length} accounts. ${errors.length > 0 ? `${errors.length} errors occurred.` : 'No errors.'}`;

  log(summary, 'success');

  return {
    success: errors.length < batch.length,
    lettersGenerated,
    itemsProcessed,
    campaignId,
    batchId,
    errors,
    warnings,
    summary,
  };
}

// ── HELPERS ──────────────────────────────────────────────────

function getNextRound(item: NegativeItem): number {
  const status = item.disputeStatus ?? 'Undisputed';
  if (status === 'Undisputed') return 1;
  if (status === 'Round1-Pending' || status === 'Round1-Verified') return 2;
  if (status === 'Round2-Pending' || status === 'Round2-Verified') return 3;
  if (status === 'Round3-Pending' || status === 'Round3-Verified') return 4;
  if (status === 'Round4-Legal' || status === 'Round4-Verified') return 5;
  if (status === 'Round5-CFPB' || status === 'Round5-Verified') return 6;
  return 1;
}

function getNewItemStatus(round: number): string {
  const map: Record<number, string> = {
    1: 'Round1-Pending',
    2: 'Round2-Pending',
    3: 'Round3-Pending',
    4: 'Round4-Legal',
    5: 'Round5-CFPB',
    6: 'Round6-PreLit',
  };
  return map[round] ?? 'Round1-Pending';
}

function calcLetterStrength(round: number, aggressive: boolean): number {
  const base = Math.min(10, round + 2);
  return aggressive ? Math.min(10, base + 2) : base;
}

function isPastDeadline(letter: DisputeLetter): boolean {
  if (!letter.mailed && letter.status === 'Sent') {
    // Consider sent letters 30 days old
    const sent = new Date(letter.createdAt);
    const now = new Date();
    const days = (now.getTime() - sent.getTime()) / (1000 * 60 * 60 * 24);
    return days > 35;
  }
  return false;
}

function monthsSince(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
}

function monthsUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

function getBureauAddress(bureau: string): { name: string; address: string; city: string; state: string; zip: string } {
  const addresses: Record<string, { name: string; address: string; city: string; state: string; zip: string }> = {
    'Equifax': {
      name: 'Equifax Information Services LLC',
      address: 'P.O. Box 740256',
      city: 'Atlanta',
      state: 'GA',
      zip: '30374-0256',
    },
    'Experian': {
      name: 'Experian Information Solutions, Inc.',
      address: 'P.O. Box 4500',
      city: 'Allen',
      state: 'TX',
      zip: '75013',
    },
    'TransUnion': {
      name: 'TransUnion LLC Consumer Dispute Center',
      address: 'P.O. Box 2000',
      city: 'Chester',
      state: 'PA',
      zip: '19016',
    },
  };
  return addresses[bureau] ?? { name: bureau, address: 'P.O. Box 1000', city: 'Unknown', state: 'XX', zip: '00000' };
}

// ── INTELLIGENCE FUNCTIONS ────────────────────────────────────

export function checkOverdueItems(items: NegativeItem[], letters: DisputeLetter[] = []): NegativeItem[] {
  return items.filter(item => {
    if (!item.disputeDeadline) return false;
    const deadline = new Date(item.disputeDeadline);
    return deadline < new Date() &&
      item.disputeStatus !== 'Deleted' &&
      item.disputeStatus !== 'Won' &&
      item.disputeStatus !== 'Undisputed';
  });
}

export function getFollowUpCandidates(items: NegativeItem[], letters: DisputeLetter[] = []): NegativeItem[] {
  const now = new Date();
  return items.filter(item => {
    const recentLetter = letters
      .filter(l => l.negativeItemIds.includes(item.id) && l.status === 'Sent')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (!recentLetter) return false;
    const daysSince = (now.getTime() - new Date(recentLetter.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince >= 25 && daysSince < 35;
  });
}

export function getMilestoneAlerts(items: NegativeItem[], letters: DisputeLetter[] = []): {
  type: string; message: string; itemId?: string;
}[] {
  const alerts = [];
  const deleted = items.filter(i => i.disputeStatus === 'Deleted' || i.disputeStatus === 'Won');
  if (deleted.length > 0) {
    alerts.push({
      type: 'deletion',
      message: `🎉 ${deleted.length} item${deleted.length > 1 ? 's' : ''} successfully deleted from your credit report!`,
    });
  }
  const overdueItems = checkOverdueItems(items, letters);
  if (overdueItems.length > 0) {
    alerts.push({
      type: 'overdue',
      message: `⚠️ ${overdueItems.length} item${overdueItems.length > 1 ? 's' : ''} past FCRA deadline — escalate now!`,
    });
  }
  return alerts;
}

export function detectDisputeFatigue(items: NegativeItem[]): NegativeItem[] {
  return items.filter(i => (i.verificationCount ?? 0) >= 3);
}

export function getCFPBAutoEscalationCandidates(items: NegativeItem[]): NegativeItem[] {
  return items.filter(i =>
    i.disputeRound >= 3 &&
    (i.disputeStatus === 'Round3-Verified' || i.disputeStatus === 'Round3-Pending')
  );
}

export function autoDetectGoodwill(item: NegativeItem): boolean {
  const status = (item.status ?? '').toLowerCase();
  return (status.includes('paid') || status.includes('settled') || status.includes('closed')) &&
    !status.includes('collection') &&
    (item.balance ?? 0) === 0;
}

export function autoDetectP4D(item: NegativeItem): boolean {
  const type = (item.typeOfNegative ?? '').toLowerCase();
  return type.includes('collection') && (item.balance ?? 0) > 0;
}

export function checkSolPause(item: NegativeItem): boolean {
  if (!item.solDropDate) return false;
  const months = monthsUntil(item.solDropDate);
  return months <= 6 && months >= 0;
}

export function getAutoAdvanceRound(item: NegativeItem): number {
  return Math.min(6, getNextRound(item));
}

export function getDaysRemaining(letter: DisputeLetter): number;
export function getDaysRemaining(dateStr: string | null): number | null;
export function getDaysRemaining(letterOrDate: DisputeLetter | string | null): number | null {
  if (letterOrDate === null) return null;
  if (typeof letterOrDate === 'string') {
    const deadline = new Date(letterOrDate);
    const now = new Date();
    return Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  }
  const deadline = new Date(letterOrDate.createdAt);
  deadline.setDate(deadline.getDate() + 30);
  const now = new Date();
  return Math.max(0, Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
}

export function computeAutopilotIntel(
  items: NegativeItem[],
  letters: DisputeLetter[] = [],
  campaigns: AutopilotCampaign[] = []
) {
  const totalItems = items.length;
  const deletedItems = items.filter(i => i.disputeStatus === 'Deleted' || i.disputeStatus === 'Won').length;
  return {
    totalItems,
    total: totalItems,
    undisputedItems: items.filter(i => i.disputeStatus === 'Undisputed').length,
    activeItems: items.filter(i =>
      i.disputeStatus !== 'Undisputed' &&
      i.disputeStatus !== 'Deleted' &&
      i.disputeStatus !== 'Won'
    ).length,
    deletedItems,
    resolved: deletedItems,
    winRate: totalItems > 0 ? Math.round(deletedItems / totalItems * 100) : 0,
    estimatedNetScoreGain: deletedItems * 15,
    overdueItems: checkOverdueItems(items, letters).length,
    followUpCandidates: getFollowUpCandidates(items, letters).length,
    cfpbCandidates: getCFPBAutoEscalationCandidates(items).length,
    fatiguedItems: detectDisputeFatigue(items).length,
    milestones: getMilestoneAlerts(items, letters),
    activeCampaigns: campaigns.filter(c => c.status === 'Active').length,
    totalLettersGenerated: letters.length,
    pendingLetters: letters.filter(l => l.status === 'Draft').length,
    sentLetters: letters.filter(l => l.status === 'Sent').length,
  };
}

// ── BACKWARD COMPATIBILITY EXPORTS ───────────────────────────
// These exports ensure Autopilot.tsx and any other consumers
// continue to work after the world-class engine rewrite above.
// DO NOT remove — Autopilot.tsx imports all of these directly.

// ── BUREAUS CONSTANT ─────────────────────────────────────────
export const BUREAUS = ['Equifax', 'Experian', 'TransUnion'] as const;

// ── ESCALATION LADDER ─────────────────────────────────────────
// Maps DisputeRound 1-6 to strategy metadata used in the UI ladder.
export const ESCALATION_LADDER: Record<number, {
  templateType: string;
  lawRef: string;
  description: string;
  deadlineDays: number;
}> = {
  1: {
    templateType: '609-Disclosure',
    lawRef: '15 U.S.C. §1681g',
    description: 'Initial Verification Request (§609)',
    deadlineDays: 30,
  },
  2: {
    templateType: '611-Reinvestigation',
    lawRef: '15 U.S.C. §1681i',
    description: 'Bureau Reinvestigation Demand (§611)',
    deadlineDays: 30,
  },
  3: {
    templateType: '611a7-MethodOfInvestigation',
    lawRef: '15 U.S.C. §1681i(a)(7)',
    description: 'Method of Verification Demand',
    deadlineDays: 30,
  },
  4: {
    templateType: '623-Furnisher',
    lawRef: '15 U.S.C. §1681s-2(b)',
    description: 'Direct Furnisher Dispute (§623)',
    deadlineDays: 45,
  },
  5: {
    templateType: 'CFPBComplaintStateAG',
    lawRef: 'CFPB + State AG Referral',
    description: 'Regulatory Escalation — CFPB Complaint Filed',
    deadlineDays: 60,
  },
  6: {
    templateType: 'PreLitigation',
    lawRef: '15 U.S.C. §1681n + §1681o',
    description: 'Pre-Litigation Demand — Civil Liability Notice',
    deadlineDays: 10,
  },
};

// ── RESOLVE RESPONSE OUTCOME ──────────────────────────────────
// Called when the user logs a bureau response for a disputed item.
// Returns the new dispute status, the next round number, and a log message.
export function resolveResponseOutcome(
  item: NegativeItem,
  outcome: 'Verified' | 'Updated' | 'Deleted' | 'NoResponse',
): { newStatus: string; newRound: number; logMessage: string } {
  const currentRound = (item.disputeRound ?? 1) as number;

  if (outcome === 'Deleted') {
    return {
      newStatus: 'Won',
      newRound: currentRound,
      logMessage: `✅ ${item.creditorName} DELETED from credit report after Round ${currentRound} dispute. Major win!`,
    };
  }

  if (outcome === 'Verified') {
    const nextRound = Math.min(6, currentRound + 1);
    const statusMap: Record<number, string> = {
      1: 'Round1-Verified',
      2: 'Round2-Verified',
      3: 'Round3-Verified',
      4: 'Round4-Verified',
      5: 'Round5-Verified',
      6: 'Round6-PreLit',
    };
    return {
      newStatus: statusMap[currentRound] ?? 'Round1-Verified',
      newRound: nextRound,
      logMessage: `🔄 ${item.creditorName} Verified (Round ${currentRound}). Escalating to Round ${nextRound}. Item is now double-track priority.`,
    };
  }

  if (outcome === 'Updated') {
    const nextRound = Math.min(6, currentRound + 1);
    const statusMap: Record<number, string> = {
      1: 'Round1-Verified',
      2: 'Round2-Verified',
      3: 'Round3-Verified',
      4: 'Round4-Verified',
      5: 'Round5-Verified',
      6: 'Round6-PreLit',
    };
    return {
      newStatus: statusMap[currentRound] ?? 'Round1-Verified',
      newRound: nextRound,
      logMessage: `⚠️ ${item.creditorName} reported as Updated (Round ${currentRound}). Reviewing and advancing to Round ${nextRound}.`,
    };
  }

  // NoResponse — auto-advance per FCRA §611
  const nextRound = Math.min(6, currentRound + 1);
  const pendingMap: Record<number, string> = {
    1: 'Round1-Pending',
    2: 'Round2-Pending',
    3: 'Round3-Pending',
    4: 'Round4-Legal',
    5: 'Round5-CFPB',
    6: 'Round6-PreLit',
  };
  return {
    newStatus: pendingMap[nextRound] ?? 'Round2-Pending',
    newRound: nextRound,
    logMessage: `📭 ${item.creditorName} — No Response received. Auto-advancing to Round ${nextRound} per FCRA §611.`,
  };
}

// ── CHECK DOUBLE VERIFIED ─────────────────────────────────────
// Returns true if the item has been verified twice (triggers furnisher bypass).
export function checkDoubleVerified(item: NegativeItem): boolean {
  return item.doubleVerified === true || (item.verificationCount ?? 0) >= 2;
}

// ── RECALC PRIORITY AFTER VERIFICATION ───────────────────────
// Boosts priority score by 15 when a bureau verifies an item (signals escalation urgency).
export function recalcPriorityAfterVerification(item: NegativeItem): number {
  const current = item.priorityScore ?? calcFicoImpactScore(item);
  return Math.min(100, current + 15);
}

// ── DISPUTE CALENDAR ENTRY INTERFACE ─────────────────────────
export interface DisputeCalendarEntry {
  date: string;
  items: NegativeItem[];
  label: string;
  type: 'deadline' | 'autoRemoval' | 'solDrop' | 'followUp';
  itemId?: string;
  creditorName?: string;
  bureau?: string;
  round?: number;
  sentDate?: string | null;
  deadlineDate?: string | null;
  daysRemaining?: number | null;
}

// ── BUILD DISPUTE CALENDAR ────────────────────────────────────
// Aggregates all upcoming deadlines, auto-removal dates, and SOL drops
// into a chronologically sorted calendar for the UI timeline view.
export function buildDisputeCalendar(items: NegativeItem[]): DisputeCalendarEntry[] {
  const entries: DisputeCalendarEntry[] = [];

  for (const item of items) {
    if (item.disputeStatus === 'Deleted' || item.disputeStatus === 'Won') continue;

    const itemBureau = item.creditBureau?.[0] ?? 'Unknown';
    const calcDaysRemaining = (dateStr: string | null | undefined): number | null => {
      if (!dateStr) return null;
      const d = new Date(dateStr);
      const now = new Date();
      return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    if (item.disputeDeadline) {
      const existing = entries.find(
        e => e.date === item.disputeDeadline && e.type === 'deadline',
      );
      if (existing) {
        existing.items.push(item);
      } else {
        entries.push({
          date: item.disputeDeadline,
          items: [item],
          label: `Dispute Deadline — ${item.creditorName}`,
          type: 'deadline',
          itemId: item.id,
          creditorName: item.creditorName,
          bureau: itemBureau,
          round: item.disputeRound,
          sentDate: item.lastDisputeDate,
          deadlineDate: item.disputeDeadline,
          daysRemaining: calcDaysRemaining(item.disputeDeadline),
        });
      }
    }

    if (item.autoRemovalDate) {
      entries.push({
        date: item.autoRemovalDate,
        items: [item],
        label: `Auto-Removal Date — ${item.creditorName} (FCRA §605)`,
        type: 'autoRemoval',
        itemId: item.id,
        creditorName: item.creditorName,
        bureau: itemBureau,
        round: item.disputeRound,
        sentDate: item.lastDisputeDate,
        deadlineDate: item.disputeDeadline,
        daysRemaining: calcDaysRemaining(item.disputeDeadline),
      });
    }

    if (item.solDropDate) {
      entries.push({
        date: item.solDropDate,
        items: [item],
        label: `SOL Drop Date — ${item.creditorName}`,
        type: 'solDrop',
        itemId: item.id,
        creditorName: item.creditorName,
        bureau: itemBureau,
        round: item.disputeRound,
        sentDate: item.lastDisputeDate,
        deadlineDate: item.disputeDeadline,
        daysRemaining: calcDaysRemaining(item.disputeDeadline),
      });
    }
  }

  return entries.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

// ── GOODWILL POST-WIN CANDIDATES ──────────────────────────────
// Returns items that were won/deleted and may benefit from a goodwill
// letter to remove residual late-payment notations.
export function getGoodwillPostWinCandidates(items: NegativeItem[]): NegativeItem[] {
  return items.filter(item => {
    const isWon = item.disputeStatus === 'Won' || item.disputeStatus === 'Deleted';
    const hasLateHistory =
      (item.paymentHistory ?? '').toLowerCase().includes('late') ||
      (item.typeOfNegative ?? '').toLowerCase().includes('late');
    const paidOff = (item.balance ?? 0) === 0;
    return isWon && (hasLateHistory || paidOff);
  });
}

// ── SOL CALENDAR ENTRIES ──────────────────────────────────────
// Returns upcoming SOL drop dates so users know when to pause vs dispute.
export function getSOLCalendarEntries(items: NegativeItem[]): {
  item: NegativeItem;
  solDate: string;
  monthsRemaining: number;
  itemId: string;
  creditorName: string;
  solDropDate: string | null;
  urgency: 'critical' | 'watch' | 'safe';
  daysUntilDrop: number;
}[] {
  return items
    .filter(i => i.solDropDate && i.disputeStatus !== 'Deleted' && i.disputeStatus !== 'Won')
    .map(i => {
      const sol = new Date(i.solDropDate!);
      const now = new Date();
      const months = Math.max(
        0,
        (sol.getFullYear() - now.getFullYear()) * 12 + (sol.getMonth() - now.getMonth()),
      );
      const urgency: 'critical' | 'watch' | 'safe' =
        months <= 3 ? 'critical' : months <= 6 ? 'watch' : 'safe';
      const daysUntilDrop = Math.round(
        Math.max(0, (sol.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      );
      return {
        item: i,
        solDate: i.solDropDate!,
        monthsRemaining: months,
        itemId: i.id,
        creditorName: i.creditorName,
        solDropDate: i.solDropDate,
        urgency,
        daysUntilDrop,
      };
    })
    .sort((a, b) => a.monthsRemaining - b.monthsRemaining);
}

// ── DETECT PAYMENT PLAN CANDIDATES ───────────────────────────
// Returns collection accounts with a balance — eligible for pay-for-delete negotiation.
export function detectPaymentPlanCandidates(items: NegativeItem[]): NegativeItem[] {
  return items.filter(item => {
    const isCollection = (item.typeOfNegative ?? '').toLowerCase().includes('collection');
    const hasBalance = (item.balance ?? 0) > 0;
    const isActive = item.disputeStatus !== 'Deleted' && item.disputeStatus !== 'Won';
    return isCollection && hasBalance && isActive;
  });
}

// ── CAN LAUNCH ADDITIONAL CAMPAIGN ───────────────────────────
// Guards against launching too many concurrent campaigns.
export function canLaunchAdditionalCampaign(activeCount: number, max: number): boolean {
  return activeCount < max;
}

// ── CAN ADVANCE ROUND ─────────────────────────────────────────
// Returns true if the campaign has items eligible to move to the next round.
export function canAdvanceRound(campaign: AutopilotCampaign, items: NegativeItem[]): boolean {
  if (!campaign || campaign.status !== 'Active') return false;
  const currentRound = (campaign.currentRound ?? 1) as number;
  if (currentRound >= 6) return false;
  return items.some(
    item =>
      (item.disputeRound as number) === currentRound &&
      ((item.disputeStatus ?? "").includes('Verified') || (item.disputeStatus ?? "").includes('Pending')),
  );
}

// ── COMPUTE DEADLINE ──────────────────────────────────────────
// Returns the FCRA response deadline date for a given round.
export function computeDeadline(round: number, baseDate: Date = new Date()): Date {
  const strategy = ROUND_STRATEGY_MAP[round] ?? ROUND_STRATEGY_MAP[1];
  const d = new Date(baseDate);
  d.setDate(d.getDate() + strategy.daysDeadline);
  return d;
}
