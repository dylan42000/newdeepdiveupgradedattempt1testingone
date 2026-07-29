/**
 * LetterReviewScreen.tsx — Letter Approval + Preview UI
 * Full-screen letter review: HTML preview, validation summary, approve/reject/edit actions.
 */

import React, { useState } from 'react';
import DOMPurify from 'dompurify';
import {
  CheckCircle, XCircle, Eye, FileText, Shield,
  AlertTriangle, ChevronDown, ChevronUp, Mail, Edit3
} from 'lucide-react';
import type { GeneratedLetterV2, LetterValidationResult } from '../types/creditRepair';

/** Sanitize letter HTML before dangerouslySetInnerHTML (DOMPurify + script strip). */
function sanitizeLetterHtml(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
    FORBID_ATTR: ['srcdoc'],
  });
}

interface LetterReviewScreenProps {
  letter: GeneratedLetterV2;
  validation: LetterValidationResult | null;
  onApprove: (letterId: string) => void;
  onReject: (letterId: string, reason: string) => void;
  onEdit?: (letterId: string) => void;
  onPrintToPDF?: (letterId: string) => void;
  isSubmitting?: boolean;
}

const PASS_META: Record<number, { label: string; color: string; description: string }> = {
  1: { label: 'Pass 1', color: 'text-blue-400', description: 'Initial accuracy challenge — formal dispute under FCRA §611' },
  2: { label: 'Pass 2', color: 'text-yellow-400', description: 'Method of verification demand — requires written proof of verification' },
  3: { label: 'Pass 3', color: 'text-orange-400', description: 'Procedural violation escalation — pattern of non-compliance cited' },
  4: { label: 'Pass 4', color: 'text-red-400', description: 'Formal intent to file federal complaint — CFPB pre-escalation notice' },
  5: { label: 'Pass 5', color: 'text-purple-400', description: 'Final demand — CFPB complaint pack ready after sending' },
};

export const LetterReviewScreen: React.FC<LetterReviewScreenProps> = ({
  letter,
  validation,
  onApprove,
  onReject,
  onEdit,
  onPrintToPDF,
  isSubmitting = false,
}) => {
  const [showHtml, setShowHtml] = useState(false);
  const [showValidation, setShowValidation] = useState(true);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectInput, setShowRejectInput] = useState(false);

  const passMeta = PASS_META[letter.passNumber] ?? PASS_META[1];
  const hasErrors = validation && !validation.isValid;
  const hasWarnings = validation && validation.warnings.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-start gap-4 p-4 border-b border-gray-800 bg-gray-900/70 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold ${passMeta.color}`}>{passMeta.label}</span>
            <span className="text-sm text-gray-200 truncate">{letter.itemName}</span>
            <StatusBadge status={letter.status} />
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-500">
            <span>{letter.targetName}</span>
            <span>{letter.targetType === 'bureau' ? 'Credit Bureau' : 'Furnisher'}</span>
            <span>{letter.wordCount} words</span>
            <span>Created {new Date(letter.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="text-xs text-gray-600 mt-1">{passMeta.description}</p>
          {/* Strategy / uniqueness / evidence chips */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {letter.primaryAngle && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-900/40 text-indigo-300 border border-indigo-800">
                Angle: {letter.primaryAngle}
              </span>
            )}
            {typeof letter.uniquenessScore === 'number' && (
              <span className={`text-[10px] px-2 py-0.5 rounded border ${
                letter.uniquenessScore >= 70
                  ? 'bg-emerald-900/30 text-emerald-300 border-emerald-800'
                  : letter.uniquenessScore >= 50
                    ? 'bg-yellow-900/30 text-yellow-300 border-yellow-800'
                    : 'bg-red-900/30 text-red-300 border-red-800'
              }`}>
                Uniqueness {letter.uniquenessScore}
              </span>
            )}
            {letter.evidenceTier && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-900/30 text-cyan-300 border border-cyan-800">
                Evidence: {letter.evidenceTier}
              </span>
            )}
            {letter.strategyCardId && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                Strategy {letter.strategyCardId.slice(0, 8)}
              </span>
            )}
          </div>
          {letter.explainWhy && letter.explainWhy.length > 0 && (
            <ul className="mt-2 space-y-0.5 list-disc list-inside">
              {letter.explainWhy.slice(0, 3).map((why, i) => (
                <li key={i} className="text-[11px] text-gray-500">{why}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 flex-shrink-0">
          {onPrintToPDF && (
            <button
              onClick={() => onPrintToPDF(letter.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-blue-400 hover:border-blue-700 transition-colors"
            >
              <FileText className="w-3.5 h-3.5" />
              PDF
            </button>
          )}
          {onEdit && (
            <button
              onClick={() => onEdit(letter.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-yellow-400 hover:border-yellow-700 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Validation panel */}
        {validation && (
          <div className={`rounded-xl border overflow-hidden ${hasErrors ? 'border-red-800 bg-red-950/20' : hasWarnings ? 'border-yellow-800 bg-yellow-950/20' : 'border-green-800 bg-green-950/20'}`}>
            <button
              onClick={() => setShowValidation(v => !v)}
              className="flex items-center justify-between w-full px-4 py-2.5 text-sm"
            >
              <div className="flex items-center gap-2">
                <Shield className={`w-4 h-4 ${hasErrors ? 'text-red-400' : hasWarnings ? 'text-yellow-400' : 'text-green-400'}`} />
                <span className={hasErrors ? 'text-red-300' : hasWarnings ? 'text-yellow-300' : 'text-green-300'}>
                  Validation {hasErrors ? `Failed (${validation.errors.length} errors)` : hasWarnings ? `Passed with warnings` : 'Passed'}
                </span>
              </div>
              {showValidation ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
            </button>

            {showValidation && (
              <div className="px-4 pb-3 space-y-2 border-t border-gray-800/50">
                {validation.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-red-400">
                    <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {err}
                  </div>
                ))}
                {validation.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-yellow-400">
                    <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
                {!hasErrors && !hasWarnings && (
                  <p className="text-xs text-green-400 flex items-center gap-2">
                    <CheckCircle className="w-3.5 h-3.5" />
                    All checks passed — letter meets court-ready standards
                  </p>
                )}

                <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-500">
                  <div>
                    <p className="text-gray-600">Consumer</p>
                    <p className="text-gray-400">{validation.consumerInfo.name}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Target</p>
                    <p className="text-gray-400">{validation.targetInfo.name}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Account</p>
                    <p className="text-gray-400">{validation.accountDetails.name}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Legal citations */}
        {letter.legalCitations.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-cyan-600" />
              Legal Citations
            </p>
            <div className="flex flex-wrap gap-1.5">
              {letter.legalCitations.map((cite, i) => (
                <span key={i} className="text-xs text-cyan-500 bg-cyan-900/20 border border-cyan-900 px-2 py-0.5 rounded">
                  {cite}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Letter content */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800">
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4 text-cyan-400" />
              <span className="text-sm text-gray-200 font-medium">Letter Content</span>
            </div>
            <button
              onClick={() => setShowHtml(h => !h)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300"
            >
              <Eye className="w-3.5 h-3.5" />
              {showHtml ? 'Plain text' : 'HTML preview'}
            </button>
          </div>
          <div className="p-4">
            {showHtml ? (
              <div
                className="prose prose-sm prose-invert max-w-none text-xs"
                dangerouslySetInnerHTML={{ __html: sanitizeLetterHtml(letter.htmlContent || '') }}
              />
            ) : (
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono leading-relaxed">
                {letter.letterContent}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Action bar */}
      {letter.status === 'draft' && (
        <div className="flex items-center gap-3 p-4 border-t border-gray-800 bg-gray-900/70 flex-shrink-0">
          {showRejectInput ? (
            <div className="flex flex-1 items-center gap-2">
              <input
                autoFocus
                type="text"
                placeholder="Reason for rejection (optional)"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-gray-700 bg-gray-900 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-red-700"
                onKeyDown={e => {
                  if (e.key === 'Enter') { onReject(letter.id, rejectReason); }
                  if (e.key === 'Escape') { setShowRejectInput(false); }
                }}
              />
              <button
                onClick={() => onReject(letter.id, rejectReason)}
                className="text-xs px-3 py-1.5 bg-red-900/50 text-red-400 border border-red-800 rounded-lg hover:bg-red-900 transition-colors"
              >
                Confirm Reject
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                className="text-xs text-gray-500 hover:text-gray-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded-lg border border-red-900 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-50"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
              <div className="flex-1" />
              <button
                onClick={() => onApprove(letter.id)}
                disabled={isSubmitting || (hasErrors ?? false)}
                className={`flex items-center gap-1.5 text-sm font-medium px-6 py-2 rounded-lg transition-colors ${
                  hasErrors
                    ? 'bg-gray-800 text-gray-600 cursor-not-allowed'
                    : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                } disabled:opacity-50`}
              >
                <CheckCircle className="w-4 h-4" />
                {isSubmitting ? 'Approving...' : 'Approve & Queue for Send'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const cfgs: Record<string, string> = {
    draft: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
    approved: 'text-green-400 bg-green-900/30 border-green-800',
    sent: 'text-blue-400 bg-blue-900/30 border-blue-800',
    archived: 'text-gray-400 bg-gray-800/30 border-gray-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded border capitalize ${cfgs[status] ?? cfgs.draft}`}>
      {status}
    </span>
  );
};
