/**
 * priorLetterReader.ts — Load real prior letter bodies for uniqueness checks
 */

import { getAllGeneratedLetters, idbGetAll, idbSet } from './indexedDB';
import type { GeneratedLetterV2 } from '../types/creditRepair';

export interface PriorLetterRef {
  itemId: string;
  content: string;
  bureau?: string;
  passNumber?: number;
}

/** Optional in-memory / AppContext letters passed into a cycle */
let sessionPriors: PriorLetterRef[] = [];

export function setSessionPriorLetters(letters: PriorLetterRef[]): void {
  sessionPriors = letters.filter((l) => Boolean(l.content?.trim()));
}

export function clearSessionPriorLetters(): void {
  sessionPriors = [];
}

/**
 * Collect prior letter bodies for an item (and optionally bureau).
 * Sources: session priors, GeneratedLetterV2 IDB store, legacy generatedLetters.
 */
export async function getPriorLetterContentsForItem(
  itemId: string,
  bureau?: string,
): Promise<string[]> {
  const bodies: string[] = [];

  for (const prior of sessionPriors) {
    if (prior.itemId !== itemId) continue;
    if (bureau && prior.bureau && prior.bureau !== bureau) continue;
    bodies.push(prior.content);
  }

  try {
    const v2 = await idbGetAll<GeneratedLetterV2>('disputeLettersV2');
    for (const letter of v2) {
      if (letter.itemId !== itemId) continue;
      if (bureau && letter.targetName && letter.targetName !== bureau) continue;
      const content = letter.letterContent || letter.htmlContent || '';
      if (content.trim()) bodies.push(content);
    }
  } catch {
    /* store may be empty / unavailable */
  }

  try {
    const legacy = await getAllGeneratedLetters();
    for (const letter of legacy) {
      if (letter.disputeItemId && letter.disputeItemId !== itemId) continue;
      const content = letter.content || '';
      if (content.trim()) bodies.push(content);
    }
  } catch {
    /* ignore */
  }

  return [...new Set(bodies)];
}

/** Persist a V2 letter into disputeLettersV2 for future uniqueness priors */
export async function persistLetterForUniqueness(letter: GeneratedLetterV2): Promise<void> {
  try {
    await idbSet('disputeLettersV2', letter);
  } catch (e) {
    console.warn('[PriorLetterReader] Failed to persist letter for uniqueness', e);
  }
}
