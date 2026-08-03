import stringSimilarity from 'string-similarity';
import type { LetterFactBlock } from './letterFactInjector';

// ─── BANNED PHRASE REGISTRY ───────────────────────────────────────────────────
export const BANNED_BOILERPLATE: string[] = [
  "to whom it may concern",
  "i am writing to formally dispute",
  "i am writing to dispute",
  "please investigate",
  "i respectfully request",
  "i hope this letter finds you well",
  "this letter is to inform you",
  "i am reaching out",
  "please be advised",
  "pursuant to my rights",
  "i am a consumer",
  "i believe this information is inaccurate",
  "kindly remove",
  "thank you for your time",
  "i look forward to your response",
  "this is not my account",
  "to the concerned department",
  "to the appropriate department",
  "i am disputing",
  "dear sir or madam",
];

// ─── SEMANTIC EQUIVALENCE CLUSTERS ────────────────────────────────────────────
const SEMANTIC_CLUSTERS: string[][] = [
  [
    "to whom it may concern",
    "to the relevant department",
    "to the appropriate party",
    "to the concerned team",
    "to whom this applies",
  ],
  [
    "i am writing to formally dispute",
    "i am writing regarding a dispute",
    "i am submitting this dispute",
    "i am formally disputing",
    "this letter serves as a formal dispute",
    "this is a formal dispute notice",
  ],
  [
    "please investigate this matter",
    "please look into this",
    "kindly investigate",
    "i request your investigation",
    "please review this item",
  ],
  [
    "i believe this is inaccurate",
    "this information appears to be incorrect",
    "i believe this account is incorrect",
    "this entry seems inaccurate",
    "this may be an error",
  ],
];

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

// ─── CORE VALIDATION FUNCTION ─────────────────────────────────────────────────
export function assertNoBoilerplate(rawText: string): void {
  const normalized = normalizeForDetection(rawText);

  // ── LAYER 1: Exact Match ──────────────────────────────
  for (const phrase of BANNED_BOILERPLATE) {
    const normalizedPhrase = normalizeForDetection(phrase);
    const escapedPhrase = normalizedPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPhrase, 'i');
    if (regex.test(normalized)) {
      throw new BoilerplateDetectedException(phrase, 'exact', 1.0);
    }
  }

  // ── LAYER 2: Fuzzy Match ──────────────
  const FUZZY_THRESHOLD = 0.82;
  for (const phrase of BANNED_BOILERPLATE) {
    const normalizedPhrase = normalizeForDetection(phrase);
    const wordCount = normalizedPhrase.split(' ').length;
    for (const windowSize of [wordCount - 1, wordCount, wordCount + 1]) {
      if (windowSize < 2) continue;
      const windows = extractWindows(normalized, windowSize);
      for (const window of windows) {
        const score = stringSimilarity.compareTwoStrings(window, normalizedPhrase);
        if (score >= FUZZY_THRESHOLD) {
          throw new BoilerplateDetectedException(phrase, 'fuzzy', score);
        }
      }
    }
  }

  // ── LAYER 3: Semantic Cluster Match ───────────────────────────────────────
  const SEMANTIC_THRESHOLD = 0.78;
  for (const cluster of SEMANTIC_CLUSTERS) {
    for (const clusterPhrase of cluster) {
      const normalizedClusterPhrase = normalizeForDetection(clusterPhrase);
      const wordCount = normalizedClusterPhrase.split(' ').length;
      for (const windowSize of [wordCount - 1, wordCount, wordCount + 1, wordCount + 2]) {
        if (windowSize < 2) continue;
        const windows = extractWindows(normalized, windowSize);
        for (const window of windows) {
          const score = stringSimilarity.compareTwoStrings(window, normalizedClusterPhrase);
          if (score >= SEMANTIC_THRESHOLD) {
            throw new BoilerplateDetectedException(clusterPhrase, 'semantic', score);
          }
        }
      }
    }
  }
}

export function assertFactualAnchorsPresent(content: string, facts: LetterFactBlock, pass = 1): void {
  const lower=content.toLowerCase();
  if(facts.accountSuffix && !lower.includes(facts.accountSuffix.toLowerCase())) throw new Error(`ANCHOR_MISSING: account suffix ${facts.accountSuffix}`);
  const tokens=facts.creditorName.toLowerCase().split(/\W+/).filter(t=>t.length>3);
  if(tokens.length && !tokens.some(t=>lower.includes(t))) throw new Error(`ANCHOR_MISSING: creditor ${facts.creditorName}`);
  if(pass>=3 && !/(?:15\s+u\.?s\.?c\.?|§|fair credit reporting act|12\s+c\.?f\.?r\.?)/i.test(content)) throw new Error('ANCHOR_MISSING: statutory citation');
}
