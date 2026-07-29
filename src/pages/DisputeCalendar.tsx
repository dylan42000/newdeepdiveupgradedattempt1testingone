import React, { useMemo, useState } from "react";
import { CalendarDays, Clock3, ShieldAlert, ShieldCheck, Filter } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import {
  buildDisputeCalendar,
  getFollowUpCandidates,
  getSOLCalendarEntries,
  type DisputeCalendarEntry,
} from "../services/autopilotEngine";

type BureauFilter = "all" | "equifax" | "experian" | "transunion" | "unknown";

function formatDate(dateValue: string | null): string {
  if (!dateValue) return "-";
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString();
}

function dayBadgeClass(daysRemaining: number | null): string {
  if (daysRemaining === null) return "text-zinc-500 border-zinc-700";
  if (daysRemaining < 0) return "text-red-300 border-red-500/50 bg-red-500/10";
  if (daysRemaining <= 7) return "text-red-300 border-red-500/40 bg-red-500/10";
  if (daysRemaining <= 14) return "text-[#ff9900] border-[#ff9900]/40 bg-[#ff9900]/10";
  return "text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10";
}

function bureauMatchesFilter(entry: DisputeCalendarEntry, filter: BureauFilter): boolean {
  if (filter === "all") return true;
  const normalized = (entry.bureau || "unknown").toLowerCase();
  if (normalized.includes("equifax")) return filter === "equifax";
  if (normalized.includes("experian")) return filter === "experian";
  if (normalized.includes("transunion")) return filter === "transunion";
  return filter === "unknown";
}

export function DisputeCalendar() {
  const { negativeItems, autopilot } = useAppContext();
  const [bureauFilter, setBureauFilter] = useState<BureauFilter>("all");

  const disputeCalendar = useMemo(() => buildDisputeCalendar(negativeItems), [negativeItems]);
  const solCalendar = useMemo(() => getSOLCalendarEntries(negativeItems), [negativeItems]);
  const followUpCandidates = useMemo(() => getFollowUpCandidates(negativeItems), [negativeItems]);

  const filteredCalendar = useMemo(
    () => disputeCalendar.filter((entry) => bureauMatchesFilter(entry, bureauFilter)),
    [bureauFilter, disputeCalendar],
  );

  const dueSoon = filteredCalendar.filter(
    (entry) => typeof entry.daysRemaining === "number" && entry.daysRemaining >= 0 && entry.daysRemaining <= 7,
  ).length;

  const overdue = filteredCalendar.filter(
    (entry) => typeof entry.daysRemaining === "number" && entry.daysRemaining < 0,
  ).length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <CalendarDays className="text-[#00ffff]" /> DISPUTE CALENDAR
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          CALENDARIZED FCRA DEADLINES, FOLLOW-UP WINDOWS, AND SOL TIMELINE SIGNALS
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-500">TOTAL EVENTS</div>
          <div className="text-2xl font-bold font-mono text-[#00ffff]">{filteredCalendar.length}</div>
        </div>
        <div className="cyber-panel p-4 border-red-500/25">
          <div className="text-[10px] font-mono text-zinc-500">DUE IN 7 DAYS</div>
          <div className="text-2xl font-bold font-mono text-red-300">{dueSoon}</div>
        </div>
        <div className="cyber-panel p-4 border-[#ff9900]/25">
          <div className="text-[10px] font-mono text-zinc-500">FOLLOW-UP CANDIDATES</div>
          <div className="text-2xl font-bold font-mono text-[#ff9900]">{followUpCandidates.length}</div>
        </div>
        <div className="cyber-panel p-4 border-yellow-500/25">
          <div className="text-[10px] font-mono text-zinc-500">OVERDUE</div>
          <div className="text-2xl font-bold font-mono text-yellow-300">{overdue}</div>
        </div>
      </div>

      <div className="cyber-panel p-4">
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="text-xs font-mono text-zinc-400 flex items-center gap-2">
            <Filter size={12} /> BUREAU FILTER
          </div>
          <select
            value={bureauFilter}
            onChange={(event) => setBureauFilter(event.target.value as BureauFilter)}
            className="bg-black/60 border border-zinc-700 rounded px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-[#00ffff]"
            title="Filter dispute calendar by bureau"
            aria-label="Filter dispute calendar by bureau"
          >
            <option value="all">All bureaus</option>
            <option value="equifax">Equifax</option>
            <option value="experian">Experian</option>
            <option value="transunion">TransUnion</option>
            <option value="unknown">Unknown</option>
          </select>
        </div>
      </div>

      {!autopilot.showDisputeCalendar && (
        <div className="cyber-panel p-4 border-yellow-500/30 bg-yellow-500/5 text-xs text-yellow-300">
          Dispute Calendar display is currently disabled in Autopilot settings. Data is still tracked and shown here.
        </div>
      )}

      <div className="cyber-panel p-5">
        <div className="text-[10px] font-mono text-zinc-500 mb-3">FCRA RESPONSE DEADLINES</div>
        {filteredCalendar.length === 0 ? (
          <div className="text-xs text-zinc-500">No pending dispute deadlines currently tracked.</div>
        ) : (
          <div className="space-y-2">
            {filteredCalendar.slice(0, 100).map((entry) => (
              <div key={`${entry.itemId}-${entry.bureau}-${entry.round}`} className="rounded border border-zinc-800 p-3 bg-black/30">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white">{entry.creditorName}</div>
                    <div className="text-[10px] font-mono text-zinc-500">
                      {entry.bureau} • ROUND {entry.round}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-zinc-500">Sent: {formatDate(entry.sentDate)}</span>
                    <span className="text-zinc-500">Deadline: {formatDate(entry.deadlineDate)}</span>
                    <span className={`px-2 py-0.5 border rounded ${dayBadgeClass(entry.daysRemaining)}`}>
                      {entry.daysRemaining === null
                        ? "No deadline"
                        : entry.daysRemaining < 0
                          ? `${Math.abs(entry.daysRemaining)} day(s) late`
                          : `${entry.daysRemaining} day(s) left`}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="cyber-panel p-5">
          <div className="text-[10px] font-mono text-zinc-500 mb-3 flex items-center gap-2">
            <Clock3 size={12} className="text-[#ff9900]" /> SMART FOLLOW-UP WINDOW
          </div>
          {followUpCandidates.length === 0 ? (
            <div className="text-xs text-zinc-500">No accounts currently in the day 25-29 follow-up window.</div>
          ) : (
            <div className="space-y-2">
              {followUpCandidates.slice(0, 20).map((item) => (
                <div key={item.id} className="rounded border border-[#ff9900]/30 bg-[#ff9900]/5 p-2">
                  <div className="text-xs font-bold text-white">{item.creditorName}</div>
                  <div className="text-[10px] text-zinc-400">{item.disputeStatus} • Last sent {formatDate(item.lastDisputeDate)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cyber-panel p-5">
          <div className="text-[10px] font-mono text-zinc-500 mb-3">SOL CALENDAR WATCH</div>
          {solCalendar.length === 0 ? (
            <div className="text-xs text-zinc-500">No SOL calendar entries available.</div>
          ) : (
            <div className="space-y-2">
              {solCalendar.slice(0, 20).map((entry) => (
                <div key={entry.itemId} className="rounded border border-zinc-800 bg-black/30 p-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-white">{entry.creditorName}</div>
                    <div className="text-[10px] text-zinc-500">SOL: {formatDate(entry.solDropDate)}</div>
                  </div>
                  <div className="text-[10px] font-mono flex items-center gap-1">
                    {entry.urgency === "critical" ? <ShieldAlert size={12} className="text-red-300" /> : <ShieldCheck size={12} className="text-[#00ff00]" />}
                    <span className={entry.urgency === "critical" ? "text-red-300" : entry.urgency === "watch" ? "text-[#ff9900]" : "text-[#00ff00]"}>
                      {entry.daysUntilDrop} day(s)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
