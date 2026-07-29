/**
 * MergedAccountCard.tsx — Cross-Bureau Account Number Merge Display
 *
 * Issue 2: Displays the recovered account digits, confidence score,
 * bureau source breakdowns, and any Metro 2 discrepancy flags for a
 * single merged account group.
 *
 * Green digits = confirmed from at least one bureau.
 * ● (gray bullet) = unknown/masked position.
 */

import React from 'react';
import type { MergedAccountResult } from '../services/accountMergeEngine';
import { normalizeAccountNumber } from '../services/accountMergeEngine';

// ─── Confidence badge ─────────────────────────────────────────────────────────

interface ConfidenceBadgeProps {
  score: number;
}

const ConfidenceBadge: React.FC<ConfidenceBadgeProps> = ({ score }) => {
  let colorClass: string;
  let label: string;

  if (score >= 80) {
    colorClass = 'bg-green-100 text-green-700 border-green-300';
    label = 'HIGH';
  } else if (score >= 50) {
    colorClass = 'bg-yellow-100 text-yellow-700 border-yellow-300';
    label = 'MED';
  } else {
    colorClass = 'bg-red-100 text-red-600 border-red-300';
    label = 'LOW';
  }

  return (
    <span
      className={`text-xs font-bold border px-2 py-0.5 rounded ${colorClass}`}
      title={`Merge confidence: ${score}%`}
    >
      {score}% {label}
    </span>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────

interface MergedAccountCardProps {
  result: MergedAccountResult;
  className?: string;
}

const MergedAccountCard: React.FC<MergedAccountCardProps> = ({ result, className = '' }) => {
  const digits = result.revealedDigits.split('');

  const digitDisplay = digits.map((char, i) => (
    <span
      key={i}
      className={
        char !== '*'
          ? 'text-green-600 font-bold'   // Known digit — green
          : 'text-gray-400'              // Unknown — gray bullet
      }
    >
      {char === '*' ? '●' : char}
    </span>
  ));

  return (
    <div className={`border rounded-lg p-4 bg-white shadow-sm ${className}`}>
      {/* Header row: creditor name + confidence badge */}
      <div className="flex justify-between items-center mb-2">
        <span className="font-semibold text-gray-800 text-sm truncate mr-2">
          {result.sources[0]?.creditorName ?? 'Unknown Account'}
        </span>
        <ConfidenceBadge score={result.confidenceScore} />
      </div>

      {/* Digit reconstruction display */}
      <div className="font-mono text-lg tracking-widest my-2 select-all">
        {digitDisplay}
      </div>

      {/* Digit recovery stats */}
      <div className="text-xs text-gray-500 mb-2">
        {result.knownDigitCount} / {result.totalDigits} digits recovered
        {' from '}
        {result.sources.length} bureau{result.sources.length !== 1 ? 's' : ''}
        {' · '}
        Match method: {result.matchMethod}
      </div>

      {/* Bureau source chips */}
      <div className="flex flex-wrap gap-1 mb-2">
        {result.sources.map((s, i) => (
          <span
            key={`${s.bureau}-${i}`}
            className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded border border-blue-200"
            title={`Raw: ${s.rawAccountNumber}`}
          >
            {s.bureau}: {normalizeAccountNumber(s.rawAccountNumber)}
          </span>
        ))}
      </div>

      {/* Cross-bureau discrepancies (non-Metro 2) */}
      {result.discrepancies.length > 0 && (
        <div className="mt-2 space-y-1">
          {result.discrepancies.map((d, i) => (
            <div
              key={i}
              className="text-xs bg-orange-50 border border-orange-200 text-orange-700 rounded px-2 py-1"
            >
              ⚡ {d}
            </div>
          ))}
        </div>
      )}

      {/* Metro 2 discrepancy flags */}
      {result.metro2Flags.length > 0 && (
        <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 space-y-1">
          <p className="text-xs font-semibold text-amber-700">
            ⚠️ Metro 2 Discrepancies ({result.metro2Flags.length}):
          </p>
          {result.metro2Flags.map((f, i) => (
            <div key={i} className="text-xs text-amber-700">
              <span
                className={`font-bold mr-1 ${
                  f.severity === 'CRITICAL' ? 'text-red-600' : 'text-amber-600'
                }`}
              >
                [{f.severity}]
              </span>
              {f.description}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MergedAccountCard;
