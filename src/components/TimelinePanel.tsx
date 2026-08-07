/**
 * TimelinePanel.tsx — FCRA Deadline Tracker UI
 * Shows all active/overdue FCRA deadlines for the current profile.
 */

import React from 'react';
import { AlertTriangle, CheckCircle, Clock, FileText } from 'lucide-react';
import type { FCRADeadline } from '../types/creditRepair';

interface TimelinePanelProps {
  deadlines: FCRADeadline[];
  onResolve?: (deadlineId: string) => void;
}

const STATUS_CONFIG = {
  active: { label: 'Active', color: 'text-cyan-400', bg: 'bg-cyan-900/20 border-cyan-800', Icon: Clock },
  overdue: { label: 'Overdue', color: 'text-red-400', bg: 'bg-red-900/20 border-red-800', Icon: AlertTriangle },
  resolved: { label: 'Resolved', color: 'text-green-400', bg: 'bg-green-900/20 border-green-800', Icon: CheckCircle },
  extended: { label: 'Extended', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-800', Icon: Clock },
};

export const TimelinePanel: React.FC<TimelinePanelProps> = ({ deadlines, onResolve }) => {
  const sorted = [...deadlines].sort((a, b) => {
    if (a.status === 'overdue' && b.status !== 'overdue') return -1;
    if (b.status === 'overdue' && a.status !== 'overdue') return 1;
    return new Date(a.deadlineDate).getTime() - new Date(b.deadlineDate).getTime();
  });

  const overdueCount = deadlines.filter(d => d.status === 'overdue').length;
  const activeCount = deadlines.filter(d => d.status === 'active').length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-gray-400">
          <span className="text-cyan-400 font-medium">{activeCount}</span> active
        </span>
        {overdueCount > 0 && (
          <span className="text-red-400 font-medium flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {overdueCount} overdue
          </span>
        )}
        <span className="text-gray-500">{deadlines.length} total</span>
      </div>

      {sorted.length === 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6 text-center">
          <FileText className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No FCRA deadlines tracked yet</p>
          <p className="text-gray-600 text-xs mt-1">Deadlines appear after dispute letters are sent</p>
        </div>
      )}

      <div className="space-y-2">
        {sorted.map(deadline => {
          const cfg = STATUS_CONFIG[deadline.status] ?? STATUS_CONFIG.active;
          const { Icon } = cfg;
          const deadline_date = new Date(deadline.deadlineDate);
          const today = new Date();
          const daysLeft = Math.ceil((deadline_date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          return (
            <div key={deadline.id} className={`rounded-lg border p-3 ${cfg.bg}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-gray-200 font-medium truncate">{deadline.itemName}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-xs text-gray-500">Pass {deadline.passNumber}</span>
                      <span className="text-xs text-gray-500">{deadline.bureau}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-gray-400">
                      <span>Letter sent: {new Date(deadline.letterSentDate).toLocaleDateString()}</span>
                      <span>Deadline: {deadline_date.toLocaleDateString()}</span>
                      <span className="text-gray-500">{deadline.fcraSection}</span>
                    </div>

                    {deadline.status === 'active' && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${daysLeft <= 7 ? 'bg-red-500' : daysLeft <= 14 ? 'bg-yellow-500' : 'bg-cyan-500'}`}
                            style={{ width: `${Math.max(5, Math.min(100, (daysLeft / 45) * 100))}%` }}
                          />
                        </div>
                        <span className={`text-xs ${daysLeft <= 7 ? 'text-red-400' : 'text-gray-400'}`}>
                          {daysLeft > 0 ? `${daysLeft}d left` : 'Today!'}
                        </span>
                      </div>
                    )}

                    {deadline.status === 'overdue' && (
                      <p className="text-xs text-red-400 mt-1">
                        {deadline.overdueByDays}d overdue — bureau must comply or item is actionable
                      </p>
                    )}
                  </div>
                </div>

                {deadline.status !== 'resolved' && onResolve && (
                  <button
                    onClick={() => onResolve(deadline.id)}
                    className="text-xs text-gray-500 hover:text-green-400 transition-colors px-2 py-1 rounded border border-gray-700 hover:border-green-700 whitespace-nowrap flex-shrink-0"
                  >
                    Mark Resolved
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
