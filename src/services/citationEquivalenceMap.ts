/**
 * citationEquivalenceMap.ts — FCRA/FDCPA Citation Equivalence Registry
 *
 * BUG-02 FIX: The validator was using naive string matching (e.g., §611).
 * This map makes §611 and 15 U.S.C. §1681i legally equivalent for all validation.
 * All citation checks must flow through citationPresent() from this file.
 * Both short-form (§611) and long-form (15 U.S.C. §1681i) are equally valid.
 */

export type CitationKey =
  | '§609'
  | '§611'
  | '§612'
  | '§613'
  | '§615'
  | '§616'
  | '§617'
  | '§623'
  | '§605'
  | '§605A'
  | '§625'
  | 'FCRA'
  | 'FDCPA'
  | 'CFPB'
  | 'FACTA'
  | 'Reg V';

/**
 * Every textual form that a given citation might appear as in a generated letter.
 * All forms within a group are legally identical — a match on ANY form counts.
 */
export const CITATION_EQUIVALENCES: Record<CitationKey, string[]> = {
  '§609':  ['§609',  '§1681g',   '15 U.S.C. §1681g',   'FCRA §609',  'FCRA Section 609',  '1681g'],
  '§611':  ['§611',  '§1681i',   '15 U.S.C. §1681i',   'FCRA §611',  'FCRA Section 611',  '1681i'],
  '§612':  ['§612',  '§1681j',   '15 U.S.C. §1681j',   'FCRA §612',  'FCRA Section 612',  '1681j'],
  '§613':  ['§613',  '§1681k',   '15 U.S.C. §1681k',   'FCRA §613',  'FCRA Section 613',  '1681k'],
  '§615':  ['§615',  '§1681m',   '15 U.S.C. §1681m',   'FCRA §615',  'FCRA Section 615',  '1681m'],
  '§616':  ['§616',  '§1681n',   '15 U.S.C. §1681n',   'FCRA §616',  'FCRA Section 616',  '1681n'],
  '§617':  ['§617',  '§1681o',   '15 U.S.C. §1681o',   'FCRA §617',  'FCRA Section 617',  '1681o'],
  '§623':  ['§623',  '§1681s-2', '15 U.S.C. §1681s-2', 'FCRA §623',  'FCRA Section 623',  '1681s-2'],
  '§605':  ['§605',  '§1681c',   '15 U.S.C. §1681c',   'FCRA §605',  'FCRA Section 605',  '1681c'],
  '§605A': ['§605A', '§1681c-1', '15 U.S.C. §1681c-1', 'FCRA §605A', 'FCRA Section 605A', '1681c-1'],
  '§625':  ['§625',  '§1681t',   '15 U.S.C. §1681t',   'FCRA §625',  'FCRA Section 625',  '1681t'],
  'FCRA':  ['FCRA',  '15 U.S.C.',  'Fair Credit Reporting Act'],
  'FDCPA': ['FDCPA', '15 U.S.C. §1692', 'Fair Debt Collection Practices Act', '§1692'],
  'CFPB':  ['CFPB',  'Consumer Financial Protection Bureau', 'consumerfinance.gov'],
  'FACTA': ['FACTA', 'Fair and Accurate Credit Transactions Act'],
  'Reg V': ['Reg V', '§1022.43', 'Regulation V', '12 C.F.R. Part 1022'],
};

/**
 * Minimum required citations per pass number.
 * All keys in each array must be present (AND logic) for the pass to validate.
 */
export const PASS_REQUIRED_CITATIONS: Record<number, CitationKey[]> = {
  1: ['FCRA', '§611'],
  2: ['FCRA', '§611'],
  3: ['FCRA', '§616', '§611'],
  4: ['CFPB', 'FCRA', '§616'],
  5: ['FCRA', 'CFPB', '§616'],
};

/**
 * Check if a citation key (or any of its legal equivalents) appears anywhere in content.
 * Case-insensitive. Handles §611 ↔ 15 U.S.C. §1681i and all other known equivalences.
 */
export function citationPresent(content: string, citationKey: CitationKey | string): boolean {
  const equivalents = CITATION_EQUIVALENCES[citationKey as CitationKey] ?? [citationKey];
  const lower = content.toLowerCase();
  return equivalents.some(eq => lower.includes(eq.toLowerCase()));
}

/**
 * Validate that all required citations for a given pass number are present.
 * Returns which citations were found and which are missing.
 */
export function validatePassCitations(
  content: string,
  passNumber: number,
): { passed: boolean; missing: CitationKey[]; found: CitationKey[] } {
  const required = PASS_REQUIRED_CITATIONS[passNumber] ?? [];
  const found: CitationKey[] = [];
  const missing: CitationKey[] = [];

  for (const key of required) {
    if (citationPresent(content, key)) {
      found.push(key);
    } else {
      missing.push(key);
    }
  }

  return { passed: missing.length === 0, missing, found };
}

/**
 * Extract all recognized CitationKey values present in the content.
 * Useful for auditing what laws a letter actually cites.
 */
export function extractAllCitations(content: string): CitationKey[] {
  return (Object.keys(CITATION_EQUIVALENCES) as CitationKey[]).filter(
    key => citationPresent(content, key),
  );
}
