import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  TrendingUp, AlertTriangle, FileText, Zap, Target, Award,
  CheckCircle2, Clock, ShieldAlert, TrendingDown, BarChart2, X, ChevronRight,
} from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { defaultDigestWindow, generateWeeklyIntelligenceDigest } from "../services/intelligenceDigestService";
import { detectReinsertedItems, type ArchivedDeletionRecord } from "../services/reInsertionMonitor";
import { buildDisputeGenealogy } from "../services/disputeGenealogyService";
import { evaluateAttorneyReferral } from "../services/attorneyReferralService";

function ScoreArc({ score }: { score: number }) {
  const radius = 70;
  const stroke = 12;
  const normalizedRadius = radius - stroke / 2;
  const circumference = Math.PI * normalizedRadius;
  const clampedScore = Math.max(300, Math.min(850, score));
  const pct = (clampedScore - 300) / (850 - 300);
  const offset = circumference - pct * circumference;
  const color = clampedScore >= 720 ? "#00ff00" : clampedScore >= 650 ? "#ff9900" : clampedScore >= 580 ? "#ff6600" : "#ff2200";

  return (
    <svg width={radius * 2} height={radius + stroke / 2 + 10} className="overflow-visible">
      <path
        d={`M ${stroke / 2} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - stroke / 2} ${radius}`}
        fill="none" stroke="#1f2937" strokeWidth={stroke} strokeLinecap="round" />
      <path
        d={`M ${stroke / 2} ${radius} A ${normalizedRadius} ${normalizedRadius} 0 0 1 ${radius * 2 - stroke / 2} ${radius}`}
        fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${circumference} ${circumference}`}
        strokeDashoffset={offset}
        style={{ transition: "stroke-dashoffset 1s ease-in-out" }} />
      <text x={radius} y={radius - 4} textAnchor="middle" fill={color} fontSize="28" fontWeight="bold" fontFamily="monospace">{score > 0 ? score : "???"}</text>
      <text x={radius} y={radius + 12} textAnchor="middle" fill="#6b7280" fontSize="10" fontFamily="monospace">FICO SCORE</text>
      <text x={stroke / 2} y={radius + 22} fill="#6b7280" fontSize="9" fontFamily="monospace">300</text>
      <text x={radius * 2 - stroke / 2 - 20} y={radius + 22} fill="#6b7280" fontSize="9" fontFamily="monospace">850</text>
    </svg>
  );
}

// ─── FICO Factor Donut Chart ──────────────────────────────────────────────
function FicoDonut({ negativeItems, creditCards, scoreEntries }: { negativeItems: any[]; creditCards: any[]; scoreEntries: any[] }) {
  const latestScore = scoreEntries.length > 0
    ? (() => { const last = [...scoreEntries].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]; return last.equifax ?? last.experian ?? last.transunion ?? 0; })()
    : 0;

  const collections = negativeItems.filter((i) => i.typeOfNegative?.toLowerCase().includes("collection") || i.typeOfNegative?.toLowerCase().includes("charge-off")).length;
  const latePays = negativeItems.filter((i) => i.typeOfNegative?.toLowerCase().includes("late")).length;
  const payHistScore = Math.max(0, 100 - collections * 15 - latePays * 8);
  const totalBal = creditCards.reduce((s: number, c: any) => s + (c.balance || 0), 0);
  const totalLim = creditCards.reduce((s: number, c: any) => s + (c.limit || 0), 0);
  const utilPct = totalLim > 0 ? Math.round((totalBal / totalLim) * 100) : 30;
  const utilScore = utilPct <= 9 ? 100 : utilPct <= 29 ? 80 : utilPct <= 49 ? 50 : utilPct <= 74 ? 25 : 10;
  const mixScore = creditCards.length >= 3 ? 85 : creditCards.length >= 1 ? 60 : 20;

  const factors = [
    { label: "Payment History", pct: 35, score: payHistScore, color: "#00ff00" },
    { label: "Utilization", pct: 30, score: utilScore, color: "#00ffff" },
    { label: "Length of History", pct: 15, score: latestScore >= 650 ? 70 : 40, color: "#ff9900" },
    { label: "New Credit", pct: 10, score: 75, color: "#ff00ff" },
    { label: "Credit Mix", pct: 10, score: mixScore, color: "#a78bfa" },
  ];

  // SVG donut
  const R = 48; const cx = 56; const cy = 56;
  let cumPct = 0;
  const paths = factors.map((f) => {
    const start = (cumPct / 100) * 2 * Math.PI - Math.PI / 2;
    cumPct += f.pct;
    const end = (cumPct / 100) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + R * Math.cos(start); const y1 = cy + R * Math.sin(start);
    const x2 = cx + R * Math.cos(end); const y2 = cy + R * Math.sin(end);
    const largeArc = f.pct > 50 ? 1 : 0;
    return <path key={f.label} d={`M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`} fill={f.color} opacity="0.8" />;
  });

  return (
    <div className="cyber-panel p-5">
      <div className="text-[10px] font-mono text-zinc-500 mb-3">FICO SCORE FACTOR BREAKDOWN</div>
      <div className="flex items-center gap-4 flex-wrap">
        <svg viewBox="0 0 112 112" className="w-24 h-24 shrink-0">
          {paths}
          <circle cx={cx} cy={cy} r={R * 0.55} fill="#0a0a0a" />
          <text x={cx} y={cy + 4} textAnchor="middle" fill="#fff" fontSize="11" fontWeight="bold" fontFamily="monospace">{latestScore || "??"}</text>
        </svg>
        <div className="flex-1 space-y-1.5">
          {factors.map((f) => (
            <div key={f.label} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: f.color }} />
              <span className="text-[9px] font-mono text-zinc-400 w-28">{f.label} ({f.pct}%)</span>
              <div className="flex-1 bg-zinc-800 rounded-full h-1.5 max-w-32">
                <div className="h-1.5 rounded-full" style={{ background: f.color, width: `${f.score}%` }} />
              </div>
              <span className="text-[9px] font-mono" style={{ color: f.color }}>{f.score}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const SCORE_BANDS = [
  { min: 800, max: 850, label: "Exceptional", color: "text-[#00ff00]" },
  { min: 740, max: 799, label: "Very Good", color: "text-green-400" },
  { min: 670, max: 739, label: "Good", color: "text-[#ff9900]" },
  { min: 580, max: 669, label: "Fair", color: "text-orange-500" },
  { min: 300, max: 579, label: "Poor", color: "text-red-500" },
];

export function Dashboard() {
  const { negativeItems, disputeLetters, scoreEntries, campaigns, personalInfo, autopilot, creditCards, historyEvents } = useAppContext();
  const [showMilestone, setShowMilestone] = useState<string | null>(null);
  const prevScoreRef = useRef<number | null>(null);

  const wonItems = negativeItems.filter((i) => i.disputeStatus === "Won" || i.disputeStatus === "Deleted");
  const pendingItems = negativeItems.filter((i) => (i.disputeStatus ?? "").includes("Pending"));
  const activeCampaign = campaigns.find((c) => c.id === autopilot.activeCampaignId);

  // Latest score — use equifax/experian/transunion (not .score)
  const sortedEntries = [...scoreEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const latestEntry = sortedEntries[0];
  const prevEntry = sortedEntries[1];
  const latestScore = latestEntry ? (latestEntry.equifax ?? latestEntry.experian ?? latestEntry.transunion ?? 0) : 0;
  const prevScore = prevEntry ? (prevEntry.equifax ?? prevEntry.experian ?? prevEntry.transunion ?? 0) : 0;
  const scoreDelta = latestScore > 0 && prevScore > 0 ? latestScore - prevScore : null;
  const scoreBand = SCORE_BANDS.find((b) => latestScore >= b.min && latestScore <= b.max);

  // Milestone celebration on score threshold crossing
  const MILESTONES_SCORE = [620, 650, 700, 720, 750, 800];
  useEffect(() => {
    if (latestScore > 0 && prevScoreRef.current !== null) {
      const crossed = MILESTONES_SCORE.find((t) => prevScoreRef.current! < t && latestScore >= t);
      if (crossed) setShowMilestone(`🎉 Score reached ${crossed}!`);
    }
    if (latestScore > 0) prevScoreRef.current = latestScore;
  }, [latestScore]);

  // Contextual next action
  const undisputed = negativeItems.filter((i) => !i.disputeStatus || i.disputeStatus === "Undisputed");
  const nextAction = undisputed.length > 0
    ? { label: `Dispute ${undisputed.length} undisputed item${undisputed.length > 1 ? "s" : ""}`, page: "dispute-letters", color: "border-red-500/30 text-red-400" }
    : pendingItems.length > 0
    ? { label: `Follow up on ${pendingItems.length} pending response${pendingItems.length > 1 ? "s" : ""}`, page: "negative-items", color: "border-[#ff9900]/30 text-[#ff9900]" }
    : scoreEntries.length === 0
    ? { label: "Log your current credit score to start tracking", page: "score-tracker", color: "border-[#00ffff]/30 text-[#00ffff]" }
    : null;

  // Milestones
  const milestones = [
    { label: "First Dispute Sent", done: disputeLetters.length > 0, icon: FileText },
    { label: "First Item Resolved", done: wonItems.length > 0, icon: CheckCircle2 },
    { label: "5 Items Resolved", done: wonItems.length >= 5, icon: Target },
    { label: "10 Items Disputed", done: disputeLetters.length >= 10, icon: Zap },
    { label: "Score 700+", done: latestScore >= 700, icon: TrendingUp },
    { label: "Campaign Complete", done: campaigns.some((c) => c.status === "Complete"), icon: Award },
  ];
  const completedMilestones = milestones.filter((m) => m.done).length;

  const stats = [
    { label: "Negative Items", value: negativeItems.length, icon: AlertTriangle, color: "text-red-400" },
    { label: "Letters Sent", value: disputeLetters.length, icon: FileText, color: "text-[#00ffff]" },
    { label: "Items Won", value: wonItems.length, icon: CheckCircle2, color: "text-[#00ff00]" },
    { label: "Pending Response", value: pendingItems.length, icon: Clock, color: "text-[#ff9900]" },
  ];

  const digest = useMemo(() => {
    const { periodStart, periodEnd } = defaultDigestWindow();
    return generateWeeklyIntelligenceDigest({
      periodStart,
      periodEnd,
      letters: disputeLetters,
      history: historyEvents,
      negativeItems,
    });
  }, [disputeLetters, historyEvents, negativeItems]);

  const reInsertionAlerts = useMemo(() => {
    const archived: ArchivedDeletionRecord[] = historyEvents
      .filter((event) => event.type === "item_deleted")
      .map((event) => {
        const knownItem = negativeItems.find((item) => item.id === event.itemId);
        return {
          itemId: event.itemId || event.id,
          creditorName: knownItem?.creditorName || event.title || "Unknown creditor",
          accountNumber: knownItem?.accountNumber || null,
          deletedAt: event.timestamp,
          bureau: knownItem?.creditBureau || (event.bureau ? [event.bureau] : []),
          priorLetterIds: event.letterId ? [event.letterId] : [],
        };
      });

    const currentActive = negativeItems.filter((item) => item.disputeStatus !== "Deleted" && item.disputeStatus !== "Won");
    return detectReinsertedItems(currentActive, archived);
  }, [historyEvents, negativeItems]);

  const attorneyReferrals = useMemo(() => {
    const urgencyRank: Record<"LOW" | "MEDIUM" | "HIGH", number> = {
      HIGH: 0,
      MEDIUM: 1,
      LOW: 2,
    };

    return negativeItems
      .filter((item) => item.disputeStatus !== "Deleted" && item.disputeStatus !== "Won")
      .map((item) => {
        const genealogy = buildDisputeGenealogy(item, disputeLetters, historyEvents);
        const relatedReinsertions = reInsertionAlerts.filter(
          (alert) => alert.itemId === item.id || alert.archivedItemId === item.id,
        );
        const recommendation = evaluateAttorneyReferral({
          item,
          genealogy,
          reInsertionAlerts: relatedReinsertions,
        });
        return { item, genealogy, recommendation };
      })
      .filter((entry) => entry.recommendation.shouldRefer)
      .sort((a, b) => {
        const urgencyDelta = urgencyRank[a.recommendation.urgency] - urgencyRank[b.recommendation.urgency];
        if (urgencyDelta !== 0) return urgencyDelta;

        const roundDelta = b.genealogy.totalRoundsRequired - a.genealogy.totalRoundsRequired;
        if (roundDelta !== 0) return roundDelta;

        return (b.item.priorityScore || 0) - (a.item.priorityScore || 0);
      })
      .slice(0, 5);
  }, [historyEvents, negativeItems, disputeLetters, reInsertionAlerts]);

  return (
    <div className="space-y-6">
      {/* Milestone Celebration Modal */}
      {showMilestone && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80" onClick={() => setShowMilestone(null)}>
          <div className="bg-[#0f0f0f] border border-[#00ff00]/40 rounded-2xl p-8 text-center max-w-sm w-full mx-4">
            <div className="text-5xl mb-3">🎉</div>
            <div className="text-xl font-bold font-mono text-[#00ff00] mb-2">{showMilestone}</div>
            <div className="text-xs font-mono text-zinc-400 mb-4">Keep disputing and building. You're on the path!</div>
            <button onClick={() => setShowMilestone(null)} className="cyber-button border-[#00ff00]/50 text-[#00ff00] px-6 py-2 hover:bg-[#00ff00]/10">CONTINUE</button>
          </div>
        </div>
      )}

      {/* Next Action Banner */}
      {nextAction && (
        <div className={`cyber-panel px-4 py-3 border ${nextAction.color} flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <ChevronRight size={14} className={nextAction.color.split(" ")[1]} />
            <span className="text-xs font-mono text-white">{nextAction.label}</span>
          </div>
          <span className="text-[9px] font-mono text-zinc-600">NEXT ACTION</span>
        </div>
      )}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
          <BarChart2 className="text-[#00ffff]" /> COMMAND DASHBOARD
        </h2>
        <img src="/dylandos-wordmark.svg" alt="Dylandos Ultimate Credit Repair Ultimate" className="h-9 mt-2 opacity-90" />
        <p className="text-zinc-400 font-mono text-xs mt-1">
          {personalInfo.firstName ? `OPERATIVE: ${personalInfo.firstName.toUpperCase()} ${personalInfo.lastName?.toUpperCase()}` : "LOAD PROFILE TO PERSONALIZE"}
        </p>
      </div>

      {/* Score Arc + Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Score arc */}
        <div className="cyber-panel p-6 flex flex-col items-center">
          <div className="text-xs font-mono text-zinc-500 mb-4 self-start">CREDIT SCORE TRACKER</div>
          <ScoreArc score={latestScore} />
          {scoreBand && (
            <div className={`text-sm font-bold mt-3 ${scoreBand.color}`}>{scoreBand.label}</div>
          )}
          {scoreDelta !== null && (
            <div className={`flex items-center gap-1 text-xs font-mono mt-1 ${scoreDelta >= 0 ? "text-[#00ff00]" : "text-red-400"}`}>
              {scoreDelta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {scoreDelta >= 0 ? "+" : ""}{scoreDelta} pts since last entry
            </div>
          )}
          {scoreEntries.length === 0 && (
            <p className="text-xs text-zinc-600 mt-3 text-center">Track your score in Score Tracker to visualize progress.</p>
          )}
        </div>

        {/* 4 stat cards */}
        <div className="grid grid-cols-2 gap-3">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="cyber-panel p-4 flex flex-col gap-2">
                <Icon size={20} className={s.color} />
                <div className={`text-2xl font-bold font-mono ${s.color}`}>{s.value}</div>
                <div className="text-[10px] font-mono text-zinc-500">{s.label.toUpperCase()}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* FICO Factor Donut */}
      <FicoDonut negativeItems={negativeItems} creditCards={creditCards || []} scoreEntries={scoreEntries} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="cyber-panel p-5">
          <div className="text-[10px] font-mono text-zinc-500 mb-3">INTELLIGENCE DIGEST</div>
          <div className="text-sm font-bold text-white mb-2">{digest.headline}</div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="rounded border border-zinc-800 bg-[#0a0a0a] p-2 text-center">
              <div className="text-sm font-mono text-[#00ffff]">{digest.metrics.lettersGenerated}</div>
              <div className="text-[9px] text-zinc-500">LETTERS</div>
            </div>
            <div className="rounded border border-zinc-800 bg-[#0a0a0a] p-2 text-center">
              <div className="text-sm font-mono text-[#00ff00]">{digest.metrics.deletions}</div>
              <div className="text-[9px] text-zinc-500">DELETIONS</div>
            </div>
            <div className="rounded border border-zinc-800 bg-[#0a0a0a] p-2 text-center">
              <div className="text-sm font-mono text-[#ff9900]">{digest.metrics.noResponses}</div>
              <div className="text-[9px] text-zinc-500">NO RESPONSES</div>
            </div>
          </div>
          {digest.topWinningAngles.length > 0 && (
            <div className="text-xs text-zinc-400 mb-1">
              Top Angle: <span className="text-[#00ffff] font-mono">{digest.topWinningAngles[0].angle}</span>
            </div>
          )}
          {digest.recommendedNextActions.slice(0, 2).map((action, idx) => (
            <div key={`digest-action-${idx}`} className="text-[10px] text-zinc-500">• {action}</div>
          ))}
        </div>

        <div className="cyber-panel p-5 border-red-500/20">
          <div className="text-[10px] font-mono text-zinc-500 mb-3">REINSERTION MONITOR</div>
          {reInsertionAlerts.length === 0 ? (
            <div className="text-xs text-[#00ff00]">No reinsertion alerts detected in current timeline window.</div>
          ) : (
            <div className="space-y-2">
              {reInsertionAlerts.slice(0, 3).map((alert) => (
                <div key={`${alert.itemId}-${alert.archivedItemId}`} className="rounded border border-red-500/30 bg-red-500/5 p-2">
                  <div className="text-xs text-red-300 font-bold">{alert.creditorName} {alert.accountMask}</div>
                  <div className="text-[10px] text-zinc-400">Detected after {alert.daysSinceDeletion} day(s) on {alert.impactedBureaus.join(", ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cyber-panel p-5 border-[#ff9900]/20">
        <div className="text-[10px] font-mono text-zinc-500 mb-3">ATTORNEY ESCALATION RADAR</div>
        {attorneyReferrals.length === 0 ? (
          <div className="text-xs text-zinc-500">No accounts currently meet escalation thresholds.</div>
        ) : (
          <div className="space-y-2">
            {attorneyReferrals.map((entry) => {
              const urgencyClass =
                entry.recommendation.urgency === "HIGH"
                  ? "text-red-300 border-red-500/40 bg-red-500/10"
                  : entry.recommendation.urgency === "MEDIUM"
                    ? "text-[#ff9900] border-[#ff9900]/40 bg-[#ff9900]/10"
                    : "text-[#00ff00] border-[#00ff00]/40 bg-[#00ff00]/10";

              return (
                <div key={entry.item.id} className="rounded border border-zinc-800 bg-black/30 p-3">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                    <div>
                      <div className="text-xs font-bold text-white">{entry.item.creditorName}</div>
                      <div className="text-[10px] text-zinc-500">
                        Rounds: {entry.genealogy.totalRoundsRequired} • Outcome: {entry.genealogy.finalOutcome.replace(/_/g, " ")}
                      </div>
                    </div>
                    <span className={`text-[10px] font-mono border rounded px-2 py-0.5 ${urgencyClass}`}>
                      {entry.recommendation.urgency} PRIORITY
                    </span>
                  </div>
                  <div className="mt-2 text-[10px] text-zinc-400">
                    {entry.recommendation.reasons.slice(0, 2).join(" ")}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* V4 Pass Distribution Widget */}
      {(() => {
        const passCounts = [1, 2, 3, 4, 5].map((p) => ({
          pass: p,
          count: negativeItems.filter((i) => i.disputeRound === p).length,
        }));
        const removed = wonItems.length;
        const total = negativeItems.length;
        const successRate = total > 0 ? Math.round((removed / total) * 100) : 0;
        return (
          <div className="cyber-panel p-5">
            <div className="text-[10px] font-mono text-zinc-500 mb-3 flex items-center gap-2">
              <Target size={12} className="text-[#ff9900]" /> V4 PASS DISTRIBUTION
            </div>
            <div className="grid grid-cols-5 gap-2 mb-3">
              {passCounts.map(({ pass, count }) => (
                <div key={pass} className={`rounded border p-2 text-center ${count > 0 ? "border-[#00ffff]/30 bg-[#00ffff]/5" : "border-zinc-800 bg-[#0a0a0a]"}`}>
                  <div className={`text-lg font-bold font-mono ${count > 0 ? "text-[#00ffff]" : "text-zinc-600"}`}>{count}</div>
                  <div className="text-[9px] font-mono text-zinc-500">PASS {pass}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-zinc-500">SUCCESS RATE</span>
              <span className={`font-bold ${successRate >= 50 ? "text-[#00ff00]" : successRate >= 25 ? "text-[#ff9900]" : "text-zinc-400"}`}>
                {removed} REMOVED / {total} TOTAL = {successRate}%
              </span>
            </div>
            <div className="w-full bg-zinc-800 rounded-full h-1.5 mt-2">
              <div className="bg-[#00ff00] h-1.5 rounded-full transition-all" style={{ width: `${successRate}%` }} />
            </div>
          </div>
        );
      })()}

      {/* Active Campaign Banner */}
      {activeCampaign && (
        <div className="cyber-panel p-4 border-[#ff9900]/30 bg-[#ff9900]/5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <Zap size={16} className="text-[#ff9900]" />
              ACTIVE: {activeCampaign.name}
            </div>
            <span className="text-[10px] font-mono text-[#ff9900]">ROUND {activeCampaign.currentRound}/4</span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div className="bg-[#ff9900] h-2 rounded-full"
              style={{ width: `${Math.round((activeCampaign.resolvedItems / Math.max(1, activeCampaign.totalItems)) * 100)}%` }} />
          </div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">
            {activeCampaign.resolvedItems}/{activeCampaign.totalItems} items resolved
          </div>
        </div>
      )}

      {/* Priority negative items preview */}
      {negativeItems.length > 0 && (
        <div className="cyber-panel p-6">
          <h3 className="text-sm font-bold text-zinc-400 mb-3 flex items-center gap-2">
            <ShieldAlert size={14} className="text-red-400" /> TOP PRIORITY ITEMS
          </h3>
          <div className="space-y-2">
            {[...negativeItems].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between text-xs py-2 border-b border-zinc-800/50 last:border-0">
                <div>
                  <span className="font-bold text-white">{item.creditorName}</span>
                  <span className="text-zinc-500 ml-2">{item.typeOfNegative}</span>
                </div>
                <div className="flex items-center gap-3">
                  {item.estimatedScoreImpact && <span className="text-[#00ff00] text-[10px]">{item.estimatedScoreImpact}</span>}
                  <span className={`font-bold font-mono ${item.priorityScore >= 35 ? "text-red-400" : item.priorityScore >= 25 ? "text-[#ff9900]" : "text-zinc-400"}`}>
                    {item.priorityScore}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      <div className="cyber-panel p-6">
        <h3 className="text-sm font-bold text-zinc-400 mb-4 flex items-center gap-2">
          <Award size={14} className="text-[#ff9900]" /> MILESTONES
          <span className="text-[10px] font-mono text-zinc-600 ml-auto">{completedMilestones}/{milestones.length}</span>
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {milestones.map((m) => {
            const Icon = m.icon;
            return (
              <div key={m.label}
                className={`flex items-center gap-2 p-3 rounded-lg border ${m.done ? "border-[#00ff00]/40 bg-[#00ff00]/5" : "border-zinc-800 bg-[#0a0a0a] opacity-50"}`}>
                <Icon size={14} className={m.done ? "text-[#00ff00]" : "text-zinc-600"} />
                <span className={`text-[10px] font-mono leading-tight ${m.done ? "text-white" : "text-zinc-600"}`}>{m.label}</span>
                {m.done && <CheckCircle2 size={12} className="text-[#00ff00] ml-auto shrink-0" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
