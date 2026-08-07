/**
 * frivolousResponseService.ts — GAP-G: Frivolous Response Counter-Attack Protocol
 *
 * When a bureau invokes FCRA §611(a)(3) to label a dispute "frivolous or irrelevant",
 * the consumer is NOT without remedy. This service generates a targeted legal counter-attack.
 *
 * Legal foundation:
 *   §611(a)(3)(A) — Bureau must make frivolous determination within 5 business days.
 *   §611(a)(3)(B) — Bureau must provide WRITTEN NOTICE of the basis for the determination
 *                   including the specific bases it believes the dispute to be frivolous.
 *   §611(b)       — Consumer may add a brief statement disputing the accuracy of an item.
 *   §611(a)(4)    — After curing frivolous concerns, bureau must reinvestigate.
 *   §616/§617     — Civil liability for willful / negligent noncompliance.
 *
 * Counter-strategy (in order of escalation):
 *   1. Demand the written notice required by §611(a)(3)(B) (bureau rarely sends it)
 *   2. Provide NEW specific identifying information that makes the dispute clearly non-frivolous
 *   3. Explicitly invoke §611(a)(4) — cured dispute triggers reinvestigation duty
 *   4. Threaten §616 civil action for issuing a frivolous determination without the required notice
 */

import { NegativeItem } from '../types';
import { PassNumber } from '../types/creditRepair';

// ─── Types ────────────────────────────────────────────────────────────────────

export type FrivolousCounterTier =
  | 'demand-notice'       // Demand §611(a)(3)(B) written notice — first response
  | 'cure-and-refile'     // Provide new specifics + re-invoke reinvestigation duty
  | 'civil-escalation';   // §616 civil liability + CFPB complaint filing notice

export interface FrivolousChallengePlan {
  tier: FrivolousCounterTier;
  /** Full text appended to the AI letter generation prompt */
  promptDirective: string;
  /** Primary legal citation powering this counter-attack */
  primaryCitation: string;
  /** Recommended target for the counter letter */
  recommendedTarget: 'bureau' | 'furnisher' | 'cfpb';
  /** Days from today the counter letter should be dispatched */
  dispatchDelayDays: number;
  /** Human-readable summary for dashboard display */
  summary: string;
}

export interface FrivolousNoticeRequirements {
  /** FCRA §611(a)(3)(B) requires this content in the notice */
  requiredElements: string[];
  /** Statutory deadline for the bureau to send notice (5 business days) */
  noticeDueBy: string;
  /** Whether the bureau's notice deadline has passed */
  noticeOverdue: boolean;
}

// ─── Counter-attack directive templates ──────────────────────────────────────

const DIRECTIVES: Record<FrivolousCounterTier, string> = {
  'demand-notice': `
STRATEGY: FRIVOLOUS DETERMINATION CHALLENGE — DEMAND FOR §611(a)(3)(B) WRITTEN NOTICE
═══════════════════════════════════════════════════════════════════════════════════════

The bureau has issued a "frivolous or irrelevant" determination under FCRA §611(a)(3).
The consumer is mounting a targeted legal counter-attack based on the bureau's procedural
obligations that it almost certainly failed to meet.

THIS LETTER MUST:
1. State that the consumer received a "frivolous" or "irrelevant" determination on the
   dispute filed regarding this account.
2. Invoke FCRA §611(a)(3)(B) — the bureau is REQUIRED to provide written notice within
   5 business days of determining a dispute frivolous. The notice MUST describe:
   (a) All information in the consumer's file regarding the disputed item, AND
   (b) The specific basis or bases upon which the bureau determined the dispute was frivolous.
3. Demand that the bureau immediately provide this mandatory written notice in full.
4. State that failure to provide this notice is itself a violation of FCRA §611(a)(3)(B),
   exposing the bureau to civil liability under FCRA §616 (willful) or §617 (negligent).
5. Invoke FCRA §611(b) — consumer intends to add a statement to their file regarding
   this disputed account, and requests the bureau's procedure for doing so.
6. Set a deadline of 10 business days for the bureau to provide the required notice.
7. State that upon receiving the required notice (or upon expiration of the 10-day deadline),
   the consumer will refile the dispute with specific additional documentation that cures
   any claimed basis for a frivolous determination.

TONE: Legally precise, procedurally focused. The consumer is not accepting the frivolous
determination — the consumer is forcing the bureau to justify it by law.
DO NOT use emotional language. Focus on the bureau's own statutory failure.
`.trim(),

  'cure-and-refile': `
STRATEGY: FRIVOLOUS DETERMINATION — CURE NOTICE AND MANDATORY REINVESTIGATION DEMAND
═══════════════════════════════════════════════════════════════════════════════════════

The consumer has received (or been denied) the required §611(a)(3)(B) written notice.
This letter cures the prior dispute by providing specific new information and compels
the bureau to reinvestigate under FCRA §611(a)(4).

THIS LETTER MUST:
1. Reference the prior "frivolous" determination and its approximate date.
2. Invoke FCRA §611(a)(4) — after a consumer provides additional relevant information
   or material, the bureau's ability to invoke the frivolous exemption lapses and the
   full reinvestigation duty under §611(a)(1) is restored.
3. State the SPECIFIC new information that cures the frivolous concern:
   - Reference the exact account number tail digits
   - Reference the specific data field that is inaccurate (e.g., balance amount,
     payment status, date of first delinquency, account type)
   - State what the correct value is and why the current reporting is inaccurate
   - Reference any available documentation the consumer holds (even if not attached)
4. Demand that the bureau conduct a full and proper §611(a)(1) reinvestigation within
   30 days, as the prior frivolous designation is hereby cured.
5. Invoke FCRA §623(b)(1)(B) — upon receiving a dispute forwarded by the bureau,
   the furnisher MUST investigate and correct inaccurate information.
6. Cite FCRA §616 — the prior frivolous determination, if unsupported by the required
   §611(a)(3)(B) notice, constitutes willful noncompliance subject to statutory damages
   of not less than $100 nor more than $1,000 per violation.

TONE: Firm and legally precise. The consumer has done the work to cure the dispute.
The bureau has no remaining legal basis to avoid reinvestigation.
`.trim(),

  'civil-escalation': `
STRATEGY: MAXIMUM PRESSURE — CIVIL LIABILITY NOTICE + CFPB COMPLAINT FILING
═══════════════════════════════════════════════════════════════════════════════

This is the final pre-action notice after the bureau has wrongly applied the frivolous
exemption and failed to comply with its §611(a)(3)(B) notice obligations.

THIS LETTER MUST:
1. Document the complete frivolous dispute history:
   - Date of original dispute submission
   - Date of frivolous determination received (or no notice received at all)
   - Date of cure notice / refile submitted
   - Date(s) bureau failed to reinvestigate after cure
2. Enumerate the FCRA violations that have occurred:
   - §611(a)(3)(B): Failure to provide written notice of frivolous determination
   - §611(a)(4): Failure to reinvestigate after consumer provided additional information
   - §611(a)(1): Failure to conduct reasonable investigation
3. State that a CFPB complaint has been or will be filed within 72 hours at
   consumerfinance.gov/complaint, referencing all of the above violations.
4. State that the consumer is preserving all evidence for potential civil action
   under FCRA §616 for willful noncompliance (statutory damages $100–$1,000 per violation,
   plus actual damages, punitive damages, and attorney's fees).
5. Demand cure within 7 calendar days — deletion of the disputed tradeline, or
   provision of the complete documentary basis for its accuracy.
6. State that this letter has been sent via Certified Mail and is being preserved as evidence.

TONE: Formal, controlled, legally precise. Maximum legal gravity. No emotional language.
This letter should read as if it was composed in an FCRA attorney's office.
`.trim(),
};

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Build the appropriate counter-attack plan for a frivolous determination.
 *
 * The tier escalates automatically based on how many prior frivolous challenges
 * have already been filed for this item. On first detection: demand-notice.
 * After first counter: cure-and-refile. After two failed counters: civil-escalation.
 *
 * @param item - The disputed negative item
 * @param bureau - Bureau that issued the frivolous determination
 * @param passNumber - Current pass number at time of frivolous determination
 * @param priorFrivolousCount - Number of prior frivolous determinations for this item
 * @param frivolousDateISO - ISO timestamp when the frivolous determination was received
 */
export function buildFrivolousChallengePlan(
  item: NegativeItem,
  bureau: string,
  passNumber: PassNumber,
  priorFrivolousCount: number = 0,
  frivolousDateISO: string = new Date().toISOString()
): FrivolousChallengePlan {
  // Determine counter tier based on how many times this item has been labelled frivolous
  const tier: FrivolousCounterTier =
    priorFrivolousCount === 0 ? 'demand-notice' :
    priorFrivolousCount === 1 ? 'cure-and-refile' :
    'civil-escalation';

  // Calculate dispatch delay — give the bureau 5 business days to send its notice,
  // then follow up immediately after. Civil escalation goes out with no delay.
  const dispatchDelayDays =
    tier === 'demand-notice' ? 3 :      // Send counter quickly — bureau has 5d obligation
    tier === 'cure-and-refile' ? 1 :    // After receiving (or not receiving) notice
    0;                                   // Civil escalation: immediate

  const noticeRequirements = getFrivolousNoticeRequirements(frivolousDateISO);

  const directiveHeader =
    `\n\nFRIVOLOUS RESPONSE COUNTER-ATTACK (${tier.toUpperCase()}) — ${item.creditorName} @ ${bureau}\n` +
    `Bureau issued frivolous determination on ${new Date(frivolousDateISO).toLocaleDateString()}.\n` +
    `Prior frivolous challenges filed: ${priorFrivolousCount}.\n` +
    `Notice overdue: ${noticeRequirements.noticeOverdue ? 'YES — bureau has already violated §611(a)(3)(B)' : 'NOT YET'}.\n\n`;

  return {
    tier,
    promptDirective: directiveHeader + DIRECTIVES[tier],
    primaryCitation: tier === 'demand-notice'
      ? 'FCRA §611(a)(3)(B) — Written notice of frivolous determination required'
      : tier === 'cure-and-refile'
      ? 'FCRA §611(a)(4) — Reinvestigation duty restored after consumer cures dispute'
      : 'FCRA §616 — Willful noncompliance; civil liability for frivolous shield abuse',
    recommendedTarget: tier === 'civil-escalation' ? 'cfpb' : 'bureau',
    dispatchDelayDays,
    summary:
      tier === 'demand-notice'
        ? `${bureau} labelled dispute frivolous. Demanding §611(a)(3)(B) written notice within 10 business days.`
        : tier === 'cure-and-refile'
        ? `Curing ${bureau} frivolous determination. Providing specific new information to force §611(a)(4) reinvestigation.`
        : `${bureau} has repeatedly abused frivolous exemption. CFPB complaint + §616 civil liability notice filed.`,
  };
}

/**
 * Get the statutory notice requirements for a frivolous determination.
 * FCRA §611(a)(3)(B) requires written notice within 5 business days.
 */
export function getFrivolousNoticeRequirements(
  frivolousDateISO: string
): FrivolousNoticeRequirements {
  const frivolousDate = new Date(frivolousDateISO);
  // 5 business days = approximately 7 calendar days
  const noticeDue = new Date(frivolousDate);
  noticeDue.setDate(noticeDue.getDate() + 7);

  return {
    requiredElements: [
      'All information in the consumer\'s file regarding the disputed item (FCRA §611(a)(3)(B)(i))',
      'The specific bases upon which the bureau determined the dispute was frivolous or irrelevant (FCRA §611(a)(3)(B)(ii))',
    ],
    noticeDueBy: noticeDue.toISOString(),
    noticeOverdue: Date.now() > noticeDue.getTime(),
  };
}

/**
 * Get a one-line frivolous challenge summary for dashboard display.
 * Shows the active counter tier and the bureau that issued the determination.
 */
export function getFrivolousChallengeSummary(
  bureau: string,
  priorFrivolousCount: number
): string {
  const tier: FrivolousCounterTier =
    priorFrivolousCount === 0 ? 'demand-notice' :
    priorFrivolousCount === 1 ? 'cure-and-refile' :
    'civil-escalation';

  const labels: Record<FrivolousCounterTier, string> = {
    'demand-notice': 'Demanding §611(a)(3)(B) notice',
    'cure-and-refile': 'Curing dispute + invoking §611(a)(4)',
    'civil-escalation': 'CFPB complaint + §616 civil action',
  };

  return `${bureau} frivolous counter [${labels[tier]}]`;
}
