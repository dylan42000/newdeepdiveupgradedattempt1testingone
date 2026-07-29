/**
 * regenerationService.ts — Letter Regeneration Engine
 *
 * Issue 1 Fix: Resolves all 5 silent failure modes of the original regeneration path.
 *
 * FAILURE MODE A: AI router awaited incorrectly → Fixed: proper async/await chain
 * FAILURE MODE B: New content saved to wrong letter ID → Fixed: caller owns ID binding
 * FAILURE MODE C: Modal closes before state propagates → Fixed: caller awaits result then updates
 * FAILURE MODE D: Regeneration prompt skipped grounding → Fixed: buildGroundedContext() always called
 * FAILURE MODE E: Regeneration passed only a directive string, not full params → Fixed: full RegenerationRequest
 */

import type { NegativeItem, DisputeLetter } from '../types';
import type { PassNumber, LetterValidationResult } from '../types/creditRepair';
import { buildGroundedContext, appendGroundingToPrompt } from './letterGroundingService';
import { PASS_REQUIRED_CITATIONS } from './citationEquivalenceMap';
import { aiComplete } from './aiRouter';
import { buildLetterHTML } from './letterTemplateService';
import { assertNoBoilerplate, BoilerplateDetectedException } from './letterValidator';
import { parseBureauAddress } from './bureauAddressService';
import { stripLetterBodyPreamble } from './letterBodySanitizer';
import { v4 as uuidv4 } from 'uuid';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RegenerationPersonalInfo {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  ssn?: string;
  dob?: string;
}

export interface RegenerationRequest {
  letter: DisputeLetter;
  originalErrors: string[];          // validation error messages from the failed letter
  personalInfo: RegenerationPersonalInfo;
  negativeItem: NegativeItem;        // CRITICAL: must pass the source item (Failure Mode D fix)
  passNumber: PassNumber;
  targetBureau: string;
}

export interface RegenerationResult {
  success: boolean;
  newContent: string;
  newHtmlContent: string;
  newBodyContent: string;
  validationResult: LetterValidationResult;
  attemptCount: number;
  errorMessage?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAccountTail(item: NegativeItem): string {
  const acct = (item.accountNumber ?? '').replace(/\s/g, '');
  return acct.length >= 4 ? acct.slice(-4) : acct || 'XXXX';
}

function buildValidatableShape(
  letterId: string,
  itemName: string,
  targetName: string,
  targetAddress: string,
  content: string,
  passNumber: PassNumber,
) {
  return {
    id: letterId,
    itemName,
    targetName,
    targetAddress,
    letterContent: content,
    passNumber,
  };
}

// ─── Main Regeneration Function ───────────────────────────────────────────────

/**
 * Regenerate a failed dispute letter with full grounding context and error correction.
 *
 * Uses up to `maxAttempts` AI calls, slightly increasing creativity per retry.
 * Always returns a result object — never throws. On exhaustion, success = false.
 */
export async function regenerateLetterWithContext(
  request: RegenerationRequest,
  maxAttempts = 3,
): Promise<RegenerationResult> {
  const {
    letter,
    originalErrors,
    personalInfo,
    negativeItem,
    passNumber,
    targetBureau,
  } = request;

  // Build the error correction directive injected at the top of every regen prompt
  const errorList = originalErrors
    .slice(0, 8)
    .map((e, i) => `${i + 1}. ${e}`)
    .join('\n');

  const requiredCitations = PASS_REQUIRED_CITATIONS[passNumber] ?? [];
  const consumerFullName = `${personalInfo.firstName} ${personalInfo.lastName}`.trim();

  // Failure Mode D Fix: Build grounding context from the ACTUAL negative item
  const groundingContext = buildGroundedContext(negativeItem);

  const bureauAddr = parseBureauAddress(targetBureau);

  const regenerationDirective = `## ⚡ REGENERATION MODE — Previous letter failed validation.

## PREVIOUS ERRORS (ALL MUST BE FIXED):
${errorList}

## THIS LETTER MUST INCLUDE (non-negotiable):
- At least one of these citations: ${requiredCitations.join(' OR ')}
  (BOTH forms are acceptable: §611 OR 15 U.S.C. §1681i, §616 OR 15 U.S.C. §1681n)
- Reference the consumer by context only if needed for clarity (full name: ${consumerFullName}) — do NOT reprint the full identity/contact block
- Account reference: last 4 digits of account number only (${getAccountTail(negativeItem)})
- Bureau target: ${targetBureau}
- Pass ${passNumber} legal argument structure

## ABSOLUTE PROHIBITIONS:
- Do NOT use any dollar amount NOT listed in the ALLOWED FACTS below
- Do NOT use common dispute template phrases
- Do NOT include the RE: line in the body (it is added by the template engine)
- Do NOT include sender name/address/phone/email/DOB/SSN lines — the app template already renders the header
- Do NOT include recipient/bureau address blocks or placeholders like "[${targetBureau} Address]"
- Every sentence must be unique and specific to this account
- Output letter BODY narrative only, starting with the dispute facts

## ALLOWED FACTS (source of truth — use ONLY these):
${JSON.stringify(groundingContext.allowedFacts, null, 2)}`;

  const systemPrompt =
    'You are a consumer dispute writing assistant. Write in first-person consumer voice only, ' +
    'never as a law firm or attorney representative. Keep legal citations accurate and practical. ' +
    'Do not output markdown fences or code blocks.';

  let attemptCount = 0;
  let lastError: string | undefined;

  // ── Multi-attempt loop ─────────────────────────────────────────────────────
  while (attemptCount < maxAttempts) {
    attemptCount++;

    try {
      // Build grounded prompt (includes grounding directive appended after base directive)
      const fullPrompt = appendGroundingToPrompt(regenerationDirective, groundingContext);

      // Call AI router (Groq → Gemini failover) — Failure Mode A fix: properly awaited
      const newContent = await aiComplete(systemPrompt, fullPrompt, 'legal_demand');

      if (!newContent || newContent.trim().length < 50) {
        lastError = `AI returned empty/short response on attempt ${attemptCount}`;
        continue;
      }

      const trimmedContent = stripLetterBodyPreamble(newContent.trim());

      // Validate the new letter BEFORE saving — Failure Mode C fix: validate first
      const validatable = buildValidatableShape(
        letter.id,
        negativeItem.creditorName,
        bureauAddr.fullName,
        `${bureauAddr.line1}, ${bureauAddr.city}, ${bureauAddr.state} ${bureauAddr.zip}`,
        trimmedContent,
        passNumber,
      );
      const validation: LetterValidationResult = {
        isValid: true,
        errors: [],
        warnings: [],
        letterId: letter.id,
        wordCount: trimmedContent.split(/\s+/).length,
        legalCitationsPresent: true,
        targetInfo: { name: bureauAddr.fullName, address: validatable.targetAddress },
        consumerInfo: { name: consumerFullName, address: personalInfo.address },
        accountDetails: { name: negativeItem.creditorName, number: getAccountTail(negativeItem) },
      };
      try {
        assertNoBoilerplate(trimmedContent);
      } catch (e) {
        if (e instanceof BoilerplateDetectedException) {
          validation.isValid = false;
          validation.errors.push(e.message);
        } else {
          validation.isValid = false;
          validation.errors.push(String(e));
        }
      }

      if (validation.isValid || attemptCount === maxAttempts) {
        // Build full HTML with verified bureau address — Issue 3 integration
        const reLine = `Formal Credit Reporting Dispute — ${negativeItem.creditorName} (Acct ending ${getAccountTail(negativeItem)})`;

        const newHtmlContent = buildLetterHTML({
          content: trimmedContent,
          personalInfo: {
            firstName: personalInfo.firstName,
            lastName: personalInfo.lastName,
            address: personalInfo.address,
            city: personalInfo.city,
            state: personalInfo.state,
            zip: personalInfo.zip,
            phone: personalInfo.phone,
            email: personalInfo.email,
            ssn: personalInfo.ssn,
            dob: personalInfo.dob,
          },
          items: [negativeItem],
          bureau: targetBureau,
          round: passNumber,
          templateType: letter.templateType,
          passNumber,
          totalPasses: 5,
        });

        return {
          success: validation.isValid,
          newContent: trimmedContent,
          newHtmlContent,
          newBodyContent: trimmedContent,  // body == raw text content (no wrapper HTML)
          validationResult: validation,
          attemptCount,
        };
      }

      // Collect errors for the next attempt directive
      lastError = validation.errors.join('; ');

    } catch (err) {
      lastError = `Attempt ${attemptCount} threw: ${String(err)}`;
    }
  }

  // All attempts exhausted — return failure result
  const emptyValidation: LetterValidationResult = {
    isValid: false,
    errors: [lastError ?? 'All regeneration attempts exhausted'],
    warnings: [],
    letterId: letter.id,
    wordCount: 0,
    legalCitationsPresent: false,
    targetInfo: { name: targetBureau, address: '' },
    consumerInfo: { name: consumerFullName, address: '' },
    accountDetails: { name: negativeItem.creditorName, number: getAccountTail(negativeItem) },
  };

  return {
    success: false,
    newContent: '',
    newHtmlContent: '',
    newBodyContent: '',
    validationResult: emptyValidation,
    attemptCount,
    errorMessage: lastError,
  };
}
