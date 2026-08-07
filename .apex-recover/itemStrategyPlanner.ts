/**
 * Item Strategy Planner (Apex) — per-item Strategy Cards with Why bullets.
 */

import type { NegativeItem, PersonalInfo } from '../types';
import type { PassNumber } from '../types/creditRepair';
import { buildLegalProfile, type LegalProfile } from './legalIntelligenceEngine';
import {
  getDebtTypeStrategy,
  type DebtClass,
  type DebtTypeStrategy,
} from './debtTypeStrategyLibrary';
import { scanForFraud, type FraudFlag } from './fraudDetectionEngine';
import { estimateScoreImpactRange, type ScoreImpactRange } from './scoreImpactSimulator';
import { AbStrategyTracker, type StrategyWinRate } from './abStrategyTracker';
import { evaluateGoodwillEligibility, type GoodwillProfile } from './goodwillCampaignEngine';
import { OutcomeLearningStore } from './outcomeLearningStore';

export type CampaignType =
  | 'dispute'
  | 'goodwill'
  | 'debt_validation'
  | 'inquiry'
  | 'obsolescence'
  | 'fraud_block';

export interface ExplainCard {
  headline: string;
  detail: string;
  legalBasis: string | null;
  evidenceRequired: string | null;
  actionableBy: 'autopilot' | 'user';
}

export interface ApexItemStrategyCard {
  itemId: string;
  creditorName: string;
  bureau: string;
  pass: PassNumber;
  primaryAngle: string;
  legalAnchors: string[];
  legalProfile: LegalProfile;
  debtClass: DebtClass;
  debtTypeStrategy: DebtTypeStrategy;
  fraudFlags: FraudFlag[];
  estimatedScoreImpactOnDeletion: ScoreImpactRange;
  abHistoricalWinRate: StrategyWinRate | null;
  goodwillEligible: boolean;
  goodwillProfile: GoodwillProfile | null;
  statementEligible: boolean;
  explainWhy: ExplainCard[];
  campaignType: CampaignType;
  crossBureauCampaignId: string | null;
  strategyConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  blockReasons: string[];
}

export function planItemStrategy(params: {
  item: NegativeItem;
  pass: PassNumber;
  personalInfo?: Pick<PersonalInfo, 'state' | 'ssn' | 'address' | 'city'> | null;
  allItems?: NegativeItem[];
  profileId?: string;
}): ApexItemStrategyCard {
  const { item, pass } = params;
  const allItems = params.allItems ?? [item];
  const fraudFlags = scanForFraud(item, {
    allItems,
    personalInfo: params.personalInfo ?? null,
  });
  const legalProfile = buildLegalProfile(item, params.personalInfo, {
    fraudFlagged: fraudFlags.some((f) => f.severity === 'critical' || f.severity === 'high'),
  });
  const debtTypeStrategy = getDebtTypeStrategy(legalProfile.debtClass);
  const goodwill = evaluateGoodwillEligibility(item);
  const scoreImpact = estimateScoreImpactRange(item);

  const bureau = item.creditBureau?.[0] ?? 'Unknown';
  const abHistoricalWinRate =
    params.profileId != null
      ? AbStrategyTracker.getBestAngle({
          bureau,
          debtType: legalProfile.debtClass,
          creditorName: item.creditorName,
        })
      : null;

  let campaignType: CampaignType = 'dispute';
  let primaryAngle = debtTypeStrategy.keyAngles[0] ?? 'accuracy_challenge';
  const explainWhy: ExplainCard[] = [];
  const blockReasons: string[] = [];
  const confidenceFactors: string[] = [];

  if (fraudFlags.some((f) => f.action.startsWith('escalate') || f.severity === 'critical')) {
    campaignType = 'fraud_block';
    primaryAngle = 'mixed_file_fraud';
    explainWhy.push({
      headline: 'Fraud / mixed-file signal',
      detail: fraudFlags[0]?.rule ?? 'Suspicious account indicators detected.',
      legalBasis: 'FCRA §605B',
      evidenceRequired: 'FTC IdentityTheft.gov affidavit / ID docs',
      actionableBy: 'user',
    });
  } else if (legalProfile.obsoletionDisputable) {
    campaignType = 'obsolescence';
    primaryAngle = 'seven_year_obsolescence';
    explainWhy.push({
      headline: '7-year credit clock expired',
      detail: `Reporting appears past obsolescence (expires ${legalProfile.creditClockExpiresDate}).`,
      legalBasis: 'FCRA §605',
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
    confidenceFactors.push('Factual obsolescence — low frivolous risk');
  } else if (
    legalProfile.fdcpa809Applicable &&
    (pass <= 2 || legalProfile.validationWindowOpen) &&
    legalProfile.debtClass === 'collections'
  ) {
    campaignType = 'debt_validation';
    primaryAngle = 'debt_validation';
    explainWhy.push({
      headline: 'Debt validation posture',
      detail: 'Collection account — demand validation and original creditor identity.',
      legalBasis: 'FDCPA §809',
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
  } else if (goodwill.eligible && item.forceStrategy === 'goodwill') {
    campaignType = 'goodwill';
    primaryAngle = 'goodwill_request';
    explainWhy.push({
      headline: 'Goodwill request (not a dispute)',
      detail: goodwill.profile?.toneProfile
        ? `Recommended tone: ${goodwill.profile.toneProfile}`
        : 'Paid/settled account with late history — goodwill ladder.',
      legalBasis: null,
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
  } else if (legalProfile.debtClass === 'hard_inquiry') {
    campaignType = 'inquiry';
    primaryAngle = 'permissible_purpose';
    explainWhy.push({
      headline: 'Hard inquiry dispute path',
      detail: 'Inquiry disputes stay on a separate letter track from tradelines.',
      legalBasis: 'FCRA §604',
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
  } else if (legalProfile.metro2Violations.length > 0) {
    primaryAngle = 'metro2_compliance';
    const v = legalProfile.metro2Violations[0];
    explainWhy.push({
      headline: 'Metro2 violation detected',
      detail: v.description,
      legalBasis: v.legalBasis ?? 'FCRA §623(a)(1)',
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
    confidenceFactors.push('Metro2 defect grounded in report fields');
  } else {
    explainWhy.push({
      headline: `${debtTypeStrategy.label} strategy`,
      detail: debtTypeStrategy.specialLogic,
      legalBasis: debtTypeStrategy.preferredLegalAnchors[0] ?? 'fcra_611',
      evidenceRequired: debtTypeStrategy.evidenceHints[0] ?? null,
      actionableBy: 'autopilot',
    });
  }

  // Outcome learning nudge
  const learned = OutcomeLearningStore.recommendAngle?.(item.creditorName, bureau);
  if (learned && campaignType === 'dispute') {
    primaryAngle = learned;
    confidenceFactors.push(`Outcome learning prefers angle: ${learned}`);
  }

  if (abHistoricalWinRate && abHistoricalWinRate.confidence !== 'low') {
    if (abHistoricalWinRate.deletionRate >= 0.25) {
      primaryAngle = abHistoricalWinRate.angle;
      confidenceFactors.push(
        `A/B win rate ${Math.round(abHistoricalWinRate.deletionRate * 100)}% (n=${abHistoricalWinRate.sampleSize})`,
      );
    } else if (abHistoricalWinRate.deletionRate < 0.1 && abHistoricalWinRate.confidence === 'high') {
      confidenceFactors.push(`Demoting weak angle ${abHistoricalWinRate.angle} for this bureau/type`);
    }
  }

  if (legalProfile.sol.solDefenseApplicable) {
    explainWhy.push({
      headline: 'SOL defense available',
      detail: `Statute of limitations appears expired in ${legalProfile.sol.stateCode ?? 'your state'} (${legalProfile.sol.solYears}y).`,
      legalBasis: 'State SOL + FDCPA',
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
  }

  explainWhy.push({
    headline: 'Score impact if deleted',
    detail: `Estimated +${scoreImpact.low} to +${scoreImpact.high} pts (range estimate, not FICO).`,
    legalBasis: null,
    evidenceRequired: null,
    actionableBy: 'user',
  });

  // Ensure ≥3 Why bullets
  while (explainWhy.length < 3) {
    explainWhy.push({
      headline: 'Pass ladder',
      detail: `Currently planning Pass ${pass} for this item.`,
      legalBasis: 'FCRA §611',
      evidenceRequired: null,
      actionableBy: 'autopilot',
    });
  }

  const statementEligible =
    pass >= 5 &&
    (item.disputeStatus?.includes('Verified') || item.verificationCount != null && item.verificationCount >= 3);

  let strategyConfidence: 'high' | 'medium' | 'low' = 'medium';
  if (campaignType === 'obsolescence' || legalProfile.metro2Violations.length > 0) strategyConfidence = 'high';
  if (fraudFlags.length > 0 && campaignType === 'fraud_block') strategyConfidence = 'high';
  if (legalProfile.dofdConfidence === 'missing' && collectionLike(item)) {
    strategyConfidence = 'low';
    blockReasons.push('DOFD missing — preflight may hold item for enrichment');
  }

  return {
    itemId: item.id,
    creditorName: item.creditorName,
    bureau,
    pass,
    primaryAngle,
    legalAnchors: legalProfile.availableAnchors.map((a) => a.id),
    legalProfile,
    debtClass: legalProfile.debtClass,
    debtTypeStrategy,
    fraudFlags,
    estimatedScoreImpactOnDeletion: scoreImpact,
    abHistoricalWinRate,
    goodwillEligible: goodwill.eligible,
    goodwillProfile: goodwill.profile,
    statementEligible: !!statementEligible,
    explainWhy: explainWhy.slice(0, 5),
    campaignType,
    crossBureauCampaignId: item.crossBureauGroupId ?? null,
    strategyConfidence,
    confidenceFactors,
    blockReasons,
  };
}

function collectionLike(item: NegativeItem): boolean {
  const blob = `${item.typeOfNegative} ${item.accountType} ${item.status}`.toLowerCase();
  return /\bcollection\b|\bcharge[\s-]?off\b/.test(blob);
}

export function planStrategiesForBatch(params: {
  items: NegativeItem[];
  passNumbers: Record<string, PassNumber>;
  personalInfo?: Pick<PersonalInfo, 'state' | 'ssn' | 'address' | 'city'> | null;
  profileId?: string;
}): ApexItemStrategyCard[] {
  return params.items.map((item) =>
    planItemStrategy({
      item,
      pass: (params.passNumbers[item.id] ?? 1) as PassNumber,
      personalInfo: params.personalInfo,
      allItems: params.items,
      profileId: params.profileId,
    }),
  );
}
