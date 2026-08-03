import type { DisputeLetter, NegativeItem } from "../types";

export interface UniquenessReport {
  isUnique: boolean;
  similarityScore: number;
  closestMatchId: string | null;
  closestMatchScore: number;
  rewriteRequired: boolean;
  uniquenessHash: string;
  ngramFingerprint: string[];
}

export interface UniquenessSeed {
  tone: "assertive" | "formal" | "methodical" | "urgent" | "matter-of-fact";
  openingAngle: "chronological" | "legal-first" | "consumer-rights-first" | "financial-impact-first";
  argumentOrder: Array<"verification-demand" | "legal-citation" | "deadline-notice" | "remedy-requested">;
  closingStyle: "demand" | "deadline" | "regulatory-warning" | "documentation-request";
}

const SIMILARITY_THRESHOLD = 0.65;
const STOP_WORDS = new Set([
  "the", "and", "for", "that", "with", "this", "from", "have", "your", "you", "will", "within",
  "their", "they", "them", "into", "under", "hereby", "shall", "must", "been", "were", "which",
  "what", "when", "where", "there", "would", "could", "should", "about", "please", "account",
]);

function normalizeForSimilarity(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, " <date> ")
    .replace(/\b\d{4}[\-\/]\d{2}[\-\/]\d{2}\b/g, " <date> ")
    .replace(/\b\$\s?\d[\d,.]*\b/g, " <amount> ")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, " <ssn> ")
    .replace(/\b(?:x|\*){2,}[0-9]{2,}\b/gi, " <acct> ")
    .replace(/\b[0-9]{6,}\b/g, " <num> ")
    .replace(/[^a-z0-9<>\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(input: string): string[] {
  return normalizeForSimilarity(input)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function buildNgrams(tokens: string[], n: number): string[] {
  if (tokens.length < n) return [];
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i += 1) {
    grams.push(tokens.slice(i, i + n).join(" "));
  }
  return grams;
}

function fingerprintText(input: string): string[] {
  const tokens = tokenize(input);
  const grams3 = buildNgrams(tokens, 3);
  const grams5 = buildNgrams(tokens, 5);
  return Array.from(new Set([...grams3, ...grams5]));
}

function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 1;

  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) intersection += 1;
  }

  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function hashString(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return ((h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0"));
}

export function createUniquenessSeed(item: NegativeItem, priorCount = 0): UniquenessSeed {
  const seedText = `${item.id}|${item.creditorName}|${priorCount}`;
  const hash = parseInt(hashString(seedText).slice(0, 8), 16);

  const tones: UniquenessSeed["tone"][] = ["assertive", "formal", "methodical", "urgent", "matter-of-fact"];
  const openings: UniquenessSeed["openingAngle"][] = ["chronological", "legal-first", "consumer-rights-first", "financial-impact-first"];
  const closings: UniquenessSeed["closingStyle"][] = ["demand", "deadline", "regulatory-warning", "documentation-request"];

  const orderBase: UniquenessSeed["argumentOrder"] = [
    "verification-demand",
    "legal-citation",
    "deadline-notice",
    "remedy-requested",
  ];

  const rotatedOrder = [...orderBase];
  for (let i = 0; i < rotatedOrder.length; i += 1) {
    const swapIndex = (hash + i * 7) % rotatedOrder.length;
    [rotatedOrder[i], rotatedOrder[swapIndex]] = [rotatedOrder[swapIndex], rotatedOrder[i]];
  }

  return {
    tone: tones[hash % tones.length],
    openingAngle: openings[(hash >> 3) % openings.length],
    argumentOrder: rotatedOrder,
    closingStyle: closings[(hash >> 5) % closings.length],
  };
}

export function buildDiversificationDirective(seed: UniquenessSeed): string {
  return [
    "DIVERSIFICATION DIRECTIVE:",
    `Opening angle: ${seed.openingAngle}.`,
    `Argument order: ${seed.argumentOrder.join(" -> ")}.`,
    `Tone: ${seed.tone}.`,
    `Closing style: ${seed.closingStyle}.`,
    "Do not follow a standard template sequence.",
  ].join(" ");
}

export function enforceUniqueness(
  newLetter: string,
  priorLetters: DisputeLetter[],
  _itemContext: NegativeItem,
  threshold = SIMILARITY_THRESHOLD,
): UniquenessReport {
  const currentFingerprint = fingerprintText(newLetter);
  const currentHash = hashString(normalizeForSimilarity(newLetter));

  let closestMatchId: string | null = null;
  let closestMatchScore = 0;

  for (const prior of priorLetters) {
    const priorFingerprint = fingerprintText(prior.content || "");
    const similarity = jaccardSimilarity(currentFingerprint, priorFingerprint);
    if (similarity > closestMatchScore) {
      closestMatchScore = similarity;
      closestMatchId = prior.id;
    }
  }

  const uniquenessScore = Math.max(0, 1 - closestMatchScore);
  const rewriteRequired = closestMatchScore > threshold;

  return {
    isUnique: !rewriteRequired,
    similarityScore: uniquenessScore,
    closestMatchId,
    closestMatchScore,
    rewriteRequired,
    uniquenessHash: currentHash,
    ngramFingerprint: currentFingerprint,
  };
}

export function getUniquenessThreshold(): number {
  return SIMILARITY_THRESHOLD;
}
