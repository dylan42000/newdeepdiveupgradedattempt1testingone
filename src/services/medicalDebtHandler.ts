/**
 * Medical Debt Handler
 * Fast-track removal service for medical collections.
 *
 * Key legal leverage points:
 * - CFPB Rule (2024): Medical debts under $500 cannot appear on credit reports.
 * - CFPB Final Rule effective March 2025: ALL medical debt removed from credit reports.
 * - HIPAA: Creditor must have HIPAA authorization before sharing medical info with bureaus.
 * - HITECH Act: Extends HIPAA protections.
 * - No Surprises Act: Surprise medical billing protections.
 * - Most states have additional medical debt protections.
 *
 * Note: Rule implementation dates and status should be verified for current effectiveness.
 */

import { aiComplete } from './aiRouter';
import type { NegativeItem } from '../types';

// ─── Types ────────────────────────────────────────────────────────────────────

export type MedicalDebtCategory =
  | 'hospital'
  | 'physician'
  | 'emergency_room'
  | 'lab_radiology'
  | 'ambulance'
  | 'dental'
  | 'mental_health'
  | 'pharmacy'
  | 'unknown';

export type MedicalDebtRemovalBasis =
  | 'CFPB_2024_UNDER_500'
  | 'CFPB_2025_ALL_MEDICAL'
  | 'HIPAA_NO_AUTHORIZATION'
  | 'PAID_IN_FULL'
  | 'INSURANCE_COVERED'
  | 'FINANCIAL_ASSISTANCE'
  | 'BILLING_ERROR'
  | 'IDENTITY_THEFT'
  | 'SOL_EXPIRED'
  | 'NO_SURPRISES_ACT'
  | 'STATE_LAW_PROTECTION';

export interface MedicalDebtAnalysis {
  isMedicalDebt: boolean;
  category: MedicalDebtCategory;
  estimatedBalance: number;
  applicableRemovalBases: MedicalDebtRemovalBasis[];
  primaryBasis: MedicalDebtRemovalBasis | null;
  strength: 'strong' | 'moderate' | 'weak';
  fastTrackEligible: boolean;
  recommendedAction: string;
  legalCitations: string[];
}

export interface MedicalDisputeLetter {
  subject: string;
  body: string;
  legalBasis: MedicalDebtRemovalBasis;
  citations: string[];
}

// ─── Medical creditor detection ────────────────────────────────────────────────

const MEDICAL_KEYWORDS = [
  'hospital', 'medical', 'health', 'clinic', 'physician', 'doctor', 'surgery',
  'emergency', 'ambulance', 'radiology', 'lab', 'laboratory', 'dental', 'dentist',
  'pharmacy', 'pharmac', 'orthopedic', 'cardiology', 'oncology', 'pediatric',
  'urgent care', 'rehab', 'therapy', 'mental health', 'behavioral', 'nursing',
  'med center', 'medical center', 'health system', 'healthcare', 'mediator',
  'ems ', 'anesthesia', 'pathology', 'dermatology', 'neurology', 'urology',
  'collections', // Many medical debts appear as generic collections
  'patient', 'billing',
];

// Collectors known to primarily work with medical debts
const MEDICAL_COLLECTOR_INDICATORS = [
  'medical revenue', 'healthcare revenue', 'patient financial', 'medrecovery',
  'parallon', 'team health', 'accent health', 'nco group', 'conifer',
];

export function detectMedicalDebt(item: NegativeItem): boolean {
  const searchText = [
    item.creditorName,
    item.accountNumber,
    item.accountType,
    item.typeOfNegative,
    item.additionalInfo,
  ].filter(Boolean).join(' ').toLowerCase();

  return MEDICAL_KEYWORDS.some(kw => searchText.includes(kw)) ||
    MEDICAL_COLLECTOR_INDICATORS.some(kw => searchText.includes(kw));
}

function categorizeMedicalDebt(item: NegativeItem): MedicalDebtCategory {
  const text = [item.creditorName, item.typeOfNegative, item.additionalInfo].filter(Boolean).join(' ').toLowerCase();
  if (text.includes('hospital') || text.includes('health system') || text.includes('med center')) return 'hospital';
  if (text.includes('emergency') || text.includes('er ') || text.includes('e.r.')) return 'emergency_room';
  if (text.includes('ambulance') || text.includes('ems')) return 'ambulance';
  if (text.includes('lab') || text.includes('radiology') || text.includes('pathology') || text.includes('imaging')) return 'lab_radiology';
  if (text.includes('dental') || text.includes('dentist') || text.includes('orthodont')) return 'dental';
  if (text.includes('mental health') || text.includes('behavioral') || text.includes('psychiatr') || text.includes('psycholog')) return 'mental_health';
  if (text.includes('pharmacy') || text.includes('pharmac')) return 'pharmacy';
  if (text.includes('physician') || text.includes('doctor') || text.includes('dr ') || text.includes('md ')) return 'physician';
  return 'unknown';
}

// ─── Analysis ─────────────────────────────────────────────────────────────────

export function analyzeMedicalDebt(item: NegativeItem): MedicalDebtAnalysis {
  const isMedical = detectMedicalDebt(item);

  if (!isMedical) {
    return {
      isMedicalDebt: false,
      category: 'unknown',
      estimatedBalance: item.balance ?? 0,
      applicableRemovalBases: [],
      primaryBasis: null,
      strength: 'weak',
      fastTrackEligible: false,
      recommendedAction: 'Not identified as medical debt. Use standard dispute process.',
      legalCitations: [],
    };
  }

  const balance = item.balance ?? 0;
  const category = categorizeMedicalDebt(item);
  const bases: MedicalDebtRemovalBasis[] = [];
  const citations: string[] = [];

  // CFPB 2025 rule — ALL medical debt
  bases.push('CFPB_2025_ALL_MEDICAL');
  citations.push('CFPB Final Rule (2025) — Medical Debt Off Credit Reports');

  // Under $500 CFPB 2024 rule (belt-and-suspenders)
  if (balance < 500) {
    bases.push('CFPB_2024_UNDER_500');
    citations.push('CFPB 2024 Rule — Medical Debts Under $500 Banned from Credit Reports');
  }

  // HIPAA — always applicable to medical debt
  bases.push('HIPAA_NO_AUTHORIZATION');
  citations.push('HIPAA Privacy Rule, 45 CFR § 164.502 — Written authorization required before disclosing PHI');
  citations.push('HITECH Act, 42 U.S.C. § 17934 — Extends HIPAA protections to business associates');

  // Paid in full
  if (item.status?.toLowerCase().includes('paid') || item.balance === 0) {
    bases.push('PAID_IN_FULL');
    citations.push('FCRA § 623 — Furnishers must report accurate information including payment status');
  }

  // Determine strength
  const strength: 'strong' | 'moderate' | 'weak' =
    bases.includes('CFPB_2025_ALL_MEDICAL') ? 'strong' :
    bases.includes('CFPB_2024_UNDER_500') ? 'strong' :
    bases.includes('HIPAA_NO_AUTHORIZATION') ? 'moderate' : 'weak';

  const primaryBasis = bases[0] ?? null;
  const fastTrackEligible = strength === 'strong';

  const recommendedAction = fastTrackEligible
    ? `FAST TRACK: Send HIPAA + CFPB Rule challenge simultaneously. Cite ${primaryBasis}. Demand immediate removal within 30 days or file CFPB complaint.`
    : `Standard dispute with HIPAA authorization demand. Request proof of written authorization to share your PHI with the credit bureaus.`;

  return {
    isMedicalDebt: true,
    category,
    estimatedBalance: balance,
    applicableRemovalBases: bases,
    primaryBasis,
    strength,
    fastTrackEligible,
    recommendedAction,
    legalCitations: citations,
  };
}

// ─── Letter generation ────────────────────────────────────────────────────────

export function generateMedicalDisputeLetter(
  item: NegativeItem,
  analysis: MedicalDebtAnalysis,
  bureauName: string,
  consumerName: string
): MedicalDisputeLetter {
  const accountRef = item.creditorName ?? 'Account on File';
  const subject = `Dispute and Demand for Immediate Removal — Medical Debt — ${accountRef}`;

  const citations = analysis.legalCitations;

  const hipaaBlock = `
Under the Health Insurance Portability and Accountability Act (HIPAA), 45 CFR § 164.502, any medical information about me constitutes Protected Health Information (PHI). Federal law requires explicit written authorization before my PHI may be disclosed to any third party, including credit reporting agencies. I have never provided such authorization to ${item.creditorName ?? 'this creditor'} or any collection agency acting on their behalf.

By furnishing this medical debt information to your bureau without my written HIPAA authorization, the furnisher has violated federal health privacy law. I demand immediate removal pending verification that a valid HIPAA authorization exists.`;

  const cfpbBlock = analysis.applicableRemovalBases.includes('CFPB_2025_ALL_MEDICAL')
    ? `\nUnder the CFPB Final Rule on Medical Debt (2025), medical debt is categorically prohibited from appearing on consumer credit reports. This item must be removed immediately regardless of its validity.`
    : '';

  const under500Block = analysis.applicableRemovalBases.includes('CFPB_2024_UNDER_500') && (item.balance ?? 0) < 500
    ? `\nAdditionally, this medical debt has an alleged balance of less than $500. Under the Consumer Financial Protection Bureau's 2024 medical debt rule, accounts of this amount cannot appear on consumer credit reports.`
    : '';

  const body = `I am writing to dispute the following account that appears on my credit report furnished by your bureau:

Account Name: ${accountRef}
Original Creditor: ${item.originalCreditor ?? item.creditorName ?? 'Unknown'}
Account Type: Medical Debt
Reported Balance: $${(item.balance ?? 0).toFixed(2)}
${item.accountNumber ? `Account Number: ${item.accountNumber}` : ''}

This item is a medical debt and is subject to enhanced legal protections under federal law.

${hipaaBlock}
${cfpbBlock}
${under500Block}

I demand that ${bureauName} immediately:
1. Remove this medical debt item from my credit report;
2. Send written notification within 5 business days confirming its removal;
3. Provide the HIPAA authorization (if any exists) that permitted this furnishing.

Failure to comply within 30 days will result in:
• A formal complaint filed with the Consumer Financial Protection Bureau (CFPB)
• A formal complaint filed with the Federal Trade Commission (FTC)
• A formal complaint filed with my state Attorney General
• Review of available consumer, regulatory, and legal options based on the documented response

Legal Citations:
${citations.map(c => `• ${c}`).join('\n')}
• FCRA § 611, 15 U.S.C. § 1681i — Right to dispute inaccurate information
• FCRA § 616-617 — Civil liability for willful and negligent noncompliance

I certify that all information provided in this letter is true and accurate under penalty of perjury.

Sincerely,
${consumerName}`;

  return {
    subject,
    body,
    legalBasis: analysis.primaryBasis ?? 'HIPAA_NO_AUTHORIZATION',
    citations,
  };
}

// ─── AI-enhanced medical debt letter ─────────────────────────────────────────

export async function generateAIMedicalLetter(
  item: NegativeItem,
  analysis: MedicalDebtAnalysis,
  bureauName: string,
  consumerName: string
): Promise<MedicalDisputeLetter> {
  // Generate static letter first as fallback
  const staticLetter = generateMedicalDisputeLetter(item, analysis, bureauName, consumerName);

  const systemPrompt = `You are an expert credit repair attorney specializing in HIPAA and medical debt disputes. Write a powerful, legally precise dispute letter. Use formal legal language. Cite specific statutes. Be direct and authoritative.`;

  const userPrompt = `Write a medical debt dispute letter for:
- Consumer: ${consumerName}
- Bureau: ${bureauName}
- Account: ${item.creditorName ?? 'Unknown'}
- Balance: $${item.balance ?? 0}
- Category: ${analysis.category}
- Primary legal basis: ${analysis.primaryBasis}
- All applicable bases: ${analysis.applicableRemovalBases.join(', ')}
- Legal citations to include: ${analysis.legalCitations.join('; ')}

The letter should be firm, legally technical, and demand immediate removal. Include specific statute numbers and regulatory citations. 3-4 paragraphs maximum.`;

  try {
    const aiBody = await aiComplete(systemPrompt, userPrompt, 'legal_demand');
    return {
      ...staticLetter,
      body: aiBody,
    };
  } catch {
    return staticLetter;
  }
}

// ─── Batch analysis ───────────────────────────────────────────────────────────

export function findAllMedicalDebts(items: NegativeItem[]): Array<{
  item: NegativeItem;
  analysis: MedicalDebtAnalysis;
}> {
  return items
    .map(item => ({ item, analysis: analyzeMedicalDebt(item) }))
    .filter(({ analysis }) => analysis.isMedicalDebt)
    .sort((a, b) => {
      // Fast-track eligible first, then by strength
      if (a.analysis.fastTrackEligible && !b.analysis.fastTrackEligible) return -1;
      if (!a.analysis.fastTrackEligible && b.analysis.fastTrackEligible) return 1;
      const strengthOrder = { strong: 0, moderate: 1, weak: 2 };
      return strengthOrder[a.analysis.strength] - strengthOrder[b.analysis.strength];
    });
}
