import stringSimilarity from 'string-similarity';
import type { LetterFactBlock } from './letterFactInjector';

// ─── BANNED PHRASE REGISTRY (World-Class Calibration §3.1) ────────────────────
// ONLY true third-party law-firm / credit-repair-organization template markers
// belong here. Standard FTC/CFPB-recommended ordinary consumer phrasing
// ("I am writing to dispute", "please investigate", "I believe this information
// is inaccurate", "I am disputing", "please look into this", "thank you for
// your time", etc.) was REMOVED — flagging ordinary English created fatal
// false-positive kill-switches on valid consumer letters.
export const BANNED_BOILERPLATE: string[] = [
  "to whom it may concern",
  "pursuant to my rights under section 609 of the fair credit reporting act i demand",
  "this letter serves as formal notice of intent to file suit under fcra",
  "as a credit repair organization representing",
  "counsel for the above named consumer",
  "cease and desist all collection activities immediately pursuant to 15 usc 1692",
  "dear sir or madam credit bureau",
];

// ─── SEMANTIC EQUIVALENCE CLUSTERS (World-Class Calibration §3.1) ─────────────
// Clusters now track ONLY the retained law-firm / CRO template markers. The
// former consumer-phrase clusters ("please look into this", "i believe this is
// inaccurate", …) semantic-matched ordinary English and were removed.
const SEMANTIC_CLUSTERS: string[][] = [
  [
    "to whom it may concern",
    "to the relevant department",
    "to the appropriate party",
    "to the concerned team",
    "to whom this applies",
  ],
  [
    "this letter serves as formal notice of intent to file suit under fcra",
    "this letter serves as formal notice of intent to file suit",
    "this correspondence constitutes formal notice of impending litigation",
    "this letter serves as formal notice of intent to take legal action",
  ],
  [
    "as a credit repair organization representing",
    "as a credit services organization representing",
    "as a law firm representing the consumer",
    "on behalf of the credit repair company representing",
  ],
  [
    "counsel for the above named consumer",
    "attorney for the above named consumer",
    "legal representative for the above named consumer",
  ],
  [
    "cease and desist all collection activities",
    "you are hereby ordered to cease and desist",
    "immediately cease and desist all contact",
  ],
];

// ─── CALIBRATED SIMILARITY THRESHOLDS (§3.1) ──────────────────────────────────
// Raised from 0.82 / 0.78: near-duplicate phrasing of a genuine law-firm template
// is still caught, while ordinary consumer English no longer trips the gates.
export const FUZZY_THRESHOLD = 0.88;
export const SEMANTIC_THRESHOLD = 0.85;

// ─── NORMALIZATION ENGINE ──────────────────────────────────────────────────────
function normalizeForDetection(text: string): string {
  return text
    // Remove zero-width and invisible Unicode characters
    .replace(/[\u200B\u200C\u200D\u200E\u200F\uFEFF\u00AD]/g, '')
    // Normalize all whitespace variants
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    // Collapse soft line breaks and carriage returns
    .replace(/\r\n|\r|\n/g, ' ')
    // Strip out punctuation marks completely to prevent formatting evasion
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "")
    // Collapse multiple consecutive spaces into one
    .replace(/\s{2,}/g, ' ')
    // Lowercase for uniform matching
    .toLowerCase()
    .trim();
}

function extractWindows(text: string, windowSize: number): string[] {
  const words = text.split(' ');
  const windows: string[] = [];
  for (let i = 0; i <= words.length - windowSize; i++) {
    windows.push(words.slice(i, i + windowSize).join(' '));
  }
  return windows;
}

// ─── BOILERPLATE EXCEPTION ────────────────────────────────────────────────────
export class BoilerplateDetectedException extends Error {
  constructor(
    public readonly phrase: string,
    public readonly detectionMethod: 'exact' | 'fuzzy' | 'semantic',
    public readonly similarity: number,
  ) {
    super(
      `[BoilerplateDetected:${detectionMethod}] "${phrase}" (similarity: ${(similarity * 100).toFixed(1)}%)`,
    );
    this.name = 'BoilerplateDetectedException';

    // Crucial for custom errors extending built-ins in TypeScript/ES5 targets
    Object.setPrototypeOf(this, BoilerplateDetectedException.prototype);
  }
}

// ─── NON-TERMINAL POLICY CHECK (§3.1) ─────────────────────────────────────────
// World-Class change: boilerplate detection is no longer a fatal throw gate.
// checkBoilerplatePolicy returns a structured finding that the
// LetterGenerationOrchestrator converts into a repairable diagnostic
// (Stage 5 → Stage 6 targeted repair) instead of a promise rejection.
export interface BoilerplatePolicyResult {
  ok: boolean;
  finding?: string;
  phrase?: string;
  detectionMethod?: 'exact' | 'fuzzy' | 'semantic';
  score: number;
}

export function checkBoilerplatePolicy(rawText: string): BoilerplatePolicyResult {
  const normalized = normalizeForDetection(rawText);

  // ── LAYER 1: Exact Match ──────────────────────────────
  for (const phrase of BANNED_BOILERPLATE) {
    const normalizedPhrase = normalizeForDetection(phrase);
    const escapedPhrase = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPhrase, 'i');
    if (regex.test(normalized)) {
      return {
        ok: false,
        finding: `Exact law-firm/CRO template phrase detected: "${phrase}". Rewrite without third-party representative wording.`,
        phrase,
        detectionMethod: 'exact',
        score: 1.0,
      };
    }
  }

  // ── LAYER 2: Fuzzy Match (calibrated threshold 0.88) ──
  let bestFuzzy: { phrase: string; score: number } | null = null;
  for (const phrase of BANNED_BOILERPLATE) {
    const normalizedPhrase = normalizeForDetection(phrase);
    const wordCount = normalizedPhrase.split(' ').length;
    for (const windowSize of [wordCount - 1, wordCount, wordCount + 1]) {
      if (windowSize < 2) continue;
      const windows = extractWindows(normalized, windowSize);
      for (const window of windows) {
        const score = stringSimilarity.compareTwoStrings(window, normalizedPhrase);
        if (score >= FUZZY_THRESHOLD && (!bestFuzzy || score > bestFuzzy.score)) {
          bestFuzzy = { phrase, score };
        }
      }
    }
  }
  if (bestFuzzy) {
    return {
      ok: false,
      finding: `Near-duplicate of banned template phrase: "${bestFuzzy.phrase}" (${(bestFuzzy.score * 100).toFixed(1)}% similar). Rephrase in original consumer wording.`,
      phrase: bestFuzzy.phrase,
      detectionMethod: 'fuzzy',
      score: bestFuzzy.score,
    };
  }

  // ── LAYER 3: Semantic Cluster Match (calibrated threshold 0.85) ───────────
  let bestSemantic: { phrase: string; score: number } | null = null;
  for (const cluster of SEMANTIC_CLUSTERS) {
    for (const clusterPhrase of cluster) {
      const normalizedClusterPhrase = normalizeForDetection(clusterPhrase);
      const wordCount = normalizedClusterPhrase.split(' ').length;
      for (const windowSize of [wordCount - 1, wordCount, wordCount + 1, wordCount + 2]) {
        if (windowSize < 2) continue;
        const windows = extractWindows(normalized, windowSize);
        for (const window of windows) {
          const score = stringSimilarity.compareTwoStrings(window, normalizedClusterPhrase);
          if (score >= SEMANTIC_THRESHOLD && (!bestSemantic || score > bestSemantic.score)) {
            bestSemantic = { phrase: clusterPhrase, score };
          }
        }
      }
    }
  }
  if (bestSemantic) {
    return {
      ok: false,
      finding: `Semantically equivalent to banned representative-template phrase: "${bestSemantic.phrase}" (${(bestSemantic.score * 100).toFixed(1)}% similar). Rephrase as the consumer in first person.`,
      phrase: bestSemantic.phrase,
      detectionMethod: 'semantic',
      score: bestSemantic.score,
    };
  }

  return { ok: true, score: 0 };
}

// ─── LEGACY THROWING ASSERTION (backward-compatible wrapper) ─────────────────
// Retained for existing sweep validators (e.g. AutoPilot Rule-1 letter sweep).
// Delegates to the calibrated non-terminal policy check.
export function assertNoBoilerplate(rawText: string): void {
  const result = checkBoilerplatePolicy(rawText);
  if (!result.ok) {
    throw new BoilerplateDetectedException(
      result.phrase ?? result.finding ?? 'unknown phrase',
      result.detectionMethod ?? 'exact',
      result.score,
    );
  }
}

// ─── SMART FACTUAL ANCHOR VALIDATION (§3.2) ───────────────────────────────────
// Mask- and acronym-tolerant anchor verification. Credit reports display
// truncated account numbers (****1234, XXXX1234, 1234) and abbreviated creditor
// names (MIDLAND CREDIT MGMT vs Midland Funding LLC, CBNA, SYF/WALMART), so a
// naive substring check produces fatal false positives. Returns a structured
// result — anchor misses are repairable, never fatal.
export interface AnchorCheckResult {
  ok: boolean;
  missingAnchors: string[];
}

const CREDITOR_STOP_WORDS = new Set([
  'bank', 'llc', 'inc', 'corp', 'company', 'co', 'na', 'svcs', 'mgmt',
  'credit', 'financial', 'serv', 'services', 'usa', 'the', 'of', 'and',
]);

export function assertFactualAnchorsPresent(
  content: string,
  facts: LetterFactBlock,
  pass = 1,
): AnchorCheckResult {
  const lower = content.toLowerCase();
  const missingAnchors: string[] = [];

  // 1. Account Suffix Verification — tolerates prefixes and masking
  //    (****1234, XXXX1234, "ending in 1234", "account ... 1234", bare digits).
  if (facts.accountSuffix && facts.accountSuffix.replace(/\D/g, '').length >= 4) {
    const cleanSuffix = facts.accountSuffix.replace(/\D/g, '').slice(-4);
    const suffixRegex = new RegExp(
      `(?:ending in|account number|account|acct|num|no\\.?|#|x|\\*)\\s*[:#\\-]?\\s*(?:[x*0-9\\s]{0,12})?${cleanSuffix}\\b`,
      'i',
    );
    const directDigits = new RegExp(`\\b\\d{0,12}${cleanSuffix}\\b`);

    if (!suffixRegex.test(content) && !directDigits.test(content)) {
      missingAnchors.push(`Account Suffix (${cleanSuffix})`);
    }
  }

  // 2. Creditor Name Verification — acronym and principal-word matching.
  const creditorTokens = facts.creditorName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !CREDITOR_STOP_WORDS.has(t));

  const hasCreditorToken = creditorTokens.some((token) => lower.includes(token));
  const hasFullName = lower.includes(facts.creditorName.toLowerCase());

  // Generate acronym (e.g. "Bank of America" → "boa")
  const acronym = facts.creditorName
    .split(/\s+/)
    .map((w) => (w[0] ?? '').toLowerCase())
    .join('');
  const hasAcronym = acronym.length >= 3 && new RegExp(`\\b${acronym}\\b`, 'i').test(lower);

  if (creditorTokens.length > 0 && !hasCreditorToken && !hasFullName && !hasAcronym) {
    missingAnchors.push(`Creditor Name (${facts.creditorName})`);
  }

  // 3. Statutory Citation Check (Pass 3+ only; allow statutory cite OR regulatory term)
  if (pass >= 3) {
    const statutoryRegex =
      /(?:15\s+u\.?s\.?c\.?|§|fair credit reporting act|fcra|1681|12\s+c\.?f\.?r\.?|metro\s*2|reinvestigat)/i;
    if (!statutoryRegex.test(content)) {
      missingAnchors.push('Statutory Citation (FCRA / 15 U.S.C. / Metro 2)');
    }
  }

  return { ok: missingAnchors.length === 0, missingAnchors };
}
