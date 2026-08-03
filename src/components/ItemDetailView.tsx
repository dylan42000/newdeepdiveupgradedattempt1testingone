/**
 * ItemDetailView.tsx — Per-Item Dispute History with Pass Tracker
 * Shows all passes attempted, outcomes, current status, and recommended next step.
 */

import React from 'react';
import {
  CheckCircle, Clock, AlertTriangle, ArrowRight,
  FileText, Mail, MessageSquare, Lock, Target
} from 'lucide-react';
import type { NegativeItem } from '../types';
import { getResolvedAccountNumber } from '../services/tradelineMerger';
import type { DisputeEventV2, PassNumber, HoldQueueEntry, FCRADeadline } from '../types/creditRepair';

interface ItemDetailViewProps {
  item: NegativeItem;
  events: DisputeEventV2[];
  holdEntry: HoldQueueEntry | null;
  deadline: FCRADeadline | null;
  passNumber: PassNumber;
  onDispute?: (itemId: string) => void;
  onMarkDeleted?: (itemId: string) => void;
  onLogResponse?: (itemId: string) => void;
}

const PASS_INFO: Record<PassNumber, { label: string; strategy: string; color: string; bgColor: string }> = {
  1: { label: 'Pass 1', strategy: 'Accuracy Challenge', color: 'text-blue-400', bgColor: 'bg-blue-900/20 border-blue-800' },
  2: { label: 'Pass 2', strategy: 'Method of Verification', color: 'text-yellow-400', bgColor: 'bg-yellow-900/20 border-yellow-800' },
  3: { label: 'Pass 3', strategy: 'Procedural Violation', color: 'text-orange-400', bgColor: 'bg-orange-900/20 border-orange-800' },
  4: { label: 'Pass 4', strategy: 'Formal Intent to Complain', color: 'text-red-400', bgColor: 'bg-red-900/20 border-red-800' },
  5: { label: 'Pass 5', strategy: 'Final Demand + CFPB', color: 'text-purple-400', bgColor: 'bg-purple-900/20 border-purple-800' },
  6: { label: 'Pass 6', strategy: 'Pre-Litigation Demand', color: 'text-rose-400', bgColor: 'bg-rose-900/20 border-rose-800' },
};

export const ItemDetailView: React.FC<ItemDetailViewProps> = ({
  item,
  events,
  holdEntry,
  deadline,
  passNumber,
  onDispute,
  onMarkDeleted,
  onLogResponse,
}) => {
  const sortedEvents = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const sentEvents = events.filter(e => e.type === 'pass_letter_sent');
  const highestPassSent = sentEvents.reduce((max, e) => Math.max(max, e.passNumber ?? 0), 0) as PassNumber | 0;
  const currentPassInfo = PASS_INFO[passNumber];
  const isOnHold = !!holdEntry && new Date(holdEntry.holdExpiryDate) > new Date();
  const isDeleted = item.disputeStatus === 'Deleted';
  const isResolved = isDeleted || item.disputeStatus === 'Won';

  const today = new Date();
  const deadlineDaysLeft = deadline
    ? Math.ceil((new Date(deadline.deadlineDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className="space-y-4">
      {/* Item header */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-100">{item.creditorName}</h3>
            <div className="flex flex-wrap gap-2 mt-1 text-xs text-gray-500">
              <span>{item.creditBureau.join(', ')}</span>
              {item.balance != null && <span>${item.balance.toLocaleString()}</span>}
              <span>{item.typeOfNegative}</span>
              {getResolvedAccountNumber(item) && <span>#{getResolvedAccountNumber(item)}</span>}
            </div>
          </div>
          <ItemStatusBadge status={item.disputeStatus ?? 'Undisputed'} />
        </div>

        {/* Pass progress rail */}
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">Dispute Pass Progress</p>
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4, 5, 6] as PassNumber[]).map(p => {
              const pi = PASS_INFO[p];
              const isSent = p <= (highestPassSent as number);
              const isCurrent = p === passNumber;
              return (
                <React.Fragment key={p}>
                  <div className={`flex-1 h-1.5 rounded-full ${
                    isResolved ? 'bg-green-600' :
                    isSent ? `bg-cyan-700` :
                    isCurrent ? 'bg-cyan-900 border border-cyan-700' :
                    'bg-gray-800'
                  }`} title={`${pi.label}: ${pi.strategy}`} />
                  {p < 5 && <div className="w-0.5 h-3 bg-gray-800" />}
                </React.Fragment>
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-gray-600">
            {([1, 2, 3, 4, 5, 6] as PassNumber[]).map(p => (
              <span key={p} className={`flex-1 text-center ${p === passNumber ? PASS_INFO[p].color : ''}`}>
                P{p}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-3">
        {/* Current pass */}
        <div className={`rounded-lg border p-3 ${currentPassInfo.bgColor}`}>
          <p className="text-xs text-gray-500 mb-1">Current Pass</p>
          <p className={`text-sm font-medium ${currentPassInfo.color}`}>{currentPassInfo.label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{currentPassInfo.strategy}</p>
        </div>

        {/* Hold or deadline */}
        {isOnHold ? (
          <div className="rounded-lg border border-purple-900 bg-purple-950/20 p-3">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Lock className="w-3 h-3" />
              On Hold
            </p>
            <p className="text-sm font-medium text-purple-400">
              {Math.max(0, Math.ceil((new Date(holdEntry!.holdExpiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))}d remaining
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Expires {new Date(holdEntry!.holdExpiryDate).toLocaleDateString()}
            </p>
          </div>
        ) : deadline ? (
          <div className={`rounded-lg border p-3 ${
            deadline.status === 'overdue' ? 'border-red-800 bg-red-950/20' :
            deadlineDaysLeft !== null && deadlineDaysLeft <= 7 ? 'border-orange-800 bg-orange-950/20' :
            'border-cyan-900 bg-cyan-950/20'
          }`}>
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              FCRA Deadline
            </p>
            <p className={`text-sm font-medium ${
              deadline.status === 'overdue' ? 'text-red-400' :
              deadlineDaysLeft !== null && deadlineDaysLeft <= 7 ? 'text-orange-400' :
              'text-cyan-400'
            }`}>
              {deadline.status === 'overdue' ? `${deadline.overdueByDays}d overdue!` :
               deadlineDaysLeft !== null ? `${deadlineDaysLeft}d left` : 'Active'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">{new Date(deadline.deadlineDate).toLocaleDateString()}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
            <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
              <Target className="w-3 h-3" />
              Priority Score
            </p>
            <p className="text-sm font-medium text-gray-300">{item.priorityScore ?? 0}/100</p>
            <p className="text-xs text-gray-500 mt-0.5">{item.estimatedScoreImpact ?? 'Unknown'} est. impact</p>
          </div>
        )}
      </div>

      {/* Action buttons */}
      {!isResolved && (
        <div className="flex gap-2 flex-wrap">
          {onDispute && !isOnHold && (
            <button
              onClick={() => onDispute(item.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg bg-cyan-900/40 border border-cyan-800 text-cyan-400 hover:bg-cyan-900/70 transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              Generate {currentPassInfo.label} Letter
            </button>
          )}
          {onLogResponse && (
            <button
              onClick={() => onLogResponse(item.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-yellow-400 hover:border-yellow-700 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Log Response
            </button>
          )}
          {onMarkDeleted && (
            <button
              onClick={() => onMarkDeleted(item.id)}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-colors"
            >
              <CheckCircle className="w-3.5 h-3.5" />
              Mark Deleted
            </button>
          )}
        </div>
      )}

      {/* Event history */}
      <div>
        <p className="text-xs text-gray-500 mb-2 flex items-center gap-1.5">
          <ArrowRight className="w-3.5 h-3.5" />
          Item History ({sortedEvents.length} events)
        </p>
        <div className="space-y-1.5">
          {sortedEvents.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-800 p-4 text-center">
              <p className="text-xs text-gray-600">No events recorded yet for this item</p>
            </div>
          ) : (
            sortedEvents.map(event => (
              <div key={event.id} className="flex items-start gap-2.5 py-2 px-3 rounded-lg bg-gray-900/30 border border-gray-800/50">
                <EventDot type={event.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300">{event.title}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    {new Date(event.timestamp).toLocaleString()}
                    {event.passNumber && ` · Pass ${event.passNumber}`}
                    {event.bureau && ` · ${event.bureau}`}
                  </p>
                  {event.detail && event.detail !== event.title && (
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{event.detail}</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────

const EventDot: React.FC<{ type: string }> = ({ type }) => {
  const getColor = () => {
    if (type.includes('sent')) return 'bg-cyan-500';
    if (type.includes('deleted')) return 'bg-green-500';
    if (type === 'item_verified') return 'bg-orange-500';
    if (type.includes('no_response')) return 'bg-red-500';
    if (type.includes('hold')) return 'bg-purple-500';
    if (type.includes('cycle')) return 'bg-blue-500';
    return 'bg-gray-600';
  };
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${getColor()}`} />;
};

const ITEM_STATUS_CFG: Record<string, string> = {
  'Deleted': 'text-green-400 bg-green-900/30 border-green-800',
  'Won': 'text-blue-400 bg-blue-900/30 border-blue-800',
  'In Dispute': 'text-yellow-400 bg-yellow-900/30 border-yellow-800',
  'Undisputed': 'text-gray-400 bg-gray-800/30 border-gray-700',
  'Verified': 'text-orange-400 bg-orange-900/30 border-orange-800',
};

const ItemStatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`text-xs px-2 py-0.5 rounded border flex-shrink-0 ${ITEM_STATUS_CFG[status] ?? ITEM_STATUS_CFG['Undisputed']}`}>
    {status}
  </span>
);
