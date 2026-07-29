/**
 * caseRepository.ts — Canonical AutoPilot case reads/writes and migrations.
 * Stable IDs survive re-import via canonicalAccountKey.
 */

import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem } from '../types';
import type {
  AutopilotCase,
  AutoPilotEvent,
  CaseSnapshot,
  CaseState,
  CasePriorityLabel,
} from '../types/autopilotCase';
import type { PassNumber } from '../types/creditRepair';
import { idbGet, idbGetAll, idbSet, openDB } from './indexedDB';
import type { EvidenceTier } from './evidenceGateService';

const SOURCE_VERSION = '5.6.1-case-repo';

function normalizeCreditor(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 48);
}

function accountTail(item: NegativeItem): string {
  const raw = `${item.fullAccountNumber || ''} ${item.accountNumber || ''}`.replace(/\D/g, '');
  if (raw.length >= 4) return raw.slice(-4);
  if (raw.length > 0) return raw;
  return 'xxxx';
}

export function buildCanonicalAccountKey(item: NegativeItem, bureau: string): string {
  return [
    normalizeCreditor(item.creditorName),
    accountTail(item),
    (bureau || 'unknown').toLowerCase().replace(/[^a-z]/g, ''),
  ].join('::');
}

function primaryBureau(item: NegativeItem): string {
  return item.creditBureau?.[0] || 'Unknown';
}

function labelFromScore(score: number, evidenceTier: EvidenceTier): CasePriorityLabel {
  if (evidenceTier === 'BLOCKED' || score < 25) return 'Not currently actionable';
  if (evidenceTier === 'BASIC' || score < 45) return 'Needs evidence';
  if (score >= 70) return 'Strong case';
  return 'Promising';
}

function initialState(item: NegativeItem): CaseState {
  const status = (item.disputeStatus || '').toLowerCase();
  if (status.includes('won') || status.includes('deleted')) return 'DELETED';
  if (status.includes('pending') || status.includes('sent')) return 'WAITING';
  if (status.includes('verified')) return 'VERIFIED';
  return 'ELIGIBLE';
}

async function appendEvent(event: Omit<AutoPilotEvent, 'id' | 'occurredAt' | 'sourceVersion'> & { id?: string }): Promise<void> {
  const all = await idbGetAll<AutoPilotEvent>('autopilotEvents');
  const previous = all
    .filter((e) => e.profileId === event.profileId)
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  const record: AutoPilotEvent = {
    id: event.id || uuidv4(),
    profileId: event.profileId,
    caseId: event.caseId,
    type: event.type,
    occurredAt: new Date().toISOString(),
    actor: event.actor,
    sourceVersion: SOURCE_VERSION,
    payload: event.payload,
    previousEventHash: previous?.id,
  };
  await idbSet('autopilotEvents', record);
}

export const CaseRepository = {
  async ensureReady(): Promise<void> {
    await openDB();
  },

  async getCase(id: string): Promise<AutopilotCase | undefined> {
    return idbGet<AutopilotCase>('cases', id);
  },

  async getCasesForProfile(profileId: string): Promise<AutopilotCase[]> {
    const all = await idbGetAll<AutopilotCase>('cases');
    return all.filter((c) => c.profileId === profileId);
  },

  async getCaseByNegativeItem(profileId: string, negativeItemId: string): Promise<AutopilotCase | undefined> {
    const all = await this.getCasesForProfile(profileId);
    return all.find(
      (c) =>
        c.negativeItemId === negativeItemId ||
        (c.linkedNegativeItemIds ?? []).includes(negativeItemId),
    );
  },

  async getCaseByCanonicalKey(profileId: string, key: string): Promise<AutopilotCase | undefined> {
    const all = await this.getCasesForProfile(profileId);
    return all.find((c) => c.canonicalAccountKey === key);
  },

  async saveCase(caseRecord: AutopilotCase): Promise<void> {
    await idbSet('cases', caseRecord);
  },

  async transition(
    caseId: string,
    nextState: CaseState,
    actor: AutoPilotEvent['actor'] = 'autopilot',
    payload: Record<string, unknown> = {},
  ): Promise<AutopilotCase | undefined> {
    const existing = await this.getCase(caseId);
    if (!existing) return undefined;
    if (existing.state === nextState) return existing;

    const updated: AutopilotCase = {
      ...existing,
      state: nextState,
      updatedAt: new Date().toISOString(),
      lastTransitionAt: new Date().toISOString(),
    };
    await this.saveCase(updated);
    await appendEvent({
      profileId: updated.profileId,
      caseId: updated.id,
      type: `case.state.${nextState}`,
      actor,
      payload: { from: existing.state, to: nextState, ...payload },
    });
    return updated;
  },

  async upsertFromNegativeItem(params: {
    profileId: string;
    item: NegativeItem;
    linkedIds?: string[];
    passNumber?: PassNumber;
    evidenceTier?: EvidenceTier;
    priorityScore?: number;
  }): Promise<AutopilotCase> {
    const { profileId, item } = params;
    const bureau = primaryBureau(item);
    const canonicalAccountKey = buildCanonicalAccountKey(item, bureau);
    const existing =
      (await this.getCaseByCanonicalKey(profileId, canonicalAccountKey)) ||
      (await this.getCaseByNegativeItem(profileId, item.id));

    const evidenceTier = params.evidenceTier || existing?.evidenceTier || 'BASIC';
    const priorityScore = params.priorityScore ?? existing?.priorityScore ?? 50;
    const now = new Date().toISOString();

    if (existing) {
      const updated: AutopilotCase = {
        ...existing,
        creditorName: item.creditorName,
        accountDisplay: item.accountNumber || item.fullAccountNumber || existing.accountDisplay,
        negativeItemId: item.id,
        linkedNegativeItemIds: Array.from(
          new Set([...(params.linkedIds || []), ...(existing.linkedNegativeItemIds ?? []), item.id]),
        ),
        passNumber: params.passNumber || existing.passNumber,
        evidenceTier,
        priorityScore,
        priorityLabel: labelFromScore(priorityScore, evidenceTier),
        updatedAt: now,
      };
      await this.saveCase(updated);
      return updated;
    }

    const created: AutopilotCase = {
      id: uuidv4(),
      profileId,
      canonicalAccountKey,
      bureau,
      creditorName: item.creditorName,
      accountDisplay: item.accountNumber || item.fullAccountNumber || 'unconfirmed',
      negativeItemId: item.id,
      linkedNegativeItemIds: Array.from(new Set([item.id, ...(params.linkedIds || [])])),
      state: initialState(item),
      passNumber: params.passNumber || ((Math.min(6, Math.max(1, item.disputeRound || 1))) as PassNumber),
      priorityScore,
      priorityLabel: labelFromScore(priorityScore, evidenceTier),
      evidenceTier,
      riskFlags: [],
      createdAt: now,
      updatedAt: now,
      lastTransitionAt: now,
    };
    await this.saveCase(created);
    await this.saveSnapshot({
      id: uuidv4(),
      profileId,
      caseId: created.id,
      bureau,
      negativeItemId: item.id,
      capturedAt: now,
      fields: {
        creditorName: item.creditorName,
        accountNumber: item.accountNumber,
        balance: item.balance,
        status: item.status,
        typeOfNegative: item.typeOfNegative,
        dateOpened: item.originalOpeningDate,
        dofd: item.originalDateOfDelinquency,
        dateOfLastReporting: item.dateOfLastReporting,
      },
    });
    await appendEvent({
      profileId,
      caseId: created.id,
      type: 'case.created',
      actor: 'system',
      payload: { negativeItemId: item.id, canonicalAccountKey },
    });
    return created;
  },

  async saveSnapshot(snapshot: CaseSnapshot): Promise<void> {
    await idbSet('caseSnapshots', snapshot);
    const c = await this.getCase(snapshot.caseId);
    if (c) {
      await this.saveCase({ ...c, snapshotVersion: snapshot.id, updatedAt: new Date().toISOString() });
    }
  },

  async getSnapshots(caseId: string): Promise<CaseSnapshot[]> {
    const all = await idbGetAll<CaseSnapshot>('caseSnapshots');
    return all.filter((s) => s.caseId === caseId);
  },

  async syncFromItems(profileId: string, items: NegativeItem[]): Promise<AutopilotCase[]> {
    const out: AutopilotCase[] = [];
    for (const item of items) {
      out.push(await this.upsertFromNegativeItem({ profileId, item }));
    }
    return out;
  },

  async listEvents(profileId: string, caseId?: string): Promise<AutoPilotEvent[]> {
    const all = await idbGetAll<AutoPilotEvent>('autopilotEvents');
    return all
      .filter((e) => e.profileId === profileId && (!caseId || e.caseId === caseId))
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  },

  async appendEvent(
    event: Omit<AutoPilotEvent, 'id' | 'occurredAt' | 'sourceVersion'> & { id?: string },
  ): Promise<void> {
    await appendEvent(event);
  },
};
