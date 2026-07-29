/**
 * directFurnisherEngine.ts — FCRA §623(a)(8) Direct Furnisher Dispute Engine
 * Generates letters that bypass bureaus and e-OSCAR entirely,
 * routing disputes directly to the data furnisher / creditor.
 */

import type { NegativeItem } from '../types';
import { getResolvedAccountNumber } from './tradelineMerger';
import type { LetterDNA } from './letterDNA';
import type { Metro2Flag } from './metro2AuditService';
import { routeAIRequest } from './aiRouter';
import { apiQueueManager } from './apiQueueManager';
import { CONSUMER_VOICE_POLICY, normalizeConsumerVoice, validateConsumerVoice } from './consumerVoicePolicy';
import { stripLetterBodyPreamble } from './letterBodySanitizer';

export interface DirectFurnisherProfile {
  consumerName: string;
  consumerAddress: string;
  todayDate: string;
  metro2Flags: Metro2Flag[];
  targetName: string;
  targetAddress: string;
}

export interface DirectDisputeResult {
  body: string;
  persona: string;
  passNumber: 3;
  bureau: string;
  metro2FlagsUsed: Metro2Flag[];
  requiresDisclosure: boolean;
  generatedAt: string;
}

/**
 * Generate a direct furnisher dispute letter under FCRA §623(a)(8).
 * This letter goes directly to the CREDITOR — never to a bureau, never through e-OSCAR.
 */
export async function generateDirectDispute(
  item: NegativeItem,
  profile: DirectFurnisherProfile,
  dna: LetterDNA
): Promise<DirectDisputeResult> {
  const taskId = `direct-dispute-${item.id}-${profile.targetName}`;

  return apiQueueManager.enqueue<DirectDisputeResult>(taskId, async (attempt) => {
    const prompt = buildDirectFurnisherPrompt(item, profile, dna);

    const systemPrompt =
      'Draft a precise first-person direct dispute from the named consumer to the data furnisher. ' +
      `${CONSUMER_VOICE_POLICY} ` +
      'Identify the specific reported field and basis. Do not claim every document is legally required, ' +
      'and do not claim that missing documents automatically require deletion.';

    const rawBody = await routeAIRequest(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      {
        taskType: 'letter',
        temperature: 0.7 + (attempt - 1) * 0.05,
        maxTokens: 1200,
      }
    );

    // Head-chopper failsafe: strip boilerplate openers
    let cleanBody = rawBody
      .replace(/^(I am writing to formally dispute|I am writing to dispute|I am writing regarding|This letter is to).*?\n/i, '')
      .trim();
    cleanBody = cleanBody.replace(/^(Dear .*?:|To Whom It May Concern:).*?\n/i, '').trim();

    cleanBody = normalizeConsumerVoice(cleanBody);
    cleanBody = stripLetterBodyPreamble(cleanBody);
    if (validateConsumerVoice(cleanBody).length > 0) {
      throw new Error('Direct furnisher draft did not use first-person consumer voice.');
    }

    if (cleanBody.trim().length < 200) {
      throw new Error(
        `Direct dispute letter too short: ${cleanBody.trim().length} chars (minimum 200)`
      );
    }

    return {
      body: cleanBody,
      persona: 'direct_furnisher_623a8',
      passNumber: 3,
      bureau: profile.targetName,
      metro2FlagsUsed: profile.metro2Flags,
      requiresDisclosure: false,
      generatedAt: new Date().toISOString(),
    };
  });
}

function buildDirectFurnisherPrompt(
  item: NegativeItem,
  profile: DirectFurnisherProfile,
  dna: LetterDNA
): string {
  const metro2Section =
    profile.metro2Flags.length > 0
      ? `\n\n=== METRO 2 COMPLIANCE VIOLATIONS (VERIFIED) ===\n` +
        profile.metro2Flags
          .map(
            (flag, i) =>
              `Finding ${i + 1}: Field "${flag.fieldCode}" — ${flag.description}\n` +
              `Severity: ${flag.severity} | FCRA Basis: ${flag.fcraReference}\n` +
              `Dispute Language: ${flag.disputeArgument}`
          )
          .join('\n\n')
      : '';

  return `
=== DIRECT FURNISHER DISPUTE — FCRA §623(a)(8) ===

CRITICAL INSTRUCTION: This letter is addressed DIRECTLY TO THE CREDITOR/DATA FURNISHER (${profile.targetName}).
It does NOT go to any credit bureau. It does NOT go through e-OSCAR.
This is a direct consumer dispute with the furnisher under 15 U.S.C. §1681s-2(a)(8).

CONSUMER: ${profile.consumerName}
ADDRESS: ${profile.consumerAddress}
DATE: ${profile.todayDate}

FURNISHER: ${profile.targetName}
ADDRESS: ${profile.targetAddress}

ACCOUNT: ${item.creditorName} — Account ${getResolvedAccountNumber(item) || 'on file'}
BALANCE: $${item.balance ?? 0}
ISSUE: ${item.typeOfNegative}

DNA FINGERPRINT: ${dna.accountFingerprint}
LEGAL ANGLE: ${dna.legalAngle}

=== MANDATORY DIRECTIVES ===

1. OPENING: Write as the consumer in first person. Identify the account token and the specific reported field in dispute. Do not discuss bypassing systems.

2. REQUEST RELEVANT ACCOUNT-LEVEL REVIEW: Ask the furnisher to review the records reasonably necessary to determine the accurate value of each specifically disputed field. Mention assignment records only when ownership or transfer is actually disputed.

3. OWNERSHIP/TRANSFER: If supplied facts show a sale or transfer conflict, ask the furnisher to investigate the ownership and transfer information. Do not assert lack of standing solely because documents were not enclosed with a response.

4. FCRA §623(a)(8) INVOCATION: The furnisher has a statutory duty to conduct a reasonable investigation of direct disputes and to review all relevant information provided by the consumer. Reference that the furnisher must complete this investigation within 30 days of receipt.

5. CORRECTION/DELETION: Request correction of inaccurate or incomplete information and notification to each CRA. Request deletion of affected reporting when it cannot be verified as accurate and complete.

6. TONE: Formal, legally precise, unyielding. No emotional language. No courtesy filler. Every sentence must serve a legal or documentary purpose.

7. FORMAT: Numbered allegations. Each disputed field must include:
   a. The specific data point in dispute
   b. What is being reported
   c. Why it is inaccurate or unverifiable without the original documents
   d. The specific FCRA subsection violated
   e. The exact corrective action demanded

8. CLOSING: Demand written confirmation within 30 days. Include a specific deadline date. No pleasantries.

${metro2Section}

Generate the direct furnisher dispute letter body now. Raw letter content only.
`.trim();
}
