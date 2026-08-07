/**
 * responseIntakeService.ts — Response matching, granular outcomes, and replan hooks.
 */

import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem } from '../types';
import type { ResponseMatch, ResponseOutcomeGranular } from '../types/autopilotCase';
import { CaseRepository } from './caseRepository';
import { FactLedgerService } from './factLedgerService';
import { OutcomeLearningStore } from './outcomeLearningStore';
import { idbGetAll, idbSet } from './indexedDB';

const OUTCOME_PATTERNS: Array<{ outcome: ResponseOutcomeGranular; patterns: RegExp[] }> = [
  { outcome: 'deleted', patterns: [/\bdelete(?:d|ion)?\b/i, /\bremoved\b/i, /\bno longer appears\b/i] },
  { outcome: 'corrected', patterns: [/\bcorrect(?:ed|ion)?\b/i, /\bupdated\b/i, /\bmodified\b/i] },
  { outcome: 'partial_correction', patterns: [/\bpartial(?:ly)?\s+(?:updated|corrected)\b/i] },
  { outcome: 'frivolous', patterns: [/\bfrivolous\b/i, /\birrelevant\b/i] },
  { outcome: 'identity_evidence_requested', patterns: [/\bproof of identity\b/i, /\badditional information\b/i, /\bdocumentation\b/i] },
  { outcome: 'forwarded', patterns: [/\bforwarded\b/i, /\btransferred\b/i] },
  { outcome: 'reinserted', patterns: [/\bre-?insert(?:ed|ion)?\b/i] },
  { outcome: 'verified', patterns: [/\bverified\b/i, /\baccurate\b/i, /\bremains\b/i] },
  { outcome: 'no_response', patterns: [/\bno response\b/i, /\bdid not respond\b/i] },
];

function detectOutcome(text: string): { outcome: ResponseOutcomeGranular; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  for (const row of OUTCOME_PATTERNS) {
    for (const re of row.patterns) {
      if (re.test(text)) {
        reasonCodes.push(row.outcome);
        return { outcome: row.outcome, reasonCodes };
      }
    }
  }
  return { outcome: 'unclear', reasonCodes: ['unclear'] };
}

function detectSender(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('equifax')) return 'Equifax';
  if (lower.includes('experian')) return 'Experian';
  if (lower.includes('transunion') || lower.includes('trans union')) return 'TransUnion';
  if (/\bcollection\b|\bllc\b|\bnational credit\b/i.test(text)) return 'Furnisher/Collector';
  return 'Unknown';
}

function extractChangedFields(text: string): string[] {
  const fields: string[] = [];
  if (/balance/i.test(text)) fields.push('balance');
  if (/status|payment/i.test(text)) fields.push('status');
  if (/date|dofd|delinquen/i.test(text)) fields.push('dates');
  if (/account\s*number/i.test(text)) fields.push('accountNumber');
  return fields;
}

function scoreMatch(params: {
  sender: string;
  text: string;
  item: NegativeItem;
  caseBureau: string;
}): number {
  let score = 0.2;
  const bureau = params.caseBureau.toLowerCase();
  if (bureau && params.sender.toLowerCase().includes(bureau.split(' ')[0])) score += 0.35;
  const creditor = (params.item.creditorName || '').toLowerCase();
  if (creditor && params.text.toLowerCase().includes(creditor.slice(0, Math.min(12, creditor.length)))) {
    score += 0.25;
  }
  const digits = `${params.item.accountNumber || ''}`.replace(/\D/g, '').slice(-4);
  if (digits.length === 4 && params.text.includes(digits)) score += 0.25;
  return Math.min(1, score);
}

export const ResponseIntakeService = {
  async listMatches(profileId: string): Promise<ResponseMatch[]> {
    const all = await idbGetAll<ResponseMatch>('responseMatches');
    return all.filter((m) => m.profileId === profileId).sort((a, b) => b.matchedAt.localeCompare(a.matchedAt));
  },

  classifyText(rawText: string): {
    sender: string;
    outcome: ResponseOutcomeGranular;
    reasonCodes: string[];
    changedFields: string[];
  } {
    const { outcome, reasonCodes } = detectOutcome(rawText);
    return {
      sender: detectSender(rawText),
      outcome,
      reasonCodes,
      changedFields: extractChangedFields(rawText),
    };
  },

  async intake(params: {
    profileId: string;
    rawText: string;
    sourceFileName?: string;
    responseDate?: string;
    items: NegativeItem[];
  }): Promise<ResponseMatch> {
    const classified = this.classifyText(params.rawText);
    const cases = await CaseRepository.getCasesForProfile(params.profileId);
    let best:
      | {
          caseId: string;
          confidence: number;
          item: NegativeItem;
        }
      | undefined;

    for (const c of cases) {
      const item = params.items.find(
        (i) => i.id === c.negativeItemId || (c.linkedNegativeItemIds ?? []).includes(i.id),
      );
      if (!item) continue;
      const confidence = scoreMatch({
        sender: classified.sender,
        text: params.rawText,
        item,
        caseBureau: c.bureau,
      });
      if (!best || confidence > best.confidence) {
        best = { caseId: c.id, confidence, item };
      }
    }

    const needsConfirmation = !best || best.confidence < 0.55 || classified.outcome === 'unclear';
    const match: ResponseMatch = {
      id: uuidv4(),
      profileId: params.profileId,
      caseId: best?.caseId,
      sourceFileName: params.sourceFileName,
      sender: classified.sender,
      responseDate: params.responseDate || new Date().toISOString().slice(0, 10),
      outcome: classified.outcome,
      reasonCodes: classified.reasonCodes,
      changedFields: classified.changedFields,
      confidence: best?.confidence ?? 0,
      needsConfirmation,
      rawExcerpt: params.rawText.slice(0, 500),
      matchedAt: new Date().toISOString(),
    };
    await idbSet('responseMatches', match);

    if (best && !needsConfirmation) {
      await this.applyMatch(match, best.item);
    } else {
      await CaseRepository.appendEvent({
        profileId: params.profileId,
        caseId: match.caseId,
        type: 'response.needs_confirmation',
        actor: 'autopilot',
        payload: { matchId: match.id, outcome: match.outcome, confidence: match.confidence },
      });
    }

    return match;
  },

  async confirmMatch(matchId: string, caseId: string, item: NegativeItem): Promise<ResponseMatch | undefined> {
    const all = await idbGetAll<ResponseMatch>('responseMatches');
    const existing = all.find((m) => m.id === matchId);
    if (!existing) return undefined;
    const confirmed: ResponseMatch = {
      ...existing,
      caseId,
      needsConfirmation: false,
      confirmedAt: new Date().toISOString(),
      confidence: Math.max(existing.confidence, 0.8),
    };
    await idbSet('responseMatches', confirmed);
    await this.applyMatch(confirmed, item);
    return confirmed;
  },

  async applyMatch(match: ResponseMatch, item: NegativeItem): Promise<void> {
    if (!match.caseId) return;
    const stateMap: Record<ResponseOutcomeGranular, Parameters<typeof CaseRepository.transition>[1]> = {
      deleted: 'DELETED',
      corrected: 'CORRECTED',
      verified: 'VERIFIED',
      partial_correction: 'CORRECTED',
      no_response: 'NO_RESPONSE',
      frivolous: 'REPLAN',
      identity_evidence_requested: 'EVIDENCE_NEEDED',
      forwarded: 'WAITING',
      reinserted: 'REINSERTED',
      unclear: 'MANUAL_REVIEW',
    };
    await CaseRepository.transition(match.caseId, stateMap[match.outcome], 'autopilot', {
      matchId: match.id,
      outcome: match.outcome,
    });
    if (match.outcome === 'verified' || match.outcome === 'frivolous' || match.outcome === 'no_response') {
      await CaseRepository.transition(match.caseId, 'REPLAN', 'autopilot', { after: match.outcome });
    }
    if (match.outcome === 'deleted' || match.outcome === 'corrected') {
      await CaseRepository.transition(match.caseId, 'RESOLVED', 'autopilot', { outcome: match.outcome });
    }

    await FactLedgerService.recordFact({
      profileId: match.profileId,
      caseId: match.caseId,
      field: 'lastResponseOutcome',
      value: match.outcome,
      sourceType: 'response',
      sourceId: match.id,
      confidence: match.needsConfirmation ? 'ambiguous' : 'high',
    });

    const learnedOutcome =
      match.outcome === 'deleted'
        ? 'deleted'
        : match.outcome === 'corrected' || match.outcome === 'partial_correction'
          ? 'updated'
          : match.outcome === 'frivolous'
            ? 'frivolous'
            : match.outcome === 'no_response'
              ? 'no_response'
              : 'verified';

    OutcomeLearningStore.record({
      profileId: match.profileId,
      itemId: item.id,
      creditorName: item.creditorName,
      bureau: match.sender,
      passNumber: Math.min(6, Math.max(1, item.disputeRound || 1)),
      outcome: learnedOutcome,
    });

    await CaseRepository.appendEvent({
      profileId: match.profileId,
      caseId: match.caseId,
      type: 'response.applied',
      actor: 'autopilot',
      payload: { matchId: match.id, outcome: match.outcome, changedFields: match.changedFields },
    });
  },
};
