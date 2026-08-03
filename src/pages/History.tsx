import React, { useMemo, useState } from "react";
import { Clock, FileText, CheckCircle2, AlertTriangle, Zap, Trash2, Filter, BookOpen } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { HistoryEvent, HistoryEventType } from "../types";
import { DisputeHistoryView } from "../components/DisputeHistoryView";
import type { DisputeEventTypeV2, DisputeEventV2, PassNumber } from "../types/creditRepair";

const EVENT_ICON: Partial<Record<HistoryEventType, React.ElementType>> = {
  dispute_letter_sent: FileText,
  letter_generated: FileText,
  letter_sent: FileText,
  response_logged: CheckCircle2,
  item_won: CheckCircle2,
  autopilot_cycle_run: Zap,
  batch_started: Zap,
  report_uploaded: FileText,
  score_entry_added: Zap,
  score_updated: Zap,
};

const EVENT_COLOR: Partial<Record<HistoryEventType, string>> = {
  dispute_letter_sent: "text-[#00ffff]",
  letter_generated: "text-[#00ffff]",
  letter_sent: "text-[#00ffff]",
  response_logged: "text-[#ff9900]",
  item_won: "text-[#00ff00]",
  autopilot_cycle_run: "text-[#ff00ff]",
  escalation_triggered: "text-[#ff00ff]",
  escalation: "text-[#ff00ff]",
  report_uploaded: "text-blue-400",
  score_entry_added: "text-yellow-400",
  score_updated: "text-yellow-400",
  vault_upload: "text-purple-400",
};

const ALL_TYPES: HistoryEventType[] = [
  "dispute_letter_sent", "letter_generated", "letter_sent", "response_logged",
  "item_won", "item_added", "item_deleted", "item_updated",
  "autopilot_cycle_run", "batch_started", "batch_completed", "escalation_triggered", "escalation",
  "report_uploaded", "items_parsed",
  "score_entry_added", "score_updated",
  "vault_upload", "data_backup",
  "campaign_started", "campaign_completed",
  "note_added",
];

const LEGACY_TO_V2_TYPE: Partial<Record<HistoryEventType, DisputeEventTypeV2>> = {
  dispute_letter_sent: "pass_letter_sent",
  letter_sent: "pass_letter_sent",
  letter_generated: "pass_letter_generated",
  response_logged: "bureau_response_received",
  item_deleted: "item_deleted",
  item_updated: "item_updated",
  item_won: "item_deleted",
  batch_started: "cycle_started",
  batch_completed: "cycle_completed",
  autopilot_cycle_run: "cycle_completed",
  report_uploaded: "report_uploaded",
  items_parsed: "report_parsed",
  note_added: "user_note_added",
};

function normalizePass(round?: number): PassNumber | undefined {
  if (!round) return undefined;
  const clamped = Math.max(1, Math.min(6, round));
  return clamped as PassNumber;
}

function mapLegacyToV2(event: HistoryEvent): DisputeEventV2 {
  return {
    id: event.id,
    timestamp: event.timestamp,
    profileId: "legacy",
    type: LEGACY_TO_V2_TYPE[event.type] ?? "user_note_added",
    title: event.title,
    detail: event.detail,
    itemId: event.itemId,
    letterId: event.letterId,
    passNumber: normalizePass(event.round),
    bureau: event.bureau,
    outcome: event.outcome,
    metadata: { legacyType: event.type },
  };
}

export function History() {
  const { historyEvents, clearHistoryEvents } = useAppContext();
  const [filter, setFilter] = useState<"All" | HistoryEventType>("All");
  const [confirmClear, setConfirmClear] = useState(false);
  const v4Events = useMemo(() => historyEvents.map(mapLegacyToV2), [historyEvents]);

  const filtered = filter === "All" ? historyEvents : historyEvents.filter((e) => e.type === filter);
  const sorted = [...filtered].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Clock className="text-[#00ffff]" /> AUDIT HISTORY
          </h2>
          <p className="text-zinc-400 font-mono text-xs mt-1">{historyEvents.length} EVENTS — FULL FCRA AUDIT TRAIL</p>
        </div>
        <div className="flex gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)}
            className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
            <option value="All">All Events</option>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          {!confirmClear ? (
            <button onClick={() => setConfirmClear(true)}
              className="cyber-button text-xs border-red-500/40 text-red-400 px-3 py-2 flex items-center gap-1">
              <Trash2 size={12} /> Clear
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => { clearHistoryEvents(); setConfirmClear(false); }}
                className="cyber-button text-xs border-red-500 text-red-500 px-3 py-2">Confirm</button>
              <button onClick={() => setConfirmClear(false)}
                className="cyber-button text-xs border-zinc-700 text-zinc-500 px-3 py-2">Cancel</button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {sorted.length === 0 && (
          <div className="text-center py-16 text-zinc-700 text-sm">No history events yet. Start disputing!</div>
        )}
        {sorted.map((event) => {
          const Icon = EVENT_ICON[event.type] || Clock;
          const color = EVENT_COLOR[event.type] || "text-zinc-400";
          return (
            <div key={event.id} className="cyber-panel p-4 flex items-start gap-3">
              <Icon size={16} className={`${color} mt-0.5 shrink-0`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold text-white">{event.title}</span>
                  <span className="text-[10px] font-mono text-zinc-600 shrink-0">{new Date(event.timestamp).toLocaleString()}</span>
                </div>
                {event.detail && <div className="text-xs text-zinc-500 mt-0.5">{event.detail}</div>}
                <div className="flex flex-wrap gap-2 mt-1">
                  <span className={`text-[9px] font-mono border px-1.5 py-0.5 rounded ${color} border-current opacity-70`}>{event.type.replace(/_/g, " ")}</span>
                  {event.bureau && <span className="text-[9px] font-mono text-zinc-600">{event.bureau}</span>}
                  {event.outcome && <span className="text-[9px] font-mono text-zinc-600">{event.outcome}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* V4 Full Dispute History */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <BookOpen size={14} className="text-[#ff9900]" />
          <span className="text-xs font-mono font-bold text-zinc-400">V4 FULL DISPUTE HISTORY</span>
          <span className="text-[9px] font-mono text-zinc-600 ml-1">FCRA AUDIT TRAIL • 5-PASS ENGINE</span>
        </div>
        <DisputeHistoryView events={v4Events} />
      </div>
    </div>
  );
}
