export const LEGAL_TRANSITION_PHRASES = [
  "Furthermore,",
  "Pursuant to the aforementioned facts,",
  "Additionally,",
  "In accordance with federal regulations,",
  "Moreover,",
  "As established by the statutory provisions cited,",
  "Subsequent to this,",
  "By operation of law,"
];

export const AntiSpamDisputeEngine = {
  /**
   * Deterministically selects and swaps transition phrases based on letterId
   * to ensure syntactic uniqueness across letters.
   */
  generateUniqueSyntacticStructure(baseBodyText: string, letterId: string): string {
    if (!baseBodyText) return baseBodyText;

    // A simple deterministic hash of the letterId
    let hash = 0;
    for (let i = 0; i < letterId.length; i++) {
      hash = (hash << 5) - hash + letterId.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    hash = Math.abs(hash);

    // Select a phrase based on the hash
    const phraseIndex = hash % LEGAL_TRANSITION_PHRASES.length;
    const selectedPhrase = LEGAL_TRANSITION_PHRASES[phraseIndex];

    // Simple replacement strategy: find paragraphs and insert the transition phrase
    // at the beginning of the second paragraph if possible, or another suitable location.
    // For a robust implementation, we might replace generic transitions with our dictionary.

    // Replace common generic transitions if they exist
    const genericTransitions = [/Additionally,/gi, /Furthermore,/gi, /Moreover,/gi];
    let modifiedText = baseBodyText;
    let replaced = false;

    for (const generic of genericTransitions) {
      if (generic.test(modifiedText)) {
        modifiedText = modifiedText.replace(generic, selectedPhrase);
        replaced = true;
        break;
      }
    }

    // If no generic transition was found to replace, inject one at the start of the second sentence or paragraph.
    if (!replaced) {
      const parts = modifiedText.split('\n\n');
      if (parts.length > 1 && !parts[1].startsWith('<')) {
        parts[1] = `${selectedPhrase} ${parts[1].charAt(0).toLowerCase()}${parts[1].slice(1)}`;
        modifiedText = parts.join('\n\n');
      } else {
        // Fallback: prepend to the text if it's just one block, though usually not ideal.
        // Let's just return the original if we can't safely inject.
      }
    }

    return modifiedText;
  }
};

// ─── FULL PRODUCTION UNIQUENESS ENGINE (v5.1.0) ──────────────────────────────

export interface DisputeUniquenessScore {
  score: number;             // 0-100 — higher = more unique vs. prior disputes
  isUnique: boolean;         // true if score >= 60
  riskLevel: 'SAFE' | 'CAUTION' | 'HIGH_RISK_FRIVOLOUS';
  newElementsAdded: string[];
  sharedElementsWithPrior: string[];
  recommendation: string;
}

/**
 * Evaluate how unique a new letter is vs. prior dispute letters for the same item.
 * Prevents frivolous classification by bureaus/furnishers.
 */
export function evaluateDisputeUniqueness(
  newLetterContent: string,
  priorLetterContents: string[],
  passNumber: number
): DisputeUniquenessScore {
  if (priorLetterContents.length === 0 || !newLetterContent) {
    return {
      score: 100,
      isUnique: true,
      riskLevel: 'SAFE',
      newElementsAdded: ['First dispute — no prior comparison'],
      sharedElementsWithPrior: [],
      recommendation: 'First dispute — proceed normally',
    };
  }

  const newFp = _extractLetterFingerprint(newLetterContent);
  const priorFps = priorLetterContents.map(_extractLetterFingerprint);

  let maxSimilarity = 0;
  let mostSimilarFp = priorFps[0];
  for (const fp of priorFps) {
    const sim = _calculateFingerprintSimilarity(newFp, fp);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      mostSimilarFp = fp;
    }
  }

  const sharedElements: string[] = [];
  const newElements: string[] = [];

  for (const arg of newFp.keyArguments) {
    const foundInPrior = mostSimilarFp.keyArguments.some(
      pe => _stringSimilarity(arg, pe) > 0.7
    );
    if (foundInPrior) sharedElements.push(arg.slice(0, 80));
    else newElements.push(arg.slice(0, 80));
  }

  const uniquenessScore = Math.round((1 - maxSimilarity) * 100);
  const riskLevel: DisputeUniquenessScore['riskLevel'] =
    uniquenessScore >= 60 ? 'SAFE' :
    uniquenessScore >= 40 ? 'CAUTION' :
    'HIGH_RISK_FRIVOLOUS';

  return {
    score: uniquenessScore,
    isUnique: uniquenessScore >= 60,
    riskLevel,
    newElementsAdded: newElements.slice(0, 5),
    sharedElementsWithPrior: sharedElements.slice(0, 5),
    recommendation:
      riskLevel === 'HIGH_RISK_FRIVOLOUS'
        ? `⚠️ HIGH FRIVOLOUS RISK: Letter is ${100 - uniquenessScore}% similar to Pass ${passNumber - 1}. Must introduce new legal theory (Metro 2 violation, §623 direct dispute, or cross-bureau discrepancy) before sending.`
        : riskLevel === 'CAUTION'
        ? `⚠️ CAUTION: Letter shares elements with prior. Consider adding Metro 2 field violation or new evidence reference.`
        : `✅ SAFE: Letter introduces sufficient new legal arguments vs. prior disputes.`,
  };
}

// ─── Private fingerprint helpers ────────────────────────────────────────────

interface LetterFingerprint {
  keyArguments: string[];
  citations: Set<string>;
  requestType: string;
}

function _extractLetterFingerprint(content: string): LetterFingerprint {
  return {
    keyArguments: _extractKeyArguments(content),
    citations: _extractCitations(content),
    requestType: _extractRequestType(content.toLowerCase()),
  };
}

function _extractKeyArguments(content: string): string[] {
  const sentences = content.match(/[^.!?]+[.!?]+/g) ?? [];
  return sentences
    .filter(s => s.length > 30 && s.length < 250)
    .filter(s =>
      s.includes('§') || s.includes('FCRA') || s.includes('dispute') ||
      s.includes('inaccurate') || s.includes('verify') ||
      s.includes('investigation') || s.includes('violation') ||
      s.includes('Metro 2') || s.includes('furnisher')
    )
    .map(s => s.trim().toLowerCase())
    .slice(0, 8);
}

function _extractCitations(content: string): Set<string> {
  const matches = content.match(/§\s*\d+[a-z]*/gi) ?? [];
  return new Set(matches.map(m => m.replace(/\s/g, '').toLowerCase()));
}

function _extractRequestType(lower: string): string {
  if (lower.includes('delete') || lower.includes('remove')) return 'deletion';
  if (lower.includes('correct') || lower.includes('update')) return 'correction';
  if (lower.includes('investigate') || lower.includes('reinvestig')) return 'investigation';
  return 'general';
}

function _calculateFingerprintSimilarity(a: LetterFingerprint, b: LetterFingerprint): number {
  const argSim = _setJaccardSimilarity(new Set(a.keyArguments), new Set(b.keyArguments));
  const citSim = _setJaccardSimilarity(a.citations, b.citations);
  const reqSim = a.requestType === b.requestType ? 1 : 0;
  return argSim * 0.6 + citSim * 0.3 + reqSim * 0.1;
}

function _setJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  const aArr = [...setA];
  const bArr = [...setB];
  let intersect = 0;
  for (const a of aArr) {
    if (bArr.some(b => _stringSimilarity(a, b) > 0.7)) intersect++;
  }
  const union = setA.size + setB.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function _stringSimilarity(a: string, b: string): number {
  const shorter = a.length < b.length ? a : b;
  const longer = a.length < b.length ? b : a;
  if (longer.length === 0) return 1;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return matches / longer.length;
}
