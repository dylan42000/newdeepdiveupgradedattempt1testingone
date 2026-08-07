/**
 * cfpbComplaintGenerator.ts — CFPB Complaint Pack Generator (Pass 5)
 * Builds a complete CFPB complaint package for escalation after failed disputes.
 */

import { aiComplete } from './aiRouter';
import { getAGAddress } from '../data/stateAGAddresses';
import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem } from '../types';
import { getResolvedAccountNumber } from './tradelineMerger';
import type { DisputeEventV2, CFPBComplaintPack } from '../types/creditRepair';

const CFPB_SUBMIT_URL = 'https://www.consumerfinance.gov/complaint/';
const FTC_SUBMIT_URL = 'https://reportfraud.ftc.gov/';

/** Build a CFPB complaint pack for a single item after Pass 4 failure */
export async function generateCFPBComplaintPack(
  item: NegativeItem,
  profileId: string,
  disputeHistory: DisputeEventV2[],
  userInfo: {
    firstName: string;
    lastName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    email: string;
    phone: string;
  }
): Promise<CFPBComplaintPack> {
  const historyText = disputeHistory
    .slice(-10)
    .map(e => `[${new Date(e.timestamp).toLocaleDateString()}] ${e.type}: ${e.detail}`)
    .join('\n');

  const bureauSummary = item.creditBureau.length > 0 ? item.creditBureau.join(', ') : 'Unknown';

  const userPrompt = `Draft a first-person CFPB complaint for the named consumer. The consumer is the author and submitter. Never use client, on behalf of, our office, or representative language.

ITEM DETAILS:
- Account: ${item.creditorName} (${getResolvedAccountNumber(item) || 'N/A'})
- Type: ${item.typeOfNegative}
- Amount: $${item.balance ?? 0}
- Bureau(s): ${bureauSummary}
- Date Opened: ${item.originalOpeningDate ?? 'Unknown'}
- Last Reported: ${item.dateOfLastReporting ?? 'Unknown'}
- Current Status: ${item.status ?? 'Disputed'}

DISPUTE HISTORY (last 10 events):
${historyText}

CONSUMER INFO:
Name: ${userInfo.firstName} ${userInfo.lastName}
State: ${userInfo.state}

Write a formal CFPB complaint narrative (3-5 paragraphs, plain prose, no markdown) that:
1. Identifies the company and describes the problem clearly
2. Explains how you tried to resolve it (cite dispute dates and rounds)
3. States what happened (bureau/furnisher responses or lack thereof)
4. Explains the impact on the consumer
5. States the desired resolution specifically

Be factual, professional, and cite FCRA sections 611, 623, and 605 where relevant.
Output only the complaint narrative text.`;

  let narrativeText = '';
  try {
    const result = await aiComplete(
      'You draft legally precise CFPB complaint narratives grounded in FCRA timelines and obligations.',
      userPrompt,
      'cfpb_narrative'
    );
    narrativeText = result.trim();
  } catch {
    narrativeText = buildFallbackNarrative(item, userInfo, disputeHistory);
  }

  const agInfo = getAGAddress(userInfo.state);
  const stateAGAddress = agInfo
    ? `${agInfo.office}\n${agInfo.address}\n${agInfo.city}, ${agInfo.stateAbbr} ${agInfo.zip}`
    : '';

  const stateAGDraft = agInfo ? `To: ${agInfo.office}

I am submitting a formal state consumer protection complaint regarding ${item.creditorName} for continued reporting of disputed credit information after repeated FCRA disputes.

Account: ${item.creditorName} (${getResolvedAccountNumber(item) || 'N/A'})
State: ${userInfo.state}
Summary: ${historyText || 'Multiple dispute rounds were submitted and unresolved.'}

Requested relief: Order correction/deletion of inaccurate reporting, require documented investigation records, and enforce applicable state unfair practices laws.

Consumer:
${userInfo.firstName} ${userInfo.lastName}
${userInfo.address}
${userInfo.city}, ${userInfo.state} ${userInfo.zip}
${userInfo.phone} | ${userInfo.email}` : null;

  const pack: CFPBComplaintPack = {
    id: uuidv4(),
    itemId: item.id,
    profileId,
    generatedAt: new Date().toISOString(),
    bureauComplaintDraft: narrativeText,
    furnisherComplaintDraft: narrativeText,
    disputeHistorySummary: historyText || 'No dispute events recorded.',
    ftcReportDraft: `Company: ${item.creditorName}\nIssue: Inaccurate credit reporting after repeated dispute attempts\nRelief requested: Remove unverifiable data and cease adverse reporting.`,
    stateAGComplaintDraft: stateAGDraft,
    cfpbSubmissionUrl: CFPB_SUBMIT_URL,
    ftcSubmissionUrl: FTC_SUBMIT_URL,
    stateAGInfo: agInfo ? {
      state: agInfo.state,
      url: agInfo.complaintUrl,
      address: stateAGAddress,
    } : null,
  };

  return pack;
}

function buildFallbackNarrative(
  item: NegativeItem,
  userInfo: { firstName: string; lastName: string; state: string },
  history: DisputeEventV2[]
): string {
  const disputeCount = history.filter(e => e.type === 'pass_letter_sent').length;
  const firstDispute = history.find(e => e.type === 'pass_letter_sent');
  const firstDate = firstDispute ? new Date(firstDispute.timestamp).toLocaleDateString() : 'several months ago';

  return `I am writing to file a formal complaint against ${item.creditorName} and the credit reporting bureaus regarding an inaccurate, unverifiable, and disputed negative entry on my credit report.

The account in question is listed under the name "${item.creditorName}" with a reported balance of $${item.balance ?? 0} and is currently shown as "${item.status ?? 'derogatory'}" on my credit file. This item has been negatively affecting my credit score and my ability to obtain financing, housing, and employment opportunities.

I have submitted ${disputeCount} formal dispute letter(s) beginning on ${firstDate}, citing my rights under FCRA Sections 611 and 623, requesting that the bureaus and the furnisher verify the accuracy of this entry. Despite these repeated formal disputes, the item has not been corrected or removed, and I have not received adequate verification of the debt.

The furnisher's failure to conduct a reasonable investigation and provide verification, combined with the bureaus' failure to remove an unverifiable item, constitutes a violation of the Fair Credit Reporting Act. As a resident of ${userInfo.state}, I am entitled to accurate credit reporting and have the right to seek remediation through this agency.

I respectfully request that the CFPB investigate this matter and direct ${item.creditorName} and all reporting bureaus to immediately delete this item from my credit file, correct all reporting, and cease any further violations of my consumer rights under the FCRA.`;
}
