/**
 * factLedgerService.ts — Versioned facts with provenance.
 * Derived facts must store the rule used; never silently become user-confirmed.
 */

import { v4 as uuidv4 } from 'uuid';
import type { CaseFact, FactConfidence, FactSourceType } from '../types/autopilotCase';
import { idbGet, idbGetAll, idbSet } from './indexedDB';
import { CaseRepository } from './caseRepository';

function factVersionHash(facts: CaseFact[]): string {
  const material = facts
    .filter((f) => !facts.some((other) => other.supersedesFactId === f.id))
    .map((f) => `${f.field}:${JSON.stringify(f.value)}:${f.confidence}`)
    .sort()
    .join('|');
  let hash = 0;
  for (let i = 0; i < material.length; i++) {
    hash = ((hash << 5) - hash + material.charCodeAt(i)) | 0;
  }
  return `fv_${Math.abs(hash).toString(36)}_${facts.length}`;
}

export const FactLedgerService = {
  async getFactsForCase(caseId: string): Promise<CaseFact[]> {
    const all = await idbGetAll<CaseFact>('caseFacts');
    return all.filter((f) => f.caseId === caseId);
  },

  async getActiveFacts(caseId: string): Promise<CaseFact[]> {
    const facts = await this.getFactsForCase(caseId);
    const superseded = new Set(facts.map((f) => f.supersedesFactId).filter(Boolean) as string[]);
    return facts.filter((f) => !superseded.has(f.id));
  },

  async getFact(id: string): Promise<CaseFact | undefined> {
    return idbGet<CaseFact>('caseFacts', id);
  },

  async recordFact(input: {
    profileId: string;
    caseId: string;
    field: string;
    value: unknown;
    sourceType: FactSourceType;
    sourceId: string;
    confidence: FactConfidence;
    userConfirmedAt?: string;
    supersedesFactId?: string;
    derivationRule?: string;
  }): Promise<CaseFact> {
    if (input.sourceType === 'derived' && !input.derivationRule) {
      throw new Error('Derived facts must include derivationRule');
    }
    if (input.confidence === 'confirmed' && input.sourceType === 'derived' && !input.userConfirmedAt) {
      throw new Error('Derived facts cannot be marked confirmed without userConfirmedAt');
    }

    const active = await this.getActiveFacts(input.caseId);
    const prior = active.find((f) => f.field === input.field);
    const fact: CaseFact = {
      id: uuidv4(),
      profileId: input.profileId,
      caseId: input.caseId,
      field: input.field,
      value: input.value,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      capturedAt: new Date().toISOString(),
      confidence: input.confidence,
      userConfirmedAt: input.userConfirmedAt,
      supersedesFactId: input.supersedesFactId || prior?.id,
      derivationRule: input.derivationRule,
    };
    await idbSet('caseFacts', fact);

    const refreshed = await this.getActiveFacts(input.caseId);
    const version = factVersionHash(refreshed);
    const c = await CaseRepository.getCase(input.caseId);
    if (c) {
      await CaseRepository.saveCase({ ...c, factVersion: version, updatedAt: new Date().toISOString() });
    }
    await CaseRepository.appendEvent({
      profileId: input.profileId,
      caseId: input.caseId,
      type: 'fact.recorded',
      actor: input.sourceType === 'user' ? 'user' : 'autopilot',
      payload: { field: input.field, confidence: input.confidence, sourceType: input.sourceType },
    });
    return fact;
  },

  async confirmFact(factId: string): Promise<CaseFact | undefined> {
    const existing = await this.getFact(factId);
    if (!existing) return undefined;
    return this.recordFact({
      profileId: existing.profileId,
      caseId: existing.caseId,
      field: existing.field,
      value: existing.value,
      sourceType: 'user',
      sourceId: `confirm:${existing.id}`,
      confidence: 'confirmed',
      userConfirmedAt: new Date().toISOString(),
      supersedesFactId: existing.id,
    });
  },

  async seedFromReportFields(
    profileId: string,
    caseId: string,
    fields: Record<string, unknown>,
    sourceId: string,
  ): Promise<CaseFact[]> {
    const out: CaseFact[] = [];
    const fieldsToSeed: Record<string, unknown> = {
      userRecognizesAccount: true,
      ...fields,
    };
    for (const [field, value] of Object.entries(fieldsToSeed)) {
      if (value == null || value === '') continue;
      out.push(
        await this.recordFact({
          profileId,
          caseId,
          field,
          value,
          sourceType: 'report',
          sourceId,
          confidence: 'high',
        }),
      );
    }
    return out;
  },

  async getFactVersion(caseId: string): Promise<string> {
    const active = await this.getActiveFacts(caseId);
    return factVersionHash(active);
  },

  findMissingHighValueFields(activeFacts: CaseFact[]): string[] {
    const byField = new Map(activeFacts.map((f) => [f.field, f]));
    const missing: string[] = [];
    const recognize = byField.get('userRecognizesAccount');
    // If not recorded at all, default to recognized (true) rather than spamming questions
    if (recognize && (recognize.confidence === 'ambiguous' || recognize.confidence === 'conflicting')) {
      missing.push('userRecognizesAccount');
    }
    return missing;
  },

  async confirmAllAccountFacts(profileId: string, caseIds: string[]): Promise<void> {
    for (const caseId of caseIds) {
      await this.recordFact({
        profileId,
        caseId,
        field: 'userRecognizesAccount',
        value: true,
        sourceType: 'user',
        sourceId: 'bulk_confirm',
        confidence: 'confirmed',
        userConfirmedAt: new Date().toISOString(),
      });
    }
  },
};
