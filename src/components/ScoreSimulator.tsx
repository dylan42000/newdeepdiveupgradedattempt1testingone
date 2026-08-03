/**
 * Score Simulator Component
 * "What If" FICO score projector — shows predicted score improvement
 * if selected negative items are removed from the credit report.
 *
 * Uses a rule-based model approximating FICO 8 / VantageScore 3.0 weights.
 */

import React, { useState, useMemo } from 'react';
import type { NegativeItem } from '../types';

// ─── FICO Weight Model ─────────────────────────────────────────────────────────

interface FICOFactorWeights {
  paymentHistory: number;        // 35%
  utilization: number;           // 30%
  lengthOfHistory: number;       // 15%
  creditMix: number;             // 10%
  newCredit: number;             // 10%
}

// Rough score impact per item type (negative impact on 300-850 scale)
const ITEM_SCORE_IMPACTS: Record<string, number> = {
  collection:           45,
  charge_off:           50,
  bankruptcy:          100,
  foreclosure:          85,
  repossession:         75,
  late_payment_90:      35,
  late_payment_60:      20,
  late_payment_30:      15,
  judgment:             65,
  tax_lien:             70,
  settled:              25,
  default:              55,
  derogatory:           30,
};

function estimateItemImpact(item: NegativeItem): number {
  const type = (item.typeOfNegative ?? item.accountType ?? '').toLowerCase();
  for (const [key, impact] of Object.entries(ITEM_SCORE_IMPACTS)) {
    if (type.includes(key.replace(/_/g, ' ')) || type.includes(key)) {
      // Decay: items older than 4 years have reduced impact
      if (item.originalDateOfDelinquency) {
        const yearsOld = (Date.now() - new Date(item.originalDateOfDelinquency).getTime()) / (1000 * 60 * 60 * 24 * 365);
        const ageFactor = yearsOld > 4 ? 0.5 : yearsOld > 2 ? 0.75 : 1.0;
        return Math.round(impact * ageFactor);
      }
      return impact;
    }
  }
  return 25; // default derogatory impact
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface ScoreSimulatorProps {
  negativeItems: NegativeItem[];
  currentScores?: {
    equifax?: number;
    experian?: number;
    transunion?: number;
  };
}

interface BureauScore {
  bureau: string;
  current: number;
  projected: number;
  gain: number;
}

const BUREAU_COLORS: Record<string, string> = {
  Equifax: '#d62b2b',
  Experian: '#003da5',
  TransUnion: '#009fdb',
};

export default function ScoreSimulator({ negativeItems, currentScores }: ScoreSimulatorProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'simulator' | 'breakdown'>('simulator');

  // Default scores if none provided
  const baseScores = {
    equifax: currentScores?.equifax ?? 580,
    experian: currentScores?.experian ?? 580,
    transunion: currentScores?.transunion ?? 580,
  };

  // Which bureaus report each item
  const bureauItems = useMemo(() => {
    const bureauMap: Record<string, NegativeItem[]> = {
      Equifax: [], Experian: [], TransUnion: [],
    };
    for (const item of negativeItems) {
      const bureaus = item.creditBureau ?? [];
      for (const bureau of ['Equifax', 'Experian', 'TransUnion']) {
        if (bureaus.some(b => b.toLowerCase().includes(bureau.toLowerCase()))) {
          bureauMap[bureau].push(item);
        }
      }
    }
    return bureauMap;
  }, [negativeItems]);

  // Calculate projected scores
  const bureauScores = useMemo((): BureauScore[] => {
    return ['Equifax', 'Experian', 'TransUnion'].map(bureau => {
      const current = baseScores[bureau.toLowerCase() as keyof typeof baseScores] ?? 580;
      const itemsOnBureau = bureauItems[bureau] ?? [];
      const selectedOnBureau = itemsOnBureau.filter(i => selectedIds.has(i.id));
      const gain = selectedOnBureau.reduce((sum, item) => sum + estimateItemImpact(item), 0);
      const projected = Math.min(850, current + gain);
      return { bureau, current, projected, gain };
    });
  }, [selectedIds, bureauItems, baseScores]);

  const totalGain = Math.round(bureauScores.reduce((s, b) => s + b.gain, 0) / 3);
  const avgProjected = Math.round(bureauScores.reduce((s, b) => s + b.projected, 0) / 3);

  function toggleItem(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelectedIds(new Set(negativeItems.map(i => i.id)));
  }

  function clearAll() {
    setSelectedIds(new Set());
  }

  function getScoreLabel(score: number): { label: string; color: string } {
    if (score >= 740) return { label: 'Excellent', color: 'text-emerald-400' };
    if (score >= 670) return { label: 'Good', color: 'text-green-400' };
    if (score >= 580) return { label: 'Fair', color: 'text-yellow-400' };
    if (score >= 500) return { label: 'Poor', color: 'text-orange-400' };
    return { label: 'Bad', color: 'text-red-400' };
  }

  function scoreBarWidth(score: number): string {
    // 300-850 scale → 0-100%
    return `${Math.round(((score - 300) / 550) * 100)}%`;
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-white">Score Simulator</h2>
          <p className="text-xs text-gray-400">Select items to see projected score improvement</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-emerald-400">+{totalGain}</div>
          <div className="text-xs text-gray-400">avg pts gain</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-gray-700">
        {(['simulator', 'breakdown'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'simulator' && (
        <>
          {/* Bureau Score Bars */}
          <div className="space-y-3 mb-4">
            {bureauScores.map(({ bureau, current, projected, gain }) => {
              const { label, color } = getScoreLabel(projected);
              return (
                <div key={bureau} className="bg-gray-800 rounded-lg p-3">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold" style={{ color: BUREAU_COLORS[bureau] }}>
                      {bureau}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-gray-500 text-sm line-through">{current}</span>
                      <span className={`text-lg font-bold ${color}`}>{projected}</span>
                      {gain > 0 && (
                        <span className="text-xs bg-emerald-900/50 text-emerald-400 px-1.5 py-0.5 rounded">
                          +{gain}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Progress bar — current */}
                  <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="absolute h-2 rounded-full bg-gray-500 transition-all duration-500"
                      style={{ width: scoreBarWidth(current) }}
                    />
                    <div
                      className="absolute h-2 rounded-full bg-emerald-500 opacity-70 transition-all duration-700"
                      style={{ width: scoreBarWidth(projected) }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-600 mt-0.5">
                    <span>300</span>
                    <span className={`text-xs ${color}`}>{label}</span>
                    <span>850</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Summary card */}
          {selectedIds.size > 0 && (
            <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-lg p-3 mb-4 text-center">
              <div className="text-3xl font-bold text-emerald-400 mb-0.5">{avgProjected}</div>
              <div className="text-xs text-gray-400">
                Projected average score (+{totalGain} pts) after removing {selectedIds.size} item{selectedIds.size !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-gray-600 mt-1">
                * Estimate based on FICO 8 weight model. Actual results vary.
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'breakdown' && (
        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {negativeItems.map(item => {
            const impact = estimateItemImpact(item);
            const isSelected = selectedIds.has(item.id);
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-emerald-900/30 border border-emerald-700/40' : 'bg-gray-800 border border-transparent hover:border-gray-600'
                }`}
                onClick={() => toggleItem(item.id)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                    isSelected ? 'bg-emerald-600 border-emerald-600' : 'border-gray-600'
                  }`}>
                    {isSelected && <span className="text-white text-xs">✓</span>}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-white truncate">
                      {item.creditorName ?? item.accountType ?? 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {item.typeOfNegative} · {item.creditBureau?.join(', ')}
                    </div>
                  </div>
                </div>
                <div className={`text-sm font-bold ml-2 flex-shrink-0 ${isSelected ? 'text-emerald-400' : 'text-gray-400'}`}>
                  {isSelected ? '+' : ''}{impact} pts
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2 mt-2">
        <button
          onClick={selectAll}
          className="flex-1 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          Select All ({negativeItems.length})
        </button>
        <button
          onClick={clearAll}
          className="flex-1 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
