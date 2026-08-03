/**
 * batchSelector.ts — Smart Batch Selection Algorithm
 * Selects the optimal subset of items to dispute in each cycle.
 * Uses deletability + urgency scores, hold queue status, diversity, and batch size constraints.
 */

import { NegativeItem } from '../types';
import { PassNumber, AutoPilotSettingsV2 } from '../types/creditRepair';
import { HoldQueue } from './holdQueue';
import { ItemScorer, ItemScore } from './itemScorer';
import { selectNextAngle } from './disputeAngleRotator';

export interface BatchRationaleStructured {
  eligibleCount: number;
  deferredConcentration: number;
  deferredAngleCap: number;
  deferredFrivolousExperian: number;
  diversityNotes: string[];
  angleCounts: Record<string, number>;
  passMix: Record<string, number>;
}

export interface BatchSelectionResult {
  selected: NegativeItem[];
  scores: ItemScore[];
  skippedOnHold: NegativeItem[];
  skippedDeleted: NegativeItem[];
  skippedSOL: NegativeItem[];
  totalCandidates: number;
  batchRationale: string;
  batchRationaleStructured: BatchRationaleStructured;
}

export interface BatchStrategyHint {
  primaryAngle: string;
  frivolousRisk: string;
}

const SKIP_STATUSES = new Set(['Deleted', 'Won']);
const MAX_ITEMS_PER_CREDITOR_PER_BATCH = 2;
const MAX_SAME_ANGLE_PER_BATCH = 2;
const MAX_HIGH_FRIVOLOUS_EXPERIAN = 1;

function isExperian(item: NegativeItem): boolean {
  return (item.creditBureau ?? []).some((b) =>
    b.toLowerCase().replace(/[^a-z]/g, '').includes('experian'),
  );
}

function resolveHint(
  item: NegativeItem,
  pass: PassNumber,
  hints?: Record<string, BatchStrategyHint>,
): BatchStrategyHint {
  if (hints?.[item.id]) return hints[item.id];
  const angle = selectNextAngle(item, [], pass);
  return { primaryAngle: angle.code, frivolousRisk: angle.frivolousRisk };
}

export const BatchSelector = {
  selectBatch(
    items: NegativeItem[],
    profileId: string,
    settings: AutoPilotSettingsV2,
    currentPassNumbers?: Record<string, PassNumber>,
    strategyHints?: Record<string, BatchStrategyHint>,
  ): BatchSelectionResult {
    const skippedDeleted: NegativeItem[] = [];
    const skippedOnHold: NegativeItem[] = [];
    const skippedSOL: NegativeItem[] = [];
    const candidates: NegativeItem[] = [];

    for (const item of items) {
      if (SKIP_STATUSES.has(item.disputeStatus ?? '')) {
        skippedDeleted.push(item);
        continue;
      }

      if (item.autoRemovalDate) {
        const daysUntilDrop = Math.floor(
          (new Date(item.autoRemovalDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
        );
        if (daysUntilDrop < 0 || daysUntilDrop < 30) {
          skippedSOL.push(item);
          continue;
        }
      }

      if (HoldQueue.isOnHold(profileId, item.id)) {
        skippedOnHold.push(item);
        continue;
      }

      candidates.push(item);
    }

    const scores = ItemScorer.scoreItems(candidates, currentPassNumbers);
    const rawBatchSize = Math.ceil(candidates.length * settings.batchFraction);
    const batchSize = Math.min(rawBatchSize, settings.maxItemsPerBatch);

    const itemById = new Map(candidates.map((item) => [item.id, item]));
    const selectedScores: ItemScore[] = [];
    const selectedIds = new Set<string>();
    const creditorCounts = new Map<string, number>();
    const angleCounts: Record<string, number> = {};
    const passMix: Record<string, number> = {};
    let concentrationDeferrals = 0;
    let deferredAngleCap = 0;
    let deferredFrivolousExperian = 0;
    let highFrivolousExperianCount = 0;
    const diversityNotes: string[] = [];

    for (const score of scores) {
      if (selectedScores.length >= batchSize) break;
      const item = itemById.get(score.itemId);
      if (!item) continue;

      const pass = (currentPassNumbers?.[item.id] ?? 1) as PassNumber;
      const hint = resolveHint(item, pass, strategyHints);
      const creditorKey = (item.creditorName || 'unknown').trim().toLowerCase();
      const countForCreditor = creditorCounts.get(creditorKey) ?? 0;
      if (countForCreditor >= MAX_ITEMS_PER_CREDITOR_PER_BATCH) {
        concentrationDeferrals++;
        continue;
      }

      const angleCount = angleCounts[hint.primaryAngle] ?? 0;
      if (angleCount >= MAX_SAME_ANGLE_PER_BATCH) {
        deferredAngleCap++;
        continue;
      }

      const highFrivExperian =
        hint.frivolousRisk === 'HIGH' && isExperian(item);
      if (highFrivExperian && highFrivolousExperianCount >= MAX_HIGH_FRIVOLOUS_EXPERIAN) {
        deferredFrivolousExperian++;
        continue;
      }

      selectedScores.push(score);
      selectedIds.add(score.itemId);
      creditorCounts.set(creditorKey, countForCreditor + 1);
      angleCounts[hint.primaryAngle] = angleCount + 1;
      const passKey = String(pass);
      passMix[passKey] = (passMix[passKey] ?? 0) + 1;
      if (highFrivExperian) highFrivolousExperianCount++;
    }

    // Prefer pass mix: if underfilled and only one pass represented, backfill other passes first
    if (selectedScores.length < batchSize) {
      const preferredPasses = Object.keys(passMix).length <= 1;
      const backfill = preferredPasses
        ? [...scores].sort((a, b) => {
            const itemA = itemById.get(a.itemId);
            const itemB = itemById.get(b.itemId);
            const passA = currentPassNumbers?.[a.itemId] ?? 1;
            const passB = currentPassNumbers?.[b.itemId] ?? 1;
            const represented = Object.keys(passMix)[0];
            const preferA = String(passA) !== represented ? 1 : 0;
            const preferB = String(passB) !== represented ? 1 : 0;
            return preferB - preferA || b.totalScore - a.totalScore;
          })
        : scores;

      for (const score of backfill) {
        if (selectedScores.length >= batchSize) break;
        if (selectedIds.has(score.itemId)) continue;
        const item = itemById.get(score.itemId);
        if (!item) continue;
        selectedScores.push(score);
        selectedIds.add(score.itemId);
        const pass = currentPassNumbers?.[item.id] ?? 1;
        passMix[String(pass)] = (passMix[String(pass)] ?? 0) + 1;
      }
      if (preferredPasses) {
        diversityNotes.push('Backfilled to diversify pass numbers within batch');
      }
    }

    if (settings.dualTargetMode) {
      diversityNotes.push('Dual-target mode on — prefer strong-evidence items when available');
    }
    if (deferredAngleCap > 0) {
      diversityNotes.push(
        `Deferred ${deferredAngleCap} item(s) for same-angle cap (max ${MAX_SAME_ANGLE_PER_BATCH})`,
      );
    }
    if (deferredFrivolousExperian > 0) {
      diversityNotes.push(
        `Deferred ${deferredFrivolousExperian} high-frivolous Experian item(s) (max ${MAX_HIGH_FRIVOLOUS_EXPERIAN}/batch)`,
      );
    }
    if (concentrationDeferrals > 0) {
      diversityNotes.push(
        `Deferred ${concentrationDeferrals} for per-creditor soft cap (${MAX_ITEMS_PER_CREDITOR_PER_BATCH})`,
      );
    }

    const selected = selectedScores
      .map((score) => itemById.get(score.itemId))
      .filter((item): item is NegativeItem => Boolean(item));

    const batchRationaleStructured: BatchRationaleStructured = {
      eligibleCount: candidates.length,
      deferredConcentration: concentrationDeferrals,
      deferredAngleCap,
      deferredFrivolousExperian,
      diversityNotes,
      angleCounts,
      passMix,
    };

    const batchRationale = [
      `${candidates.length} eligible items`,
      `${skippedOnHold.length} on hold`,
      `${skippedDeleted.length} already removed`,
      `Selected top ${selected.length} by score (${Math.round(settings.batchFraction * 100)}% of eligible)`,
      ...diversityNotes,
      `Max batch: ${settings.maxItemsPerBatch}`,
    ].join(' · ');

    return {
      selected,
      scores: selectedScores,
      skippedOnHold,
      skippedDeleted,
      skippedSOL,
      totalCandidates: candidates.length,
      batchRationale,
      batchRationaleStructured,
    };
  },
};
