// ============================================================
// index.ts — GOLDEN TICKET PARSER ORCHESTRATOR v5.0
// Detection engine: creditParser.ts
// PDF / text extraction: extractor.ts (Y-coord line grouping)
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import type { NegativeItem } from '../../types';
import {
  normalizeText,
  extractTextFromPDF,
  extractConsumerInfo,
  detectBureaus,
  calcAutoRemovalDate,
} from './extractor';
import {
  parseNegativeItems,
  type NegativeItem as ParsedNegativeItem,
} from './creditParser';
import { normalizeTransUnionText } from './bureauNormalizers/transunionNormalizer';
import { runAutoMerge } from '../accountMergeEngine/autoMergeOrchestrator';
import type { MergeCandidate } from '../accountMergeEngine/mergeSimilarityEngine';
import {
  enhanceWithMetro2Compliance,
  getMetro2ComplianceSummary,
} from './metro2ComplianceAnalyzer';

// ── PUBLIC INTERFACE ──────────────────────────────────────────
export interface ParseOptions {
  source: 'pdf_buffer' | 'paste' | 'file_path';
  pdfBuffer?: ArrayBuffer;
  pasteText?: string;
  filePath?: string;
  onProgress?: (pct: number, msg: string) => void;
}

export interface ParseResult {
  success: boolean;
  items: NegativeItem[];
  consumerName: string;
  totalFound: number;
  needsReviewCount: number;
  warnings: string[];
  parseMethod: 'ai_full' | 'ai_partial_heuristic' | 'heuristic_only';
  rawTextPreview: string;
  processingTimeMs: number;
  debugInfo: {
    heuristicFound: number;
    aiFound: number;
    finalCount: number;
    detectedBureaus: string[];
    metro2ComplianceScore?: number;
    metro2Violations?: number;
  };
  pendingSuggestedMerges: MergeCandidate[];
  pendingManualReviewMerges: MergeCandidate[];
  // NEW: Metro2 + cross-bureau compliance data
  metro2Report?: {
    complianceScore: number;
    violations: any[];
    crossBureauComparisons: any[];
  };
}

// Backward-compat alias for files that import ParseCreditReportResult
export type ParseCreditReportResult = ParseResult;

// ── TRANSUNION PDF LINEARIZATION FIX ──────────────────────────
export function preprocessTransUnionText(rawText: string): string {
  let cleanText = rawText;

  // Fix 1: Break smashed account titles away from "Total Months" footers
  cleanText = cleanText.replace(
    /(Total Months:\s*\d+)\s+([A-Z0-9\s\/&.,\-\u0370-\u03FF]+?\s+\d+[Xx*\d]*)/g,
    '$1\n\n$2'
  );

  // Fix 2: Break smashed account titles away from trailing history ratings
  cleanText = cleanText.replace(
    /(Rating\s+[A-Z0-9\/+|☑|☐|\s]+)\s+([A-Z0-9\s\/&.,\-\u0370-\u03FF]+?\s+\d+[Xx*\d]*)/g,
    '$1\n\n$2'
  );

  // Fix 3: The "Vertical Pipe" Repair
  const lines = cleanText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) {
      lines[i] = lines[i].replace('|', '').trim();
    }
  }
  cleanText = lines.join('\n');

  // Fix 4: Ensure fully unmasked account numbers get asterisks so the parser recognizes them
  cleanText = cleanText.replace(/([A-Z0-9\s\/&.,\-]+?\s+\d{5,})\nAccount Information/g, (match, p1) => {
    if (!p1.includes('*') && !p1.toLowerCase().includes('account')) {
      return p1.trim() + '****\nAccount Information';
    }
    return match;
  });

  return cleanText;
}

// ── GOLDEN PARSER — BALANCE STRING TO NUMBER ─────────────────
function parseBalanceToNumber(balanceStr: string): number | null {
  if (!balanceStr || balanceStr === 'Not listed') return null;
  const cleaned = balanceStr.replace(/[^0-9.\-]/g, '');
  const num = parseFloat(cleaned);
  // Accept $0 (paid/settled) — only reject non-finite
  return Number.isFinite(num) && num >= 0 ? num : null;
}

// ── GOLDEN PARSER — MAP TO APP NegativeItem ───────────────────
function mapParsedToNegativeItem(g: ParsedNegativeItem): NegativeItem {
  // Never invent a bureau — Unknown stays empty so UI can force review
  const creditBureau: NegativeItem['creditBureau'] =
    g.bureau === 'Unknown' ? [] : [g.bureau];

  const openDate = g.dateOpened === 'Not listed' ? null : g.dateOpened;
  const dofd =
    g.dateOfFirstDelinquency && g.dateOfFirstDelinquency !== 'Not listed'
      ? g.dateOfFirstDelinquency
      : null;

  return {
    id: uuidv4(),
    creditorName: g.creditor,
    accountNumber: g.accountNumber === 'Not listed' ? '' : g.accountNumber,
    balance: parseBalanceToNumber(g.balance),
    originalBalance: parseBalanceToNumber(g.balance),
    creditLimit: null,
    typeOfNegative: g.category,
    status: g.status === 'Not listed' ? g.category : g.status,
    accountType: null,
    paymentHistory: null,
    // DOFD is explicit when supplied; EX/TU may use the report's stated
    // removal date minus seven years as a transparent parser fallback.
    originalDateOfDelinquency: dofd,
    dateOfFirstDelinquency: dofd,
    dateOfLastReporting: g.lastReported === 'Not listed' ? null : g.lastReported,
    originalOpeningDate: openDate,
    dateOpened: openDate,
    dateClosed: null,
    dateLastActive: g.lastReported === 'Not listed' ? null : g.lastReported,
    autoRemovalDate: calcAutoRemovalDate(dofd),
    solDropDate: null,
    creditBureau,
    crossBureauGroupId: null,
    fullAccountNumber: null,
    furnisher: g.creditor,
    originalCreditor: null,
    parseConfidence: g.confidence / 100,
    additionalInfo: g.rawSnippet,
    disputeRound: 1,
    disputeStatus: 'Undisputed',
    lastDisputeDate: null,
    disputeDeadline: null,
    priorityScore: Math.round(g.confidence),
    estimatedScoreImpact: null,
    notes: [],
    forceStrategy: 'default',
    goodwillEligible: false,
    p4dEligible: false,
    solPaused: false,
    doubleVerified: false,
    verificationCount: 0,
    disputeContactPhone: null,
    disputeContactAddress: null,
    dataSource: 'parser',
    accuracyConfirmedByUser: false,
    accuracyConfirmedAt: null,
    accuracyConfirmationNote: null,
  };
}

// ── MAIN ENTRY POINT ──────────────────────────────────────────
export async function parseCreditReport(options: ParseOptions): Promise<ParseResult> {
  const startTime = Date.now();
  const warnings: string[] = [];
  const { onProgress } = options;

  const progress = (pct: number, msg: string) => {
    console.log(`[Parser ${pct}%] ${msg}`);
    onProgress?.(pct, msg);
  };

  // ── STEP 1: ACQUIRE TEXT ─────────────────────────────────────
  progress(5, 'Acquiring report text...');
  let rawText = '';

  try {
    if (options.source === 'pdf_buffer' && options.pdfBuffer) {
      rawText = await extractTextFromPDF(options.pdfBuffer);
    } else if (options.source === 'paste' && options.pasteText) {
      rawText = options.pasteText;
    } else if (options.source === 'file_path' && options.filePath) {
      const electronAPI = (window as any).electronAPI;
      if (electronAPI?.readFile) {
        const content = await electronAPI.readFile(options.filePath);
        rawText = typeof content === 'string' ? content : new TextDecoder().decode(content);
      } else {
        throw new Error('File path source requires Electron API');
      }
    } else {
      throw new Error('No valid input source provided');
    }
  } catch (err) {
    warnings.push(`Text acquisition error: ${err}`);
    return {
      success: false, items: [], consumerName: '', totalFound: 0,
      needsReviewCount: 0, warnings, parseMethod: 'heuristic_only',
      rawTextPreview: '', processingTimeMs: Date.now() - startTime,
      debugInfo: { heuristicFound: 0, aiFound: 0, finalCount: 0, detectedBureaus: [] }, pendingSuggestedMerges: [], pendingManualReviewMerges: [],
    };
  }

  if (!rawText || rawText.trim().length < 50) {
    return {
      success: false, items: [], consumerName: '', totalFound: 0,
      needsReviewCount: 0, warnings: ['No text could be extracted from the provided source'],
      parseMethod: 'heuristic_only', rawTextPreview: rawText.slice(0, 500),
      processingTimeMs: Date.now() - startTime,
      debugInfo: { heuristicFound: 0, aiFound: 0, finalCount: 0, detectedBureaus: [] }, pendingSuggestedMerges: [], pendingManualReviewMerges: [],
    };
  }

  // ── STEP 2: NORMALIZE ─────────────────────────────────────────
  progress(20, 'Normalizing text...');
  let normalizedText = normalizeText(rawText);

  // ── STEP 3: IDENTIFY CONSUMER + BUREAUS ──────────────────────
  progress(35, 'Identifying consumer and bureaus...');
  const consumerInfo = extractConsumerInfo(normalizedText);
  const detectedBureaus = detectBureaus(normalizedText);

  console.log('[Parser] Consumer:', consumerInfo.fullName || 'Not detected');
  console.log('[Parser] Bureaus detected:', detectedBureaus.join(', '));

  // ── STEP 3b: BUREAU-SPECIFIC NORMALIZATION ────────────────────
  // AnnualCreditReport.com reports contain ALL THREE bureaus in one document.
  // We must preprocess for TransUnion regardless of which bureau is listed first.
  // The old code only ran TU normalization if TransUnion was detectedBureaus[0],
  // which meant in a 3-bureau report starting with Equifax, TU accounts were never normalized.
  const isMultiBureau = detectedBureaus.length >= 2;
  const hasTransUnion = detectedBureaus.includes('TransUnion') || detectedBureaus.includes('transunion');

  if (hasTransUnion) {
    // Always run TU preprocessing when TU is detected (or for multi-bureau reports)
    // The preprocessor is safe to run on all bureau data — it only modifies TU-specific artifacts
    normalizedText = preprocessTransUnionText(normalizedText);
    normalizedText = normalizeTransUnionText(normalizedText);
    console.log('[Parser] Applied TransUnion normalization (multi-bureau or TU detected)');
  }

  console.log('[Parser] Multi-bureau report:', isMultiBureau, '| All bureaus:', detectedBureaus.join(', '));

  // ── STEP 4: GOLDEN PARSER DETECTION ──────────────────────────
  progress(55, 'Detecting negative items...');
  const parsedItems = parseNegativeItems([
    { sourceName: 'report', text: normalizedText },
  ]);

  console.log(`[Parser] Credit parser found ${parsedItems.length} negative items`);

  // ── STEP 5: MAP TO APP NegativeItem ──────────────────────────
  progress(85, 'Mapping results...');
  const mappedItems = parsedItems.map(mapParsedToNegativeItem);

  // ── STEP 5b: METRO 2 COMPLIANCE + CROSS-BUREAU ACCOUNT MERGE UPGRADE ─────
  progress(90, 'Running Metro 2 compliance & cross-bureau reconciliation...');
  const { enhancedItems, metro2Report } = enhanceWithMetro2Compliance(mappedItems, normalizedText);

  // Run the existing high-quality auto merge (now with enhanced data)
  const mergeResult = runAutoMerge(enhancedItems);

  // Final items use the auto-merged primary + any Metro2 reconciled fields
  let items = mergeResult.mergedGroups.map(group => {
    const p = group.primary;
    // Prefer Metro2 reconciled account number if richer
    if (group.bestAccountNumber && group.bestAccountNumber.length > (p.fullAccountNumber || p.accountNumber || '').length) {
      p.fullAccountNumber = group.bestAccountNumber;
      p.accountNumber = group.bestAccountNumber;
    }
    return p;
  });

  // Final pass: ensure account numbers are reconstructed using reconstructor
  items = items.map(item => {
    if (!item.fullAccountNumber && item.accountNumber) {
      // lightweight reconstruction
      const normalized = item.accountNumber.replace(/[^0-9X*]/g, '');
      if (normalized.length >= 4) {
        item.fullAccountNumber = normalized;
      }
    }
    return item;
  });

  const needsReviewCount = items.filter(i => (i.parseConfidence ?? 1) < 0.60).length;

  // Append Metro2 summary to warnings if issues
  const metro2Summary = getMetro2ComplianceSummary(items);
  if (metro2Report.violations.length > 0) {
    warnings.push(`Metro 2 compliance: ${metro2Summary}`);
  }

  progress(100, `Complete! Found ${items.length} negative item${items.length !== 1 ? 's' : ''} (Metro2 score: ${metro2Report.complianceScore})`);

  return {
    success: mappedItems.length > 0,
    items,
    consumerName: consumerInfo.fullName,
    totalFound: items.length,
    needsReviewCount,
    warnings,
    parseMethod: 'heuristic_only',
    rawTextPreview: normalizedText.slice(0, 2000),
    processingTimeMs: Date.now() - startTime,
    debugInfo: {
      heuristicFound: parsedItems.length,
      aiFound: 0,
      finalCount: items.length,
      detectedBureaus: detectedBureaus,
      metro2ComplianceScore: metro2Report.complianceScore,
      metro2Violations: metro2Report.violations.length,
    },
    pendingSuggestedMerges: mergeResult.suggestedMerges,
    pendingManualReviewMerges: mergeResult.manualReviewItems,
    // Metro2 data available on items + via debug
    metro2Report: metro2Report,
  } as any;
}
