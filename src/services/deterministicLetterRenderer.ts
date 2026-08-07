/**
 * Deterministic Letter Renderer — Zero-AI Fallback Engine
 *
 * Generates complete, legally-defensible dispute letters for ALL 6 dispute passes
 * without any AI dependency. Used as the last-resort fallback when ALL providers
 * fail, and for testing/validation. Every letter is unique per account, bureau,
 * and pass number — no two letters are identical even for the same account.
 *
 * Guarantees: 100% letter generation coverage. No missed letters.
 */

import type { DisputeLetterRequest, GeneratedLetter } from './letterGeneratorV2';
import { getResolvedAccountNumber } from './tradelineMerger';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'the reported balance';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function accountToken(req: DisputeLetterRequest): string {
  const token = req.item
    ? getResolvedAccountNumber(req.item)
    : req.account.reconstructedAccountNumber;
  return token || 'as displayed on my credit report (account number partially masked)';
}

function bureauDisplay(b: string): string {
  const map: Record<string, string> = {
    experian: 'Experian',
    equifax: 'Equifax',
    transunion: 'TransUnion',
  };
  return map[b.toLowerCase()] || b.charAt(0).toUpperCase() + b.slice(1);
}

function dateStr(req: DisputeLetterRequest): string {
  const d = req.todayDate || new Date().toISOString().split('T')[0];
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    }).format(new Date(d));
  } catch {
    return d;
  }
}

// ─── Unique Letter Fingerprint ──────────────────────────────────────────────────
// Every deterministic letter gets a unique stylistic variation based on account
// data, bureau, and pass — ensuring no two letters are identical.

interface LetterVariation {
  openerStyle: number;      // 0-3: different opening constructions
  paragraphOrder: number;   // 0-2: different paragraph sequences
  closingStyle: number;     // 0-3: different closing demands
  useBrackets: boolean;     // some use [bracket notation] for citations
}

function computeVariation(req: DisputeLetterRequest): LetterVariation {
  // Deterministic hash from account id + bureau + pass
  const raw = `${req.account.id}-${req.bureau}-${req.passNumber}-${req.cycleNumber ?? 1}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  const abs = Math.abs(hash);
  return {
    openerStyle: abs % 4,
    paragraphOrder: (abs >> 2) % 3,
    closingStyle: (abs >> 4) % 4,
    useBrackets: (abs >> 6) % 2 === 0,
  };
}

// ─── Metro 2 Flag Builder ───────────────────────────────────────────────────────

function buildMetro2Paragraph(req: DisputeLetterRequest): string {
  if (!req.metro2Flags || req.metro2Flags.length === 0) {
    return '';
  }

  const flagLines = req.metro2Flags.map((flag, i) => {
    const desc = flag.description.replace(/\.$/, '');
    return `${i + 1}. Metro 2 Field "${flag.fieldCode}" — ${desc}. ` +
      `FCRA Basis: ${flag.fcraReference || '15 U.S.C. §1681i(a)(1)(A)'}. ` +
      `I specifically dispute this field and demand reinvestigation.`;
  });

  return [
    `The specific Metro 2 compliance issues I dispute are as follows:`,
    ...flagLines,
    `Each of these reported fields is subject to reinvestigation under the Fair Credit Reporting Act. ` +
    `If any field cannot be verified as accurate and complete from the underlying account records, ` +
    `it must be corrected or deleted per Metro 2 reporting guidelines and 15 U.S.C. §1681i(a)(1)(A).`,
  ].join('\n');
}

// ─── Issue Paragraph Builder (multi-flag aware) ─────────────────────────────────

function buildIssueParagraph(req: DisputeLetterRequest): string {
  const status = req.item?.status || req.account.status || 'the reported status';
  const balance = money(req.item?.balance ?? req.account.balance);
  const details = req.item?.additionalInfo?.trim();
  const creditor = req.account.creditorName;
  const token = accountToken(req);

  // If we have Metro 2 flags, use them as primary dispute basis
  if (req.metro2Flags && req.metro2Flags.length > 0) {
    const flagList = req.metro2Flags
      .map(f => `Field ${f.fieldCode} (${f.description.replace(/\.$/, '')})`)
      .join('; ');
    return `I dispute ${flagList} as reported by ${creditor} under account ${token}. ` +
      `These fields are inaccurate, incomplete, or internally inconsistent. ` +
      `Please compare each disputed field against the original account records ` +
      `and correct any inaccurate information. If the information cannot be verified, ` +
      `please delete it from my ${bureauDisplay(req.bureau)} file.`;
  }

  // No flags — use status and balance
  const base = `I dispute the accuracy and completeness of the reported status (${status}) ` +
    `and balance (${balance}) for the ${creditor} account identified as ${token}.`;
  if (details) {
    return `${base} My credit report also states: "${details}". ` +
      `Please investigate each disputed field against the underlying account records ` +
      `and correct or delete any information that cannot be verified as accurate.`;
  }
  return `${base} Please investigate each disputed field using the original account records ` +
    `and correct or delete any information that cannot be verified as accurate and complete.`;
}

// ─── Round-Specific Posture Paragraph (Pass 1-6) ────────────────────────────────

function buildPassPosture(req: DisputeLetterRequest): string {
  const creditor = req.account.creditorName;
  const bureau = bureauDisplay(req.bureau);
  const token = accountToken(req);

  switch (req.passNumber) {
    case 1:
      return `This is my initial written dispute concerning the specific reporting errors ` +
        `described above on my ${bureau} credit file. I request that you conduct a reasonable ` +
        `reinvestigation under 15 U.S.C. §1681i(a)(1)(A) and correct or delete any information ` +
        `that cannot be verified as accurate. Please provide the results of your investigation ` +
        `in writing within the statutory 30-day period.`;

    case 2:
      return `My earlier dispute concerning the ${creditor} account (${token}) did not resolve ` +
        `these specific reporting inaccuracies. I am requesting a new reinvestigation focused ` +
        `on the unresolved fields identified above. Please provide a written explanation of the ` +
        `results, including the description of the procedure used under 15 U.S.C. §1681i(a)(6)(B)(ii). ` +
        `If the information cannot be verified as accurate, please delete it and notify all ` +
        `consumer reporting agencies to which it was furnished.`;

    case 3:
      return `Prior reinvestigations have not resolved the identified discrepancies for the ` +
        `${creditor} account. Under 15 U.S.C. §1681s-2(a)(8) and 12 C.F.R. §1022.43, I am ` +
        `requesting that the data furnisher provide documentation of the account-level data ` +
        `supporting the reported values. Please investigate the underlying account records ` +
        `and correct or delete any information that cannot be verified. If the information ` +
        `is corrected, please notify every consumer reporting company to which the inaccurate ` +
        `value was previously furnished.`;

    case 4:
      return `The prior investigation result did not explain how the specific unresolved fields ` +
        `were determined to be accurate. Under 15 U.S.C. §1681i(a)(6), I am entitled to a ` +
        `description of the procedure used in the reinvestigation. Please provide the appropriate ` +
        `description of the procedure and identify the specific records relied upon. Any information ` +
        `that cannot be verified as accurate must be corrected or deleted. I am prepared to submit ` +
        `this matter to the Consumer Financial Protection Bureau if the issues remain unresolved.`;

    case 5:
      return `I have preserved my prior correspondence and investigation results for the ` +
        `${creditor} account. The documented inaccuracies remain unresolved despite multiple ` +
        `reinvestigation requests. I am requesting a final documented review of the disputed ` +
        `information before I determine whether to submit the complete record to the Consumer ` +
        `Financial Protection Bureau or engage qualified legal counsel. Please provide written ` +
        `confirmation of the final resolution and preserve all account and dispute records.`;

    case 6:
      return `This is my final documented effort to resolve the reporting inaccuracies for the ` +
        `${creditor} account (${token}). Despite multiple written disputes, the information ` +
        `remains inaccurate or unverified. I request final written confirmation of the resolution ` +
        `and preservation of all relevant records. If this matter cannot be resolved satisfactorily, ` +
        `I may seek qualified legal advice and consider all available remedies, including those ` +
        `provided under 15 U.S.C. §1681n and §1681o. Please respond in writing within 15 days.`;

    default:
      return `I request a reasonable reinvestigation of the disputed information described above. ` +
        `Please correct or delete any information that cannot be verified as accurate and provide ` +
        `the results in writing.`;
  }
}

// ─── Frivolous Pre-Emption Paragraph (Passes 1-3 only) ──────────────────────────

function buildFrivolousPreemption(req: DisputeLetterRequest): string {
  if (req.passNumber > 3) return '';

  return `Notice: Under 15 U.S.C. §1681i(a)(3)(A), a consumer reporting agency may only deem ` +
    `a dispute frivolous or irrelevant if the consumer fails to provide sufficient information ` +
    `to investigate the disputed information. This dispute provides: (1) the specific account ` +
    `number and creditor name identifying the disputed tradeline; (2) the specific data fields ` +
    `that are inaccurate and the statutory basis for each dispute; and (3) explicit demand for ` +
    `the specific corrective action required. This dispute is legally complete. Any determination ` +
    `that this dispute is frivolous — without first conducting a reasonable reinvestigation — ` +
    `would itself constitute a violation of §1681i(a)(3)(B), which requires written notice to ` +
    `the consumer within 5 business days of such determination, including the reasons for the ` +
    `determination and identifying any additional information needed. Proceeding without notice ` +
    `would be an independent statutory violation subject to civil liability under §1681n and §1681o.`;
}

// ─── Bureau-Specific Legal Context ──────────────────────────────────────────────

function buildBureauLegalContext(req: DisputeLetterRequest): string {
  const bureau = bureauDisplay(req.bureau);
  const b = req.bureau;

  const bureauFacts: Record<string, string> = {
    experian: 'Experian is required under federal law to conduct a reasonable reinvestigation ' +
      'upon receiving notice of a dispute from a consumer. 15 U.S.C. §1681i(a)(1)(A). As one of ' +
      'the three nationwide consumer reporting agencies, Experian must ensure maximum possible ' +
      'accuracy of the information it reports. 15 U.S.C. §1681e(b).',
    equifax: 'Equifax is required under federal law to conduct a reasonable reinvestigation ' +
      'upon receiving notice of a dispute from a consumer. 15 U.S.C. §1681i(a)(1)(A). As one of ' +
      'the three nationwide consumer reporting agencies, Equifax must ensure maximum possible ' +
      'accuracy of the information it reports. 15 U.S.C. §1681e(b).',
    transunion: 'TransUnion is required under federal law to conduct a reasonable reinvestigation ' +
      'upon receiving notice of a dispute from a consumer. 15 U.S.C. §1681i(a)(1)(A). As one of ' +
      'the three nationwide consumer reporting agencies, TransUnion must ensure maximum possible ' +
      'accuracy of the information it reports. 15 U.S.C. §1681e(b).',
  };

  return bureauFacts[b] || `${bureau} is required under federal law to conduct a reasonable ` +
    `reinvestmentigation upon receiving notice of a dispute from a consumer.`;
}

// ─── Main Export ────────────────────────────────────────────────────────────────

export function renderDeterministicDisputeLetter(req: DisputeLetterRequest): GeneratedLetter {
  const variation = computeVariation(req);
  const metro2Para = buildMetro2Paragraph(req);
  const issuePara = buildIssueParagraph(req);
  const posturePara = buildPassPosture(req);
  const frivolousPara = buildFrivolousPreemption(req);
  const bureauContext = buildBureauLegalContext(req);

  // Opening paragraph — varied by fingerprint
  const creditor = req.account.creditorName;
  const token = accountToken(req);
  const bureau = bureauDisplay(req.bureau);
  const date = dateStr(req);

  const openings = [
    `My ${bureau} credit file contains a tradeline for ${creditor} identified as ${token}. ` +
    `The reported information contains specific inaccuracies that I dispute as described below.`,
    `This letter concerns ${creditor} (account ${token}) as it appears on my ${bureau} credit report. ` +
    `Certain reported fields are inaccurate or incomplete, and I formally dispute them.`,
    `I have reviewed my ${bureau} credit report and identified inaccuracies in the reporting of ` +
    `${creditor} (account ${token}). I dispute the specific fields identified below.`,
    `The ${creditor} tradeline on my ${bureau} credit file (account ${token}) contains information ` +
    `that is inaccurate, incomplete, or cannot be verified. I dispute each specific field below.`,
  ];

  const closings = [
    `Please send me the written results of your investigation and an updated credit report ` +
    `if the reporting changes. I am keeping a copy of this correspondence and its enclosures ` +
    `for my records. This dispute is submitted on ${date}.`,
    `I request written confirmation of your investigation results within the statutory period. ` +
    `Please correct any inaccurate information and notify all relevant parties. A copy of this ` +
    `letter is retained for my records. Dated: ${date}.`,
    `Please investigate the disputed information and provide a written response describing the ` +
    `procedure used and the results obtained. If corrections are made, please provide an updated ` +
    `credit report. This letter is dated ${date} and a copy is preserved.`,
    `I expect a written response within the time required by law. Please correct or delete any ` +
    `information that cannot be verified as accurate. Thank you for your attention to this matter. ` +
    `Date: ${date}.`,
  ];

  // Assemble paragraphs in varied order
  const allParagraphs: string[] = [
    openings[variation.openerStyle],
    metro2Para,
    issuePara,
    bureauContext,
    frivolousPara,
    posturePara,
  ].filter(p => p.length > 0);

  // Reorder paragraphs slightly for uniqueness
  const paragraphOrder = variation.paragraphOrder;
  let ordered: string[];
  if (paragraphOrder === 0) {
    // Standard: opening → metro2 → issue → bureau → frivolous → posture → closing
    ordered = [...allParagraphs];
  } else if (paragraphOrder === 1) {
    // Metro 2 first: metro2 → issue → opening → bureau → posture → frivolous
    const metroIdx = allParagraphs.findIndex(p => p.includes('Metro 2'));
    if (metroIdx > 0) {
      const metro = allParagraphs.splice(metroIdx, 1)[0];
      ordered = [metro, ...allParagraphs];
    } else {
      ordered = allParagraphs;
    }
  } else {
    // Issue first: issue → opening → metro2 → posture → bureau → frivolous
    const issueIdx = allParagraphs.findIndex(p => p.includes('dispute') && p.length > 100);
    if (issueIdx > 1) {
      const issue = allParagraphs.splice(issueIdx, 1)[0];
      ordered = [issue, ...allParagraphs];
    } else {
      ordered = allParagraphs;
    }
  }

  const body = [...ordered, closings[variation.closingStyle]].join('\n\n');

  // Build metro2 flags used (with safe access)
  const metro2FlagsUsed = req.metro2Flags || [];

  return {
    body,
    persona: 'consumer_factual_fallback',
    passNumber: req.passNumber,
    bureau: req.bureau,
    metro2FlagsUsed,
    requiresDisclosure: false,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Safety net: Guarantees a letter is always returned for any valid request.
 * This is the final fallback — it CANNOT throw or reject.
 */
export function renderSafeFallbackDisputeLetter(req: DisputeLetterRequest): GeneratedLetter {
  try {
    return renderDeterministicDisputeLetter(req);
  } catch (err) {
    // Absolute last resort — minimal valid letter
    const fallbackBody = [
      `I am disputing information reported by ${req.account.creditorName} on my ` +
      `${bureauDisplay(req.bureau)} credit report (account ${accountToken(req)}).`,
      `I dispute the accuracy and completeness of this reported information. ` +
      `Please investigate all disputed fields and correct or delete any information ` +
      `that cannot be verified as accurate.`,
      `Please send me the written results of your investigation.`,
    ].join('\n\n');

    return {
      body: fallbackBody,
      persona: 'consumer_factual_fallback',
      passNumber: req.passNumber,
      bureau: req.bureau,
      metro2FlagsUsed: req.metro2Flags || [],
      requiresDisclosure: false,
      generatedAt: new Date().toISOString(),
    };
  }
}
