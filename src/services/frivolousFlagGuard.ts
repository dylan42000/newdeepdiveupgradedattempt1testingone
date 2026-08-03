/**
 * frivolousFlagGuard.ts — Pre-flight frivolous dispute risk guard
 * Prevents bureau rejections by detecting repeat-legal-basis patterns
 * and overly-recent account activity before letter generation.
 */

import { NegativeItem } from '../types';
import { DisputeHistoryEntry } from './strategyRotationEngine';
import type { AutoPilotSettingsV3, PassStrategy } from '../types/creditRepair';

export interface FrivolousRiskAssessment {
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
  recommendation: 'proceed' | 'modify_approach' | 'hold';
}

export function getAdaptiveFrivolousHoldDays(bureau:string, pass:number, triggerReason:string, settings:Pick<AutoPilotSettingsV3,'adaptiveFrivolousHold'>):number { if(!settings.adaptiveFrivolousHold)return 14; let hold=bureau==='Experian'?21:14; if(pass>=4)hold=Math.min(hold,10);if(pass>=5)hold=Math.min(hold,7);if(triggerReason==='same_legal_basis_repeat')hold+=7;return hold; }
export interface FrivolousRiskContext { sameLeadCitationCount:number;sameLegalAngleCount:number;daysSinceLastDispute:number;hasNewEvidenceSinceLast:boolean;bureau:string;letterSimilarityScore:number;hasGenericOpeningDetected:boolean;pass:number;settings:AutoPilotSettingsV3;currentStrategy:PassStrategy }
export interface FrivolousRiskAssessmentV2 { riskScore:number;riskLevel:'none'|'low'|'medium'|'high'|'critical';triggerFactors:Array<{factor:string;weight:number;triggered:boolean;contribution:number}>;recommendation:'proceed'|'proceed_with_rotation'|'hold'|'escalate_strategy';holdDays?:number;suggestedStrategy?:PassStrategy }
export function assessFrivolousRiskV2(ctx:FrivolousRiskContext):FrivolousRiskAssessmentV2 { const defs:[string,number,boolean][]=[['same_lead_citation_repeat',35,ctx.sameLeadCitationCount>=2],['same_legal_angle_repeat',25,ctx.sameLegalAngleCount>=2],['recent_activity_under_30d',20,ctx.daysSinceLastDispute<30],['no_new_evidence_since_last',15,!ctx.hasNewEvidenceSinceLast],['experian_high_risk_bureau',10,ctx.bureau==='Experian'],['word_for_word_match_risk',30,ctx.letterSimilarityScore>.55],['generic_dispute_language',20,ctx.hasGenericOpeningDetected]]; const triggerFactors=defs.map(([factor,weight,triggered])=>({factor,weight,triggered,contribution:triggered?weight:0}));const riskScore=Math.min(100,triggerFactors.reduce((s,f)=>s+f.contribution,0));const riskLevel=riskScore>=70?'critical':riskScore>=50?'high':riskScore>=30?'medium':riskScore>=10?'low':'none';return {riskScore,riskLevel,triggerFactors,recommendation:riskScore>=70?'hold':riskScore>=20?'proceed_with_rotation':'proceed',holdDays:riskScore>=70?getAdaptiveFrivolousHoldDays(ctx.bureau,ctx.pass,'same_legal_basis_repeat',ctx.settings):undefined}; }

/**
 * Assess whether an item carries elevated frivolous-rejection risk.
 *
 * HIGH risk triggers:
 *   1. Same primary legal basis used 2+ times in prior dispute history.
 *   2. dateLastActive is less than 30 days old (recent activity = bureau skepticism).
 *
 * Returns actionable recommendation.
 */
export function assessFrivolousRisk(
  item: NegativeItem,
  disputeHistory: DisputeHistoryEntry[],
  strategy: { name: string; primaryLegalHook: string }
): FrivolousRiskAssessment {
  const flags: string[] = [];

  // Rule 1: Same legal basis used 2+ times previously
  if (strategy.primaryLegalHook && disputeHistory.length > 0) {
    const sameBasisCount = disputeHistory.filter(
      (h) =>
        (h.strategyUsed && strategy.primaryLegalHook.includes(h.strategyUsed)) ||
        (strategy.primaryLegalHook && h.primaryLegalHook?.includes(strategy.primaryLegalHook)) ||
        false
    ).length;

    if (sameBasisCount >= 2) {
      flags.push(
        `Same legal basis used ${sameBasisCount} times previously: ${strategy.primaryLegalHook}`
      );
    }
  }

  // Rule 2: dateLastActive < 30 days old
  if (item.dateLastActive) {
    const lastActive = new Date(item.dateLastActive);
    const daysAgo = (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24);
    if (!Number.isNaN(daysAgo) && daysAgo < 30) {
      flags.push(
        `Item dateLastActive is only ${Math.floor(daysAgo)} days old (${item.dateLastActive})`
      );
    }
  }

  // Determine risk level and recommendation
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let recommendation: 'proceed' | 'modify_approach' | 'hold' = 'proceed';

  if (flags.length >= 2) {
    riskLevel = 'high';
    recommendation = 'hold';
  } else if (flags.length === 1) {
    if (flags.some((f) => f.includes('Same legal basis'))) {
      riskLevel = 'high';
      recommendation = 'hold';
    } else {
      riskLevel = 'medium';
      recommendation = 'modify_approach';
    }
  }

  return { riskLevel, flags, recommendation };
}
