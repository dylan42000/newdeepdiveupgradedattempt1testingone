/**
 * Full Audit Export (Apex AD-15) — JSON (+ printable text) dispute record.
 */

import type { NegativeItem, PersonalInfo } from '../types';
import type { ApexItemStrategyCard } from './apexItemStrategyPlanner';
import { AbStrategyTracker } from './abStrategyTracker';
import { OutcomeLearningStore } from './outcomeLearningStore';

export interface AuditExportPayload {
  generatedAt: string;
  profileLabel: string;
  section1_summary: {
    totalItems: number;
    byBureau: Record<string, number>;
    byStatus: Record<string, number>;
  };
  section2_perItem: Array<{
    itemId: string;
    creditor: string;
    bureau: string;
    type: string;
    accountLast4: string;
    strategyCard?: Pick<
      ApexItemStrategyCard,
      'campaignType' | 'primaryAngle' | 'explainWhy' | 'legalAnchors' | 'strategyConfidence'
    >;
  }>;
  section3_outcomes: ReturnType<typeof OutcomeLearningStore.getAll>;
  section4_abIntelligence: ReturnType<typeof AbStrategyTracker.computeWinRates>;
  section5_aiNote: string;
}

export function buildAuditExport(params: {
  items: NegativeItem[];
  personalInfo?: PersonalInfo | null;
  strategyCards?: ApexItemStrategyCard[];
  profileId?: string;
  redactName?: boolean;
}): AuditExportPayload {
  const cardsById = new Map((params.strategyCards ?? []).map((c) => [c.itemId, c]));
  const byBureau: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const item of params.items) {
    const b = item.creditBureau?.[0] ?? 'Unknown';
    byBureau[b] = (byBureau[b] ?? 0) + 1;
    byStatus[item.disputeStatus] = (byStatus[item.disputeStatus] ?? 0) + 1;
  }

  const name = params.redactName
    ? '[REDACTED]'
    : `${params.personalInfo?.firstName ?? ''} ${params.personalInfo?.lastName ?? ''}`.trim() || 'Consumer';

  return {
    generatedAt: new Date().toISOString(),
    profileLabel: name,
    section1_summary: {
      totalItems: params.items.length,
      byBureau,
      byStatus,
    },
    section2_perItem: params.items.map((item) => {
      const card = cardsById.get(item.id);
      const digits = (item.fullAccountNumber || item.accountNumber || '').replace(/\D/g, '');
      return {
        itemId: item.id,
        creditor: item.creditorName,
        bureau: item.creditBureau?.[0] ?? 'Unknown',
        type: item.typeOfNegative,
        accountLast4: digits.slice(-4) || '****',
        strategyCard: card
          ? {
              campaignType: card.campaignType,
              primaryAngle: card.primaryAngle,
              explainWhy: card.explainWhy,
              legalAnchors: card.legalAnchors,
              strategyConfidence: card.strategyConfidence,
            }
          : undefined,
      };
    }),
    section3_outcomes: OutcomeLearningStore.getAll(params.profileId),
    section4_abIntelligence: AbStrategyTracker.computeWinRates(),
    section5_aiNote:
      'AI provider names/timestamps only are retained in cycle logs; letter content is not exported here.',
  };
}

export function auditExportToJson(payload: AuditExportPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function auditExportToPrintableText(payload: AuditExportPayload): string {
  const lines: string[] = [
    'DYLANDO DISPUTE AUDIT RECORD',
    `Generated: ${payload.generatedAt}`,
    `Profile: ${payload.profileLabel}`,
    '',
    'SECTION 1: Credit Profile Summary',
    `  Total items: ${payload.section1_summary.totalItems}`,
    `  By bureau: ${JSON.stringify(payload.section1_summary.byBureau)}`,
    `  By status: ${JSON.stringify(payload.section1_summary.byStatus)}`,
    '',
    'SECTION 2: Per-Item Dispute History',
  ];
  for (const row of payload.section2_perItem) {
    lines.push(`  - ${row.creditor} (${row.bureau}) …${row.accountLast4} [${row.type}]`);
    if (row.strategyCard) {
      lines.push(
        `      Campaign: ${row.strategyCard.campaignType} · Angle: ${row.strategyCard.primaryAngle} · Confidence: ${row.strategyCard.strategyConfidence}`,
      );
      for (const why of row.strategyCard.explainWhy.slice(0, 3)) {
        lines.push(`      ▸ ${why.headline}: ${why.detail}`);
      }
    }
  }
  lines.push('', 'SECTION 3: Outcome Intelligence', `  Records: ${payload.section3_outcomes.length}`);
  lines.push('', 'SECTION 4: A/B Strategy Win Rates');
  for (const w of payload.section4_abIntelligence.slice(0, 20)) {
    lines.push(
      `  - ${w.angle} @ ${w.bureau}/${w.debtType}: delete ${(w.deletionRate * 100).toFixed(0)}% (n=${w.sampleSize}, ${w.confidence})`,
    );
  }
  lines.push('', 'SECTION 5: AI Provider Log', `  ${payload.section5_aiNote}`);
  return lines.join('\n');
}
