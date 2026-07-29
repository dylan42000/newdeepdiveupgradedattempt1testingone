/**
 * DisputeHistoryView.tsx — Full Interaction Timeline
 * Filterable, sortable history of all dispute events for the active profile.
 */

import React, { useState, useMemo } from 'react';
import {
  Mail, CheckCircle, Clock, AlertTriangle, FileText,
  Filter, ChevronDown, Shield, RotateCcw, User
} from 'lucide-react';
import type { DisputeEventV2, DisputeEventTypeV2, PassNumber } from '../types/creditRepair';

interface DisputeHistoryViewProps {
  events: DisputeEventV2[];
  onViewItem?: (itemId: string) => void;
}

type FilterType = 'all' | 'letters' | 'responses' | 'cycles' | 'issues';

const TYPE_ICON: Partial<Record<DisputeEventTypeV2, React.FC<{ className?: string }>>> = {
  pass_letter_sent: Mail,
  pass_letter_generated: FileText,
  bureau_response_received: CheckCircle,
  item_deleted: CheckCircle,
  item_verified: AlertTriangle,
  item_no_response: AlertTriangle,
  hold_started: Clock,
  hold_expired: RotateCcw,
  cycle_completed: Shield,
  cycle_started: Shield,
  cfpb_complaint_generated: FileText,
  state_ag_complaint_generated: FileText,
  duplicate_prevented: RotateCcw,
  validation_failed: AlertTriangle,
  profile_created: User,
  profile_switched: User,
};

const TYPE_COLOR: Partial<Record<DisputeEventTypeV2, string>> = {
  pass_letter_sent: 'text-cyan-400',
  pass_letter_generated: 'text-blue-400',
  bureau_response_received: 'text-yellow-400',
  item_deleted: 'text-green-400',
  item_verified: 'text-orange-400',
  item_no_response: 'text-red-400',
  hold_started: 'text-purple-400',
  hold_expired: 'text-gray-400',
  cycle_completed: 'text-cyan-300',
  cycle_started: 'text-cyan-500',
  cfpb_complaint_generated: 'text-pink-400',
  state_ag_complaint_generated: 'text-pink-300',
  duplicate_prevented: 'text-gray-500',
  validation_failed: 'text-red-400',
  profile_created: 'text-teal-400',
  profile_switched: 'text-teal-300',
};

const PASS_BADGE: Record<PassNumber, string> = {
  1: 'bg-blue-900/40 text-blue-400 border-blue-800',
  2: 'bg-yellow-900/40 text-yellow-400 border-yellow-800',
  3: 'bg-orange-900/40 text-orange-400 border-orange-800',
  4: 'bg-red-900/40 text-red-400 border-red-800',
  5: 'bg-purple-900/40 text-purple-400 border-purple-800',
  6: 'bg-rose-900/40 text-rose-400 border-rose-800',
};

const FILTER_GROUPS: Record<FilterType, DisputeEventTypeV2[] | null> = {
  all: null,
  letters: ['pass_letter_sent', 'pass_letter_generated'],
  responses: ['bureau_response_received', 'item_deleted', 'item_verified', 'item_updated', 'item_no_response'],
  cycles: ['cycle_started', 'cycle_completed', 'hold_started', 'hold_expired'],
  issues: ['validation_failed', 'duplicate_prevented', 'item_no_response'],
};

export const DisputeHistoryView: React.FC<DisputeHistoryViewProps> = ({ events, onViewItem }) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCount, setShowCount] = useState(30);

  const filtered = useMemo(() => {
    let result = [...events].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const types = FILTER_GROUPS[filter];
    if (types) {
      result = result.filter(e => types.includes(e.type as DisputeEventTypeV2));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.detail.toLowerCase().includes(q) ||
        (e.bureau ?? '').toLowerCase().includes(q)
      );
    }

    return result;
  }, [events, filter, searchQuery]);

  const visible = filtered.slice(0, showCount);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {/* Filter tabs */}
        <div className="flex rounded-lg border border-gray-800 overflow-hidden text-xs">
          {(Object.keys(FILTER_GROUPS) as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 capitalize transition-colors ${
                filter === f
                  ? 'bg-cyan-900/50 text-cyan-400'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search events..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="flex-1 min-w-36 px-3 py-1.5 text-xs rounded-lg border border-gray-800 bg-gray-900/50 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-800"
        />

        <span className="text-xs text-gray-500 self-center">{filtered.length} events</span>
      </div>

      {/* Event list */}
      {visible.length === 0 && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center">
          <Filter className="w-8 h-8 text-gray-600 mx-auto mb-2" />
          <p className="text-gray-500 text-sm">No events match your filter</p>
        </div>
      )}

      <div className="space-y-1.5">
        {visible.map(event => {
          const IconComp = TYPE_ICON[event.type as DisputeEventTypeV2] ?? FileText;
          const color = TYPE_COLOR[event.type as DisputeEventTypeV2] ?? 'text-gray-400';
          const isExpanded = expandedId === event.id;

          return (
            <div
              key={event.id}
              className="rounded-lg border border-gray-800 bg-gray-900/40 hover:bg-gray-900/70 transition-colors"
            >
              <div
                className="flex items-start gap-3 p-3 cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
              >
                <IconComp className={`w-4 h-4 mt-0.5 flex-shrink-0 ${color}`} />

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-200">{event.title}</span>
                    {event.passNumber && (
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${PASS_BADGE[event.passNumber]}`}>
                        P{event.passNumber}
                      </span>
                    )}
                    {event.bureau && (
                      <span className="text-xs text-gray-500">{event.bureau}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                    <span>{new Date(event.timestamp).toLocaleString()}</span>
                    {event.itemId && onViewItem && (
                      <button
                        onClick={e => { e.stopPropagation(); onViewItem(event.itemId!); }}
                        className="text-cyan-600 hover:text-cyan-400 transition-colors"
                      >
                        View item
                      </button>
                    )}
                  </div>
                </div>

                <ChevronDown className={`w-3.5 h-3.5 text-gray-600 flex-shrink-0 transition-transform mt-0.5 ${isExpanded ? 'rotate-180' : ''}`} />
              </div>

              {isExpanded && (
                <div className="px-4 pb-3 pt-0 border-t border-gray-800/50">
                  <p className="text-xs text-gray-400 mt-2">{event.detail}</p>
                  {event.certifiedMailNumber && (
                    <p className="text-xs text-gray-500 mt-1">Cert. Mail: {event.certifiedMailNumber}</p>
                  )}
                  {event.outcome && (
                    <p className="text-xs mt-1">
                      <span className="text-gray-500">Outcome: </span>
                      <span className="text-gray-300">{event.outcome}</span>
                    </p>
                  )}
                  {event.cycleId && (
                    <p className="text-xs text-gray-600 mt-1">Cycle: {event.cycleId.slice(0, 12)}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length > showCount && (
        <button
          onClick={() => setShowCount(n => n + 30)}
          className="w-full py-2 text-xs text-gray-500 hover:text-gray-300 border border-gray-800 rounded-lg transition-colors"
        >
          Load more ({filtered.length - showCount} remaining)
        </button>
      )}
    </div>
  );
};
