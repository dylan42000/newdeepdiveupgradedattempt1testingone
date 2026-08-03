import type { NegativeItem } from '../../../types';
import type { MergeDecisionTier } from '../../tradelineMerger';

export interface MergeGoldenCase {
  id: string;
  description: string;
  items: NegativeItem[];
  /** Pairwise expectations when items.length === 2 */
  pairIndex?: [number, number];
  expectedDecision: MergeDecisionTier | MergeDecisionTier[];
  /** Never allow AUTO_MERGE for adversarial cases */
  forbidAutoMerge?: boolean;
  /** For true-merge cases: stitched account should end with this suffix */
  expectStitchedEndsWith?: string;
  /** For true-merge cases: stitched account should contain these digit runs */
  expectStitchedContains?: string[];
  /** Expect buildTradelineMergePlan to produce one auto group of this size */
  expectAutoGroupSize?: number;
}

function baseItem(overrides: Partial<NegativeItem> & Pick<NegativeItem, 'id' | 'creditorName' | 'accountNumber' | 'creditBureau'>): NegativeItem {
  return {
    balance: null,
    typeOfNegative: 'Collection',
    originalDateOfDelinquency: null,
    dateOfLastReporting: null,
    originalOpeningDate: null,
    status: 'Open',
    additionalInfo: '',
    disputeRound: 1,
    disputeStatus: 'Undisputed',
    lastDisputeDate: null,
    disputeDeadline: null,
    priorityScore: 50,
    estimatedScoreImpact: null,
    notes: [],
    solDropDate: null,
    ...overrides,
  };
}

export const mergeGoldenCases: MergeGoldenCase[] = [
  {
    id: 'true-3-bureau-mask-stitch',
    description: 'True 3-bureau mask stitch (EQ ****1234 / EX ****1234 / TU 123456****1234)',
    pairIndex: [0, 2],
    items: [
      baseItem({
        id: 'eq-chase-1',
        creditorName: 'JPMORGAN CHASE',
        accountNumber: '****1234',
        balance: 1842,
        creditBureau: ['Equifax'],
        dateOpened: '2019-03-15',
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'ex-chase-1',
        creditorName: 'JPMCB CARD SERVICES',
        accountNumber: 'XXXX-XXXX-1234',
        balance: 1845,
        creditBureau: ['Experian'],
        dateOpened: '2019-03-15',
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'tu-chase-1',
        creditorName: 'CHASE',
        accountNumber: '123456****1234',
        balance: 1840,
        creditBureau: ['TransUnion'],
        dateOpened: '2019-03-20',
        accountType: 'Credit Card',
      }),
    ],
    expectedDecision: 'AUTO_MERGE',
    expectStitchedEndsWith: '1234',
    expectStitchedContains: ['123456', '1234'],
    expectAutoGroupSize: 3,
  },
  {
    id: 'true-alias-last4-cap1',
    description: 'Alias-only CAP1 ↔ Capital One + matching last4 → AUTO_MERGE',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-cap1',
        creditorName: 'CAP1',
        accountNumber: '****4821',
        balance: 2100,
        creditBureau: ['Equifax'],
        typeOfNegative: 'Charge-Off',
        status: 'Charge-off',
      }),
      baseItem({
        id: 'tu-capone',
        creditorName: 'Capital One Bank USA NA',
        accountNumber: '5512****4821',
        balance: 2115,
        creditBureau: ['TransUnion'],
        typeOfNegative: 'Charge-Off',
        status: 'Charged Off',
      }),
    ],
    expectedDecision: 'AUTO_MERGE',
    expectStitchedEndsWith: '4821',
    expectStitchedContains: ['5512', '4821'],
  },
  {
    id: 'true-masked-reconstruction',
    description: 'Masked reconstruction ****4821 + 5512****4821 with alias → AUTO_MERGE',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'ex-mask-a',
        creditorName: 'MIDLAND CREDIT MANAGEMENT',
        accountNumber: '****9910',
        balance: 640,
        creditBureau: ['Experian'],
        typeOfNegative: 'Collection',
        status: 'Collection',
      }),
      baseItem({
        id: 'eq-mask-b',
        creditorName: 'MCM',
        accountNumber: '4400****9910',
        balance: 638,
        creditBureau: ['Equifax'],
        typeOfNegative: 'Collection',
        status: 'Open Collection',
      }),
    ],
    expectedDecision: 'AUTO_MERGE',
    expectStitchedEndsWith: '9910',
    expectStitchedContains: ['4400', '9910'],
  },
  {
    id: 'true-prefix-only-mask-stitch',
    description: 'A prefix-only bureau mask must align from the left before stitching a longer middle-masked number.',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-prefix-only',
        creditorName: 'Discover Bank',
        accountNumber: '601145****',
        balance: 780,
        creditBureau: ['Equifax'],
        dateOpened: '2020-02-10',
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'tu-middle-mask',
        creditorName: 'DFS',
        accountNumber: '601145****7788',
        balance: 790,
        creditBureau: ['TransUnion'],
        dateOpened: '2020-02-14',
        accountType: 'Credit Card',
      }),
    ],
    expectedDecision: 'AUTO_MERGE',
    expectStitchedContains: ['601145', '7788'],
  },
  {
    id: 'false-prefix-match-suffix-conflict',
    description: 'A shared visible prefix cannot override conflicting visible last-four digits.',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-prefix-suffix-a',
        creditorName: 'Discover Bank',
        accountNumber: '601145****7788',
        balance: 780,
        creditBureau: ['Equifax'],
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'tu-prefix-suffix-b',
        creditorName: 'DFS',
        accountNumber: '601145****9910',
        balance: 780,
        creditBureau: ['TransUnion'],
        accountType: 'Credit Card',
      }),
    ],
    expectedDecision: 'HARD_REFUSE',
    forbidAutoMerge: true,
  },
  {
    id: 'true-balance-alias-no-exact-date',
    description: 'Balance + alias without exact date (dates 90d apart) → AUTO_MERGE via 2-of-N',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-pra',
        creditorName: 'Portfolio Recovery Associates',
        accountNumber: '****2200',
        balance: 975,
        creditBureau: ['Equifax'],
        dateOpened: '2021-01-10',
        typeOfNegative: 'Collection',
        status: 'Collection',
        accountType: 'Collection',
      }),
      baseItem({
        id: 'ex-pra',
        creditorName: 'PRA',
        accountNumber: 'XXXX2200',
        balance: 990,
        creditBureau: ['Experian'],
        dateOpened: '2021-04-05',
        typeOfNegative: 'Collection',
        status: 'Collection',
        accountType: 'Collection',
      }),
    ],
    expectedDecision: 'AUTO_MERGE',
  },
  {
    id: 'true-name-balance-date-no-digits',
    description: 'Strong alias + balance + date with fully masked accounts → AUTO_MERGE (2+ corroborators)',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-sync-corroborated',
        creditorName: 'SYNCHRONY BANK',
        accountNumber: '****',
        balance: 450,
        creditBureau: ['Equifax'],
        dateOpened: '2020-06-01',
        accountType: 'Credit Card',
        typeOfNegative: 'Charge-Off',
        status: 'Charge-off',
      }),
      baseItem({
        id: 'ex-sync-corroborated',
        creditorName: 'SYNCB / PAYPAL',
        accountNumber: 'XXXX',
        balance: 455,
        creditBureau: ['Experian'],
        dateOpened: '2020-06-05',
        accountType: 'Credit Card',
        typeOfNegative: 'Charge-Off',
        status: 'Charged Off',
      }),
    ],
    expectedDecision: 'AUTO_MERGE',
  },
  {
    id: 'link-oc-ca-original-creditor',
    description: 'OC charge-off + CA with originalCreditor field → LINK_ONLY (not collapse)',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-oc-chase',
        creditorName: 'CHASE BANK',
        accountNumber: '****1111',
        balance: 3200,
        creditBureau: ['Equifax'],
        typeOfNegative: 'Charge-Off',
        status: 'Charge-off',
        dateOfFirstDelinquency: '2020-03-01',
      }),
      baseItem({
        id: 'tu-ca-lvnv',
        creditorName: 'LVNV FUNDING LLC',
        accountNumber: '****9999',
        balance: 3350,
        creditBureau: ['TransUnion'],
        typeOfNegative: 'Collection',
        status: 'Collection',
        originalCreditor: 'JPMorgan Chase',
        dateOpened: '2021-06-01',
      }),
    ],
    expectedDecision: 'LINK_ONLY',
    forbidAutoMerge: true,
  },
  {
    id: 'false-cap-one-vs-cap-one-auto',
    description: 'Cap One vs Cap One Auto with different last-4 → HARD_REFUSE',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-capone-cc',
        creditorName: 'CAPITAL ONE',
        accountNumber: '****5678',
        balance: 3200,
        creditBureau: ['Equifax'],
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'ex-capone-auto',
        creditorName: 'CAP ONE AUTO',
        accountNumber: '****9012',
        balance: 3205,
        creditBureau: ['Experian'],
        accountType: 'Auto Loan',
      }),
    ],
    expectedDecision: 'HARD_REFUSE',
    forbidAutoMerge: true,
  },
  {
    id: 'false-american-express-vs-honda',
    description: 'AMERICAN EXPRESS vs AMERICAN HONDA shared root → HARD_REFUSE or NO_MERGE',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-amex',
        creditorName: 'AMERICAN EXPRESS',
        accountNumber: '****4422',
        balance: 890,
        creditBureau: ['Equifax'],
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'tu-honda',
        creditorName: 'AMERICAN HONDA FINANCE',
        accountNumber: '****7788',
        balance: 895,
        creditBureau: ['TransUnion'],
        accountType: 'Auto Loan',
      }),
    ],
    expectedDecision: ['HARD_REFUSE', 'NO_MERGE'],
    forbidAutoMerge: true,
  },
  {
    id: 'borderline-name-balance-only',
    description: 'Strong name + balance only (no digits, no dates) → MANUAL_REVIEW, never AUTO',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-sync-no-digits',
        creditorName: 'SYNCHRONY BANK',
        accountNumber: '****',
        balance: 450,
        creditBureau: ['Equifax'],
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'ex-sync-no-digits',
        creditorName: 'SYNCB / PAYPAL',
        accountNumber: 'XXXX',
        balance: 455,
        creditBureau: ['Experian'],
        accountType: 'Credit Card',
      }),
    ],
    expectedDecision: ['MANUAL_REVIEW', 'SUGGEST', 'LINK_ONLY'],
    forbidAutoMerge: true,
  },
  {
    id: 'same-bureau-duplicates',
    description: 'Same bureau duplicate rows → HARD_REFUSE or NO_MERGE, never AUTO',
    pairIndex: [0, 1],
    items: [
      baseItem({
        id: 'eq-dup-a',
        creditorName: 'DISCOVER BANK',
        accountNumber: '****3344',
        balance: 1200,
        creditBureau: ['Equifax'],
        accountType: 'Credit Card',
      }),
      baseItem({
        id: 'eq-dup-b',
        creditorName: 'DISCOVER',
        accountNumber: '****3344',
        balance: 1200,
        creditBureau: ['Equifax'],
        accountType: 'Credit Card',
      }),
    ],
    expectedDecision: ['HARD_REFUSE', 'NO_MERGE'],
    forbidAutoMerge: true,
  },
];
