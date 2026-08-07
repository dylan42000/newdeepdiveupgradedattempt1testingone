export type BureauResponseOutcome = 'Verified' | 'Deleted' | 'Updated' | 'Frivolous';

export interface ParsedBureauResponse {
  outcome: BureauResponseOutcome;
  confidence: number;
  matchedPhrases: string[];
}

const patterns: Record<BureauResponseOutcome, string[]> = {
  Deleted: ['deleted', 'removed', 'no longer appears', 'has been deleted', 'will be deleted'],
  Updated: ['updated', 'corrected', 'modified', 'changed', 'adjusted'],
  Verified: ['verified', 'remains', 'has been verified', 'information is accurate', 'confirmed as accurate'],
  Frivolous: ['frivolous', 'irrelevant', 'insufficient information', 'previously investigated', 'unable to process'],
};

function normalize(value: string): string { return value.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

function similarity(a: string, b: string): number {
  const left = normalize(a), right = normalize(b);
  if (!left || !right) return 0;
  if (left.includes(right) || right.includes(left)) return 1;
  const aWords = new Set(left.split(' ')), bWords = new Set(right.split(' '));
  const overlap = [...aWords].filter(word => bWords.has(word)).length;
  return overlap / Math.max(aWords.size, bWords.size);
}

/** Local-only, explainable fuzzy categorizer for pasted response text. */
export function parseBureauResponse(text: string): ParsedBureauResponse {
  const normalized = normalize(text);
  const scores = (Object.keys(patterns) as BureauResponseOutcome[]).map(outcome => {
    const phraseScores = patterns[outcome].map(phrase => ({ phrase, score: similarity(normalized, phrase) }));
    const matchedPhrases = phraseScores.filter(({ phrase, score }) => normalized.includes(normalize(phrase)) || score >= .8).map(({ phrase }) => phrase);
    const score = Math.max(...phraseScores.map(({ score }) => score), 0) + matchedPhrases.length * .35;
    return { outcome, score, matchedPhrases };
  }).sort((a, b) => b.score - a.score);
  const best = scores[0];
  // A deletion takes precedence over a generic "updated" notice when both appear.
  const deleted = scores.find(score => score.outcome === 'Deleted');
  const chosen = deleted && deleted.matchedPhrases.length ? deleted : best;
  return { outcome: chosen.outcome, confidence: Math.min(1, chosen.score), matchedPhrases: chosen.matchedPhrases };
}
