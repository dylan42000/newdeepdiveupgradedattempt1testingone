/**
 * UPL phrase blocklist — blocks attorney/paralegal impersonation language.
 */

export const UPL_PHRASE_BLOCKLIST: RegExp[] = [
  /\bas\s+(an?\s+)?attorney\b/i,
  /\bas\s+your\s+attorney\b/i,
  /\bas\s+(an?\s+)?lawyer\b/i,
  /\bas\s+(an?\s+)?counsel\b/i,
  /\bon\s+behalf\s+of\s+(my\s+)?client\b/i,
  /\bthis\s+law\s+firm\b/i,
  /\blegal\s+counsel\s+for\b/i,
  /\bwe\s+represent\s+the\s+consumer\b/i,
  /\bunder\s+penalty\s+of\s+perjury\s+as\s+counsel\b/i,
  /\besquire\b/i,
  /\bbar\s+number\b/i,
  /\battorney[\s-]?at[\s-]?law\b/i,
  /\bretainer\b/i,
  /\blegal\s+services\s+provider\b/i,
];

export interface UPLHit {
  phrase: string;
  index: number;
}

export function findUplRiskPhrases(text: string): UPLHit[] {
  const hits: UPLHit[] = [];
  for (const re of UPL_PHRASE_BLOCKLIST) {
    const m = re.exec(text);
    if (m) hits.push({ phrase: m[0], index: m.index });
  }
  return hits;
}

export function assertNoUplRisk(text: string): { ok: true } | { ok: false; hits: UPLHit[] } {
  const hits = findUplRiskPhrases(text);
  if (hits.length === 0) return { ok: true };
  return { ok: false, hits };
}
