import type { DisputeLetterRequest, GeneratedLetter } from './letterGeneratorV2';
import { getResolvedAccountNumber } from './tradelineMerger';

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'not clearly stated';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function accountToken(req: DisputeLetterRequest): string {
  return req.item ? getResolvedAccountNumber(req.item) : req.account.reconstructedAccountNumber || 'as displayed on my credit report';
}

function buildIssueParagraph(req: DisputeLetterRequest): string {
  const flag = req.metro2Flags[0];
  if (flag) {
    return `The specific issue I dispute is ${flag.description.replace(/\.$/, '')}. I am asking you to investigate that reported field using the underlying account records and correct it to the accurate value. If the information cannot be verified as accurate and complete, please delete the inaccurate information from my file.`;
  }

  const status = req.item?.status || req.account.status || 'the reported negative status';
  const balance = req.item?.balance ?? req.account.balance;
  const details = req.item?.additionalInfo?.trim();
  return `I dispute the accuracy and completeness of the reported status (${status}) and balance (${money(balance)})${details ? ` because my report also states: ${details}` : ''}. Please compare each disputed field with the underlying account records and correct any value that is inaccurate or incomplete. If the information cannot be verified as accurate and complete, please delete the affected reporting.`;
}

function roundParagraph(req: DisputeLetterRequest): string {
  if (req.passNumber === 1) return 'This is my initial written dispute concerning these specific reported fields.';
  if (req.passNumber === 2) return 'My earlier dispute did not resolve these specific reporting concerns. I am requesting a new review focused on the unresolved fields described above and a written explanation of the result.';
  if (req.passNumber === 3) return 'Prior reporting reviews have not resolved the identified discrepancy. Please investigate the underlying account-level data and notify every consumer reporting company to which an inaccurate value was furnished.';
  if (req.passNumber === 4) return 'The prior result did not explain how the unresolved fields were determined to be accurate. Please provide the appropriate description of the procedure used and correct or delete any information that cannot be verified.';
  if (req.passNumber === 5) return 'I have preserved my prior correspondence and results. I am requesting a final documented review before I decide whether to submit the complete record to the appropriate consumer-protection agency.';
  return 'This is my final written effort to resolve the documented reporting issue. Please preserve the account and dispute records and provide written confirmation of the accurate resolution. I may seek qualified legal advice if the issue remains unresolved.';
}

export function renderDeterministicDisputeLetter(req: DisputeLetterRequest): GeneratedLetter {
  const body = [
    `My ${req.bureau} credit file reports ${req.account.creditorName} under account identifier ${accountToken(req)}.`,
    buildIssueParagraph(req),
    roundParagraph(req),
    'Please send me the written results of your investigation and an updated credit report if the reporting changes. I am keeping a copy of this correspondence and its enclosures for my records.',
  ].join('\n\n');

  return {
    body,
    persona: 'consumer_factual_fallback',
    passNumber: req.passNumber,
    bureau: req.bureau,
    metro2FlagsUsed: req.metro2Flags,
    requiresDisclosure: false,
    generatedAt: new Date().toISOString(),
  };
}
