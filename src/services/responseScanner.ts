// src/services/responseScanner.ts
// Camera-based response letter scanning + AI analysis (Android only)

import { registerPlugin } from '@capacitor/core';
import type { AndroidArchiveService, ResponseMetadata } from './platform/androidArchiveService';

interface CameraResponseInterface {
  scanResponseLetter(): Promise<{
    imageBase64: string;
    mimeType: string;
    width: number;
    height: number;
    sizeBytes: number;
  }>;
}

const CameraNative = registerPlugin<CameraResponseInterface>('CameraResponse');

export interface ResponseAnalysisResult {
  bureauName: string;
  outcome: 'verified' | 'deleted' | 'updated' | 'no_action';
  accountName: string;
  reasonGiven: string;
  letterDate: string;
  fcraLanguage: string;
  confidence: number;
  rawText: string;
  nextAction: string;
  escalationLevel: 'none' | 'follow_up' | 'escalate_cfpb' | 'escalate_legal';
}

interface AIRouter {
  analyzeImage(options: {
    imageBase64: string;
    mimeType: string;
    prompt: string;
  }): Promise<{ text: string }>;
}

const OUTCOME_PATTERNS: Array<{ outcome: ResponseAnalysisResult['outcome']; patterns: RegExp[] }> = [
  {
    outcome: 'deleted',
    patterns: [
      /\bdelete(?:d|ion)?\b/i,
      /\bremoved\b/i,
      /\bno longer appears\b/i,
    ],
  },
  {
    outcome: 'updated',
    patterns: [
      /\bupdate(?:d)?\b/i,
      /\bmodified\b/i,
      /\bcorrected\b/i,
    ],
  },
  {
    outcome: 'verified',
    patterns: [
      /\bverified\b/i,
      /\baccurate\b/i,
      /\bremains\b/i,
      /\bcontinue to report\b/i,
    ],
  },
];

function normalizeBureauName(input: string): string {
  const value = (input || '').toLowerCase();
  if (value.includes('equifax')) return 'Equifax';
  if (value.includes('experian')) return 'Experian';
  if (value.includes('transunion') || value.includes('trans union')) return 'TransUnion';
  return input || 'Unknown';
}

function normalizeOutcome(input: string, rawText: string): ResponseAnalysisResult['outcome'] {
  const normalized = (input || '').toLowerCase();
  if (normalized === 'deleted' || normalized === 'updated' || normalized === 'verified' || normalized === 'no_action') {
    return normalized;
  }

  for (const candidate of OUTCOME_PATTERNS) {
    if (candidate.patterns.some((pattern) => pattern.test(rawText))) {
      return candidate.outcome;
    }
  }

  return 'no_action';
}

function normalizeIsoDate(input: string): string {
  const text = (input || '').trim();
  if (!text) return new Date().toISOString().slice(0, 10);

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString().slice(0, 10);
  }

  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (us) {
    const month = us[1].padStart(2, '0');
    const day = us[2].padStart(2, '0');
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${month}-${day}`;
  }

  return new Date().toISOString().slice(0, 10);
}

function determineAction(
  outcome: ResponseAnalysisResult['outcome'],
  fcraLanguage: string,
): { nextAction: string; escalationLevel: ResponseAnalysisResult['escalationLevel'] } {
  const fcraText = (fcraLanguage || '').toLowerCase();
  const referencesNoResponse = fcraText.includes('30 day') || fcraText.includes('thirty day');

  if (outcome === 'deleted') {
    return {
      nextAction: 'Mark item resolved and monitor for reinsertion over the next 120 days.',
      escalationLevel: 'none',
    };
  }

  if (outcome === 'updated') {
    return {
      nextAction: 'Review update details. If still inaccurate, queue next-round dispute with updated evidence.',
      escalationLevel: 'follow_up',
    };
  }

  if (outcome === 'verified') {
    if (referencesNoResponse) {
      return {
        nextAction: 'Escalate with FCRA 30-day noncompliance argument and CFPB-ready documentation.',
        escalationLevel: 'escalate_cfpb',
      };
    }

    return {
      nextAction: 'Move to next dispute pass with a new angle and stronger documentary exhibits.',
      escalationLevel: 'follow_up',
    };
  }

  return {
    nextAction: 'Manual review required. Outcome is unclear from scanned response.',
    escalationLevel: 'follow_up',
  };
}

function sanitizeAiJson(text: string): string {
  return (text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

export class ResponseScanner {
  constructor(private aiRouter: AIRouter) {}

  async scanAndAnalyze(
    profileId: string,
    relatedItemId: string,
    archiveService: AndroidArchiveService
  ): Promise<ResponseAnalysisResult> {
    // Step 1: Capture image via native camera
    const photo = await CameraNative.scanResponseLetter();

    // Step 2: Convert base64 to ArrayBuffer for archive
    const imageBytes = Uint8Array.from(
      atob(photo.imageBase64), c => c.charCodeAt(0)
    ).buffer;

    // Step 3: AI analysis of scanned letter
    const analysisPrompt = `
You are a credit repair expert analyzing a scanned bureau response letter.
Extract the following information from this letter image:
1. Bureau name (Equifax, Experian, or TransUnion)
2. Response outcome: "verified", "deleted", "updated", or "no_action"
3. Account name mentioned
4. Any specific reason given for the outcome
5. Date of the letter
6. Any FCRA-specific language used

Respond in JSON format:
{
  "bureauName": "...",
  "outcome": "verified|deleted|updated|no_action",
  "accountName": "...",
  "reasonGiven": "...",
  "letterDate": "YYYY-MM-DD",
  "fcraLanguage": "...",
  "confidence": 0.0-1.0,
  "rawText": "..."
}
`;

    const analysis = await this.aiRouter.analyzeImage({
      imageBase64: photo.imageBase64,
      mimeType: photo.mimeType,
      prompt: analysisPrompt,
    });

    let parsed: Omit<ResponseAnalysisResult, 'nextAction' | 'escalationLevel'>;
    try {
      parsed = JSON.parse(sanitizeAiJson(analysis.text));
    } catch {
      throw new Error('AI could not parse the response letter — please try scanning again');
    }

    const normalizedOutcome = normalizeOutcome(parsed.outcome, parsed.rawText || '');
    const normalizedDate = normalizeIsoDate(parsed.letterDate);
    const actionPlan = determineAction(normalizedOutcome, parsed.fcraLanguage || '');

    const normalizedResult: ResponseAnalysisResult = {
      ...parsed,
      bureauName: normalizeBureauName(parsed.bureauName),
      outcome: normalizedOutcome,
      letterDate: normalizedDate,
      confidence: Number.isFinite(parsed.confidence) ? parsed.confidence : 0.5,
      nextAction: actionPlan.nextAction,
      escalationLevel: actionPlan.escalationLevel,
    };

    // Step 4: Archive the scanned image
    const metadata: ResponseMetadata = {
      dateReceived: normalizedResult.letterDate ? new Date(normalizedResult.letterDate) : new Date(),
      sourceType: 'bureau',
      sourceName: normalizedResult.bureauName,
      relatedItemId,
      relatedCycleId: '',
      relatedPassNumber: 0,
      outcome: normalizedResult.outcome,
      aiAnalysis: JSON.stringify(normalizedResult),
    };

    await archiveService.storeResponse(profileId, imageBytes, metadata);

    return normalizedResult;
  }
}

export function classifyResponseFromRawText(rawText: string): {
  outcome: ResponseAnalysisResult['outcome'];
  nextAction: string;
  escalationLevel: ResponseAnalysisResult['escalationLevel'];
} {
  const outcome = normalizeOutcome('', rawText || '');
  const action = determineAction(outcome, rawText || '');

  return {
    outcome,
    nextAction: action.nextAction,
    escalationLevel: action.escalationLevel,
  };
}
