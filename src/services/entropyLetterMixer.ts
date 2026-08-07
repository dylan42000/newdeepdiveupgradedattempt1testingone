import type { LetterDNA } from './letterDNA';

export interface EntropyMix {
  sentenceOrderSeed: number;
  legalCitationFormat: 'inline' | 'parenthetical';
  paragraphCount: number;
  demandPhrasing: string;
  variantIndex: number;
}

function djb2Hash(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) + input.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return Math.abs(hash);
}

const DEMAND_PHRASING_VARIANTS: string[] = [
  'Submit verified, documentary proof of every disputed data field within thirty (30) days, or delete the tradeline and confirm in writing.',
  'Produce the original source documentation underlying each reported data point within the statutory reinvestigation period, or permanently suppress this entry.',
  'Furnish admissible evidence substantiating accuracy and completeness for each item challenged herein, or effect immediate deletion and notify all CRAs to which it was supplied.',
  'Within thirty (30) days, provide itemized documentation tracing the reported balance, DOFD, and status to primary records, or remove the account and certify compliance.',
  'Demonstrate, through contemporaneous business records, that every disputed element complies with Metro 2 and FCRA standards; failure to do so mandates deletion and written confirmation.',
];

export function generateEntropyMix(dna: LetterDNA, round: number): EntropyMix {
  const seedString = `${dna.accountFingerprint}|${round}|${dna.legalAngle}`;
  const hash = djb2Hash(seedString);
  const legalCitationFormat: EntropyMix['legalCitationFormat'] = hash % 2 === 0 ? 'inline' : 'parenthetical';
  const paragraphCount = 3 + (hash % 3); // 3, 4, or 5 paragraphs
  const variantIndex = hash % DEMAND_PHRASING_VARIANTS.length;
  const demandPhrasing = DEMAND_PHRASING_VARIANTS[variantIndex];

  return {
    sentenceOrderSeed: hash % 1000,
    legalCitationFormat,
    paragraphCount,
    demandPhrasing,
    variantIndex,
  };
}
