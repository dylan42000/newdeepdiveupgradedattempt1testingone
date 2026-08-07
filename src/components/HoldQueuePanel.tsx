/**
 * HoldQueuePanel.tsx — Hold Queue Status Panel
 * Shows all items currently in hold with days remaining and pass that triggered hold.
 */

import React from 'react';
import { Clock, Lock, Calendar } from 'lucide-react';
import { HoldQueueEntry, PassNumber } from '../types/creditRepair';

interface HoldQueuePanelProps {
  profileId: string;
  entries: HoldQueueEntry[];
  onOverrideHold?: (itemId: string) => void;
}

const PASS_COLORS: Record<PassNumber, string> = {
  1: 'text-blue-400 bg-blue-900/30 border-blue-800',
  2: 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  3: 'text-orange-400 bg-orange-900/30 border-orange-800',
  4: 'text-red-400 bg-red-900/30 border-red-800',
  5: 'text-purple-400 bg-purple-900/30 border-purple-800',
  6: 'text-rose-400 bg-rose-900/30 border-rose-800',
};

export const HoldQueuePanel: React.FC<HoldQueuePanelProps> = ({
  entries,
  onOverrideHold,
}) => {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 text-center">
        <Lock className="w-8 h-8 text-gray-600 mx-auto mb-2" />
        <p className="text-gray-500 text-sm">No items currently on hold</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <Lock className="w-4 h-4 text-yellow-400" />
        <span className="text-sm font-medium text-gray-200">Hold Queue</span>
        <span className="ml-auto text-xs text-gray-500">{entries.length} items</span>
      </div>

      <div className="divide-y divide-gray-800/50">
        {entries.map(entry => {
          const today = new Date();
          const expiry = new Date(entry.holdExpiryDate);
          const daysRemaining = Math.max(0, Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
          const holdDaysTotal = Math.ceil(
            (new Date(entry.holdExpiryDate).getTime() - new Date(entry.holdStartDate).getTime()) / (1000 * 60 * 60 * 24)
          );
          const progress = Math.max(0, 100 - (daysRemaining / holdDaysTotal) * 100);
          const passColor = PASS_COLORS[entry.passNumber] ?? PASS_COLORS[1];

          return (
            <div key={entry.itemId} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm text-gray-200 font-medium truncate">{entry.itemId.slice(0, 8)}...</span>
                    <span className={`text-xs px-2 py-0.5 rounded border ${passColor}`}>
                      Pass {entry.passNumber}
                    </span>
                    <span className="text-xs text-gray-500">{entry.verificationBureau}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5">
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Expires {expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                    <span className={`text-xs font-medium flex items-center gap-1 ${daysRemaining <= 7 ? 'text-orange-400' : 'text-cyan-400'}`}>
                      <Clock className="w-3 h-3" />
                      {daysRemaining}d remaining
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {onOverrideHold && (
                  <button
                    onClick={() => onOverrideHold(entry.itemId)}
                    className="text-xs text-gray-500 hover:text-yellow-400 transition-colors px-2 py-1 rounded border border-gray-700 hover:border-yellow-700 whitespace-nowrap"
                    title="Override hold and dispatch now (advanced)"
                  >
                    Override
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
