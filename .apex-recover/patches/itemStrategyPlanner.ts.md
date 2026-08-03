# Patches for itemStrategyPlanner.ts (12)

## Patch 1 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (156)
```
import { evaluateGoodwillEligibility, type GoodwillProfile } from './goodwillCampaignEngine';
import { OutcomeLearningStore } from './outcomeLearningStore';
```
### NEW (311)
```
import { evaluateGoodwillEligibility, type GoodwillProfile } from './goodwillCampaignEngine';
import { OutcomeLearningStore } from './outcomeLearningStore';
import { classifyOnDeviceSync, type OnDeviceClassification } from './onDeviceClassifier';
import { isStatementEligible } from './consumerStatementEngine';
```

## Patch 2 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (236)
```
  statementEligible: boolean;
  explainWhy: ExplainCard[];
  campaignType: CampaignType;
  crossBureauCampaignId: string | null;
  strategyConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  blockReasons: string[];
}
```
### NEW (272)
```
  statementEligible: boolean;
  onDevice: OnDeviceClassification;
  explainWhy: ExplainCard[];
  campaignType: CampaignType;
  crossBureauCampaignId: string | null;
  strategyConfidence: 'high' | 'medium' | 'low';
  confidenceFactors: string[];
  blockReasons: string[];
}
```

## Patch 3 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (107)
```
  const goodwill = evaluateGoodwillEligibility(item);
  const scoreImpact = estimateScoreImpactRange(item);
```
### NEW (164)
```
  const goodwill = evaluateGoodwillEligibility(item);
  const scoreImpact = estimateScoreImpactRange(item);
  const onDevice = classifyOnDeviceSync(item, { pass });
```

## Patch 4 from 8559bda8-1434-45c3-821e-9ac6a77ac28e.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (1276)
```
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
```
### NEW (1669)
```
  const statementEligible = isStatementEligible(item, pass).eligible;

  let strategyConfidence: 'high' | 'medium' | 'low' = 'medium';
  if (campaignType === 'obsolescence' || legalProfile.metro2Violations.length > 0) strategyConfidence = 'high';
  if (fraudFlags.length > 0 && campaignType === 'fraud_block') strategyConfidence = 'high';
  if (legalProfile.dofdConfidence === 'missing' && collectionLike(item)) {
    strategyConfidence = 'low';
    blockReasons.push('DOFD missing — preflight may hold item for enrichment');
  }
  if (onDevice.frivolousRisk === 'high') {
    strategyConfidence = 'low';
    blockReasons.push('On-device classifier: elevated frivolous-risk band');
    confidenceFactors.push(
      `On-device frivolous risk ${Math.round(onDevice.frivolousRiskScore * 100)}% (${onDevice.engine})`,
    );
  } else if (onDevice.disputeAngleScore >= 0.7) {
    confidenceFactors.push(
      `On-device angle score ${Math.round(onDevice.disputeAngleScore * 100)}% (${onDevice.accountClass})`,
    );
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
    statementEligible,
    onDevice,
    explainWhy: explainWhy.slice(0, 5),
    campaignType,
    crossBureauCampaignId: item.crossBureauGroupId ?? null,
    strategyConfidence,
    confidenceFactors,
    blockReasons,
  };
}
```

## Patch 5 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (264)
```
  // Outcome learning nudge
  const learned = OutcomeLearningStore.recommendAngle?.(item.creditorName, bureau);
  if (learned && campaignType === 'dispute') {
    primaryAngle = learned;
    confidenceFactors.push(`Outcome learning prefers angle: ${learned}`);
  }
```
### NEW (276)
```
  // Outcome learning nudge
  const learned = OutcomeLearningStore.getStats(item.creditorName, bureau).recommendedStrategy;
  if (learned && campaignType === 'dispute') {
    primaryAngle = learned;
    confidenceFactors.push(`Outcome learning prefers angle: ${learned}`);
  }
```

## Patch 6 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (244)
```
export function planItemStrategy(params: {
  item: NegativeItem;
  pass: PassNumber;
  personalInfo?: Pick<PersonalInfo, 'state' | 'ssn' | 'address' | 'city'> | null;
  allItems?: NegativeItem[];
  profileId?: string;
}): ApexItemStrategyCard {
```
### NEW (253)
```
export function planItemStrategy(params: {
  item: NegativeItem;
  pass: PassNumber;
  personalInfo?: { state?: string; ssn?: string; address?: string; city?: string } | null;
  allItems?: NegativeItem[];
  profileId?: string;
}): ApexItemStrategyCard {
```

## Patch 7 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (249)
```
export function planStrategiesForBatch(params: {
  items: NegativeItem[];
  passNumbers: Record<string, PassNumber>;
  personalInfo?: Pick<PersonalInfo, 'state' | 'ssn' | 'address' | 'city'> | null;
  profileId?: string;
}): ApexItemStrategyCard[] {
```
### NEW (258)
```
export function planStrategiesForBatch(params: {
  items: NegativeItem[];
  passNumbers: Record<string, PassNumber>;
  personalInfo?: { state?: string; ssn?: string; address?: string; city?: string } | null;
  profileId?: string;
}): ApexItemStrategyCard[] {
```

## Patch 8 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (706)
```
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
```
### NEW (692)
```
import type { NegativeItem } from '../types';
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
```

## Patch 9 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (264)
```
  // Outcome learning nudge
  const learned = OutcomeLearningStore.recommendAngle?.(item.creditorName, bureau);
  if (learned && campaignType === 'dispute') {
    primaryAngle = learned;
    confidenceFactors.push(`Outcome learning prefers angle: ${learned}`);
  }
```
### NEW (276)
```
  // Outcome learning nudge
  const learned = OutcomeLearningStore.getStats(item.creditorName, bureau).recommendedStrategy;
  if (learned && campaignType === 'dispute') {
    primaryAngle = learned;
    confidenceFactors.push(`Outcome learning prefers angle: ${learned}`);
  }
```

## Patch 10 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (244)
```
export function planItemStrategy(params: {
  item: NegativeItem;
  pass: PassNumber;
  personalInfo?: Pick<PersonalInfo, 'state' | 'ssn' | 'address' | 'city'> | null;
  allItems?: NegativeItem[];
  profileId?: string;
}): ApexItemStrategyCard {
```
### NEW (253)
```
export function planItemStrategy(params: {
  item: NegativeItem;
  pass: PassNumber;
  personalInfo?: { state?: string; ssn?: string; address?: string; city?: string } | null;
  allItems?: NegativeItem[];
  profileId?: string;
}): ApexItemStrategyCard {
```

## Patch 11 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (249)
```
export function planStrategiesForBatch(params: {
  items: NegativeItem[];
  passNumbers: Record<string, PassNumber>;
  personalInfo?: Pick<PersonalInfo, 'state' | 'ssn' | 'address' | 'city'> | null;
  profileId?: string;
}): ApexItemStrategyCard[] {
```
### NEW (258)
```
export function planStrategiesForBatch(params: {
  items: NegativeItem[];
  passNumbers: Record<string, PassNumber>;
  personalInfo?: { state?: string; ssn?: string; address?: string; city?: string } | null;
  profileId?: string;
}): ApexItemStrategyCard[] {
```

## Patch 12 from ea7d50da-25c3-4e76-9b9e-702076ac9325.jsonl
Path: `D:\downloads\DYLANDOS ULTIMATE CREDIT REPAIR LATEST\newdeepdiveupgradedattempt1\src\services\itemStrategyPlanner.ts`
### OLD (706)
```
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
```
### NEW (692)
```
import type { NegativeItem } from '../types';
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
```
