import React, { useState, useMemo, useCallback } from "react";
import {
  Target, TrendingUp, CreditCard as CardIcon, Clock, Users,
  Zap, BarChart2, DollarSign, BookOpen, RefreshCw,
  Plus, Trash2, CheckSquare, Activity, AlertTriangle,
  ChevronRight, Award, PieChart, Search,
} from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { CreditCard, HardInquiry, AuthorizedUserAccount } from "../types";
import { v4 as uuidv4 } from "uuid";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDollars(n: number) {
  return "$" + n.toLocaleString();
}

function monthsBetween(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.max(
    0,
    (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
  );
}

function aaoa(cards: { openedDate: string }[], auAccs: { openedDate: string; status: string }[]): number {
  const all = [
    ...cards.map((c) => monthsBetween(c.openedDate)),
    ...auAccs.filter((a) => a.status === "Active").map((a) => monthsBetween(a.openedDate)),
  ];
  if (all.length === 0) return 0;
  return all.reduce((a, b) => a + b, 0) / all.length;
}

function utilPct(balance: number, limit: number): number {
  if (!limit) return 0;
  return Math.round((balance / limit) * 100);
}

function totalUtil(cards: CreditCard[]): { balance: number; limit: number; pct: number } {
  const b = cards.reduce((s, c) => s + c.balance, 0);
  const l = cards.reduce((s, c) => s + c.limit, 0);
  return { balance: b, limit: l, pct: l ? Math.round((b / l) * 100) : 0 };
}

function scoreDeltaFromUtil(currentPct: number, targetPct: number): number {
  // FICO 8 utilization scoring: each 10pp reduction below 30% = ~10-15 pts
  const before = utilImpact(currentPct);
  const after = utilImpact(targetPct);
  return after - before;
}

function utilImpact(pct: number): number {
  if (pct === 0) return 100;
  if (pct <= 9) return 90;
  if (pct <= 29) return 70;
  if (pct <= 49) return 45;
  if (pct <= 74) return 20;
  return 0;
}

function utilColor(pct: number): string {
  if (pct <= 10) return "text-[#00ff00]";
  if (pct <= 30) return "text-[#ff9900]";
  if (pct <= 60) return "text-orange-500";
  return "text-red-400";
}

type CBTab = "score-intel" | "profile" | "build" | "timing";

// ─── Sub-components ────────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, color, title, desc }: { icon: React.ElementType; color: string; title: string; desc?: string }) {
  return (
    <div className="flex items-start gap-2 mb-4">
      <Icon size={16} className={color} />
      <div>
        <h3 className={`text-sm font-bold text-white`}>{title}</h3>
        {desc && <p className="text-[10px] text-zinc-500 font-mono mt-0.5">{desc}</p>}
      </div>
    </div>
  );
}

function ScoreImpactBadge({ delta }: { delta: number }) {
  if (delta === 0) return <span className="text-[10px] text-zinc-500 font-mono">±0 pts</span>;
  const pos = delta > 0;
  return (
    <span className={`text-[11px] font-bold font-mono ${pos ? "text-[#00ff00]" : "text-red-400"}`}>
      {pos ? "+" : ""}{delta} pts
    </span>
  );
}

// ─── Tab: SCORE INTEL ─────────────────────────────────────────────────────

function FicoSimulator({ creditCards, negativeItems, scoreEntries }: any) {
  const latestScore = useMemo(() => {
    if (!scoreEntries.length) return 620;
    const last = [...scoreEntries].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    return last.equifax ?? last.experian ?? last.transunion ?? 620;
  }, [scoreEntries]);

  const [utilTarget, setUtilTarget] = useState(Math.min(utilPct(totalUtil(creditCards).balance, totalUtil(creditCards).limit) || 30, 100));
  const [removeCollections, setRemoveCollections] = useState(0);
  const [addCard, setAddCard] = useState(false);
  const [addInstallment, setAddInstallment] = useState(false);
  const [cleanPayMonths, setCleanPayMonths] = useState(0);

  const { pct: currentUtil } = totalUtil(creditCards);
  const collections = negativeItems.filter((i: any) => i.typeOfNegative?.toLowerCase().includes("collection") || i.typeOfNegative?.toLowerCase().includes("charge-off")).length;

  const projected = useMemo(() => {
    let delta = 0;
    // Utilization impact (30% weight)
    const utilDelta = scoreDeltaFromUtil(currentUtil, utilTarget);
    delta += Math.round(utilDelta * 0.30);
    // Collection removal (+25-50 per removed, depending on recency)
    delta += removeCollections * 38;
    // Adding a secured card: temporarily -5 hard pull, +8 long term
    if (addCard) delta -= 3;
    // Adding installment loan: +mix bonus
    if (addInstallment) delta += 12;
    // Clean payment history months: 24 months halves late payment impact
    if (cleanPayMonths >= 24) delta += 20;
    else if (cleanPayMonths >= 12) delta += 10;
    else if (cleanPayMonths >= 6) delta += 4;
    return Math.min(850, Math.max(300, latestScore + Math.round(delta)));
  }, [latestScore, currentUtil, utilTarget, removeCollections, addCard, addInstallment, cleanPayMonths]);

  const delta = projected - latestScore;

  return (
    <div className="space-y-4">
      <SectionTitle icon={Activity} color="text-[#00ffff]" title="FICO SIMULATOR — WHAT-IF ENGINE"
        desc="Adjust scenarios to see projected score impact using FICO 8 factor weights." />

      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div className="cyber-panel p-4">
            <div className="text-[10px] font-mono text-zinc-500 mb-3">BASELINE SCORE</div>
            <div className="text-4xl font-bold font-mono text-[#ff9900]">{latestScore}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Latest from score log</div>
          </div>

          {/* Utilization slider */}
          <div className="cyber-panel p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[10px] font-mono text-zinc-400">TARGET UTILIZATION: {utilTarget}%</label>
              <ScoreImpactBadge delta={Math.round(scoreDeltaFromUtil(currentUtil, utilTarget) * 0.30)} />
            </div>
            <input type="range" min={0} max={100} value={utilTarget} onChange={(e) => setUtilTarget(Number(e.target.value))}
              className="w-full accent-[#00ffff]" />
            <div className="flex justify-between text-[9px] text-zinc-600 font-mono mt-1">
              <span>Current: {currentUtil}%</span>
              <span>0% → +max points</span>
            </div>
          </div>

          {/* Remove collections */}
          <div className="cyber-panel p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[10px] font-mono text-zinc-400">REMOVE COLLECTIONS: {removeCollections}</label>
              <ScoreImpactBadge delta={removeCollections * 38} />
            </div>
            <input type="range" min={0} max={Math.max(collections, 5)} value={removeCollections} onChange={(e) => setRemoveCollections(Number(e.target.value))}
              className="w-full accent-[#ff9900]" />
            <div className="text-[9px] text-zinc-600 font-mono mt-1">Items eligible: {collections} collections / charge-offs</div>
          </div>

          {/* Clean payment months */}
          <div className="cyber-panel p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-[10px] font-mono text-zinc-400">MONTHS OF CLEAN PAYMENTS: {cleanPayMonths}mo</label>
              <ScoreImpactBadge delta={cleanPayMonths >= 24 ? 20 : cleanPayMonths >= 12 ? 10 : cleanPayMonths >= 6 ? 4 : 0} />
            </div>
            <input type="range" min={0} max={36} value={cleanPayMonths} onChange={(e) => setCleanPayMonths(Number(e.target.value))}
              className="w-full accent-[#00ff00]" />
            <div className="text-[9px] text-zinc-600 font-mono mt-1">24 months → late payments lose ~50% scoring weight</div>
          </div>

          <div className="cyber-panel p-4 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={addCard} onChange={(e) => setAddCard(e.target.checked)} className="accent-[#ff00ff]" />
              <span className="text-[10px] font-mono text-zinc-400">ADD SECURED CARD</span>
              <ScoreImpactBadge delta={addCard ? -3 : 0} />
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={addInstallment} onChange={(e) => setAddInstallment(e.target.checked)} className="accent-[#ff00ff]" />
              <span className="text-[10px] font-mono text-zinc-400">ADD INSTALLMENT LOAN</span>
              <ScoreImpactBadge delta={addInstallment ? 12 : 0} />
            </label>
          </div>
        </div>

        <div className="cyber-panel p-6 flex flex-col items-center justify-center gap-4">
          <div className="text-[10px] font-mono text-zinc-500">PROJECTED SCORE</div>
          <div className="text-7xl font-bold font-mono" style={{ color: projected >= 720 ? "#00ff00" : projected >= 650 ? "#ff9900" : "#ff2200" }}>{projected}</div>
          <div className={`text-2xl font-bold font-mono ${delta >= 0 ? "text-[#00ff00]" : "text-red-400"}`}>
            {delta >= 0 ? "+" : ""}{delta} pts
          </div>
          <div className="w-full space-y-2 mt-2">
            {[
              { label: "Utilization Impact", val: Math.round(scoreDeltaFromUtil(currentUtil, utilTarget) * 0.30), color: "bg-[#00ffff]" },
              { label: "Collection Removals", val: removeCollections * 38, color: "bg-[#ff9900]" },
              { label: "Payment History", val: cleanPayMonths >= 24 ? 20 : cleanPayMonths >= 12 ? 10 : cleanPayMonths >= 6 ? 4 : 0, color: "bg-[#00ff00]" },
              { label: "Credit Mix (Diversify)", val: addInstallment ? 12 : 0, color: "bg-purple-400" },
            ].map((row) => (
              <div key={row.label} className="flex items-center gap-2 text-[10px] font-mono">
                <div className={`w-2 h-2 rounded-full ${row.color}`} />
                <span className="text-zinc-500 flex-1">{row.label}</span>
                <ScoreImpactBadge delta={row.val} />
              </div>
            ))}
          </div>
          <div className="text-[9px] text-zinc-700 font-mono text-center mt-2">Based on FICO 8 factor weights. Actual results may vary.</div>
        </div>
      </div>
    </div>
  );
}

function ScoreTimeline({ negativeItems, scoreEntries }: any) {
  const latestScore = scoreEntries.length > 0
    ? (() => {
        const last = [...scoreEntries].sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        return last.equifax ?? last.experian ?? last.transunion ?? 620;
      })()
    : 620;

  const months = useMemo(() => {
    const pts: { month: number; score: number; label: string }[] = [];
    let score = latestScore;
    const now = new Date();
    for (let m = 0; m <= 24; m++) {
      const d = new Date(now);
      d.setMonth(d.getMonth() + m);
      // Natural aging: +0.5 pts/month from clean payment history
      if (m > 0) score = Math.min(850, score + 0.5);
      // Items that drop off (SOL)
      negativeItems.forEach((item: any) => {
        if (!item.solDropDate) return;
        const drop = new Date(item.solDropDate);
        const itemMonth = (drop.getFullYear() - now.getFullYear()) * 12 + (drop.getMonth() - now.getMonth());
        if (itemMonth === m) {
          const type = item.typeOfNegative?.toLowerCase() || "";
          const gain = type.includes("bankruptcy") ? 50 : type.includes("foreclosure") ? 40 : type.includes("collection") || type.includes("charge-off") ? 35 : type.includes("late") ? 15 : 20;
          score = Math.min(850, score + gain);
        }
      });
      pts.push({ month: m, score: Math.round(score), label: m === 0 ? "Now" : `M+${m}` });
    }
    return pts;
  }, [latestScore, negativeItems]);

  // Simple SVG line chart
  const w = 560; const h = 140; const pad = { l: 40, r: 16, t: 16, b: 30 };
  const scores = months.map((p) => p.score);
  const minS = Math.max(300, Math.min(...scores) - 20);
  const maxS = Math.min(850, Math.max(...scores) + 20);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const pts = months.map((p, i) => ({
    x: pad.l + (i / (months.length - 1)) * innerW,
    y: pad.t + innerH - ((p.score - minS) / Math.max(1, maxS - minS)) * innerH,
    point: p,
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  return (
    <div className="space-y-4">
      <SectionTitle icon={TrendingUp} color="text-[#00ff00]" title="SCORE RECOVERY TIMELINE PROJECTOR"
        desc="Month-by-month projection based on natural aging and SOL item drops. Zero new disputes needed." />

      <div className="cyber-panel p-4">
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[320px]">
            {/* Grid lines */}
            {[300, 580, 670, 740, 800].map((s) => {
              const y = pad.t + innerH - ((s - minS) / Math.max(1, maxS - minS)) * innerH;
              if (y < pad.t || y > pad.t + innerH) return null;
              return (
                <g key={s}>
                  <line x1={pad.l} y1={y} x2={pad.l + innerW} y2={y} stroke="#1f2937" strokeWidth="1" strokeDasharray="4,4" />
                  <text x={pad.l - 4} y={y + 3} fill="#4b5563" fontSize="8" textAnchor="end" fontFamily="monospace">{s}</text>
                </g>
              );
            })}
            {/* SOL drop markers */}
            {negativeItems.filter((i: any) => i.solDropDate).map((item: any) => {
              const drop = new Date(item.solDropDate);
              const now = new Date();
              const m = Math.round((drop.getFullYear() - now.getFullYear()) * 12 + (drop.getMonth() - now.getMonth()));
              if (m < 0 || m > 24) return null;
              const x = pad.l + (m / 24) * innerW;
              return <line key={item.id} x1={x} y1={pad.t} x2={x} y2={pad.t + innerH} stroke="#ff9900" strokeWidth="1" strokeDasharray="2,3" opacity="0.5" />;
            })}
            {/* Path */}
            <path d={pathD} fill="none" stroke="#00ff00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {/* Dots at 0, 6, 12, 18, 24 */}
            {pts.filter((_, i) => i % 6 === 0).map((p) => (
              <g key={p.point.month}>
                <circle cx={p.x} cy={p.y} r={3} fill="#00ff00" />
                <text x={p.x} y={pad.t + innerH + 16} fill="#6b7280" fontSize="8" textAnchor="middle" fontFamily="monospace">{p.point.label}</text>
                <text x={p.x} y={p.y - 8} fill="#00ff00" fontSize="8" textAnchor="middle" fontFamily="monospace">{p.point.score}</text>
              </g>
            ))}
          </svg>
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-[9px] font-mono text-zinc-500">
          <span className="flex items-center gap-1"><div className="w-3 h-px bg-[#00ff00]" /> Projected score</span>
          <span className="flex items-center gap-1"><div className="w-3 h-px border-t border-dashed border-[#ff9900]" /> SOL item drop date</span>
          <span>Total items with SOL date: {negativeItems.filter((i: any) => i.solDropDate).length}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[{ target: 620, label: "Fair" }, { target: 670, label: "Good" }, { target: 720, label: "Very Good" }].map(({ target, label }) => {
          const hit = months.find((m) => m.score >= target);
          return (
            <div key={target} className="cyber-panel p-3 text-center">
              <div className="text-lg font-bold font-mono text-[#ff9900]">{target}</div>
              <div className="text-[9px] text-zinc-500 font-mono">{label}</div>
              <div className="text-[11px] font-bold text-white mt-1">{hit ? (hit.month === 0 ? "Already there" : `M+${hit.month}`) : "24mo+"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Tab: PROFILE ─────────────────────────────────────────────────────────

function CreditMixAnalyzer({ creditCards, auAccounts, negativeItems }: any) {
  const revolving = creditCards.filter((c: CreditCard) => c.type === "revolving").length + auAccounts.filter((a: AuthorizedUserAccount) => a.status === "Active").length;
  const installment = creditCards.filter((c: CreditCard) => c.type === "installment").length;
  const closedAccounts = negativeItems.filter((i: any) => i.status === "Closed").length;
  const total = revolving + installment + closedAccounts;

  const mixScore = total === 0 ? 0 : Math.min(100, (Math.min(revolving, 3) * 20) + (Math.min(installment, 2) * 20) + (closedAccounts > 0 ? 10 : 0));
  const needsInstallment = installment === 0;
  const needsRevolving = revolving < 2;
  const needsClosed = closedAccounts === 0;

  const segments = [
    { label: "Revolving", count: revolving, color: "#00ffff", pct: total ? Math.round((revolving / total) * 100) : 0 },
    { label: "Installment", count: installment, color: "#ff9900", pct: total ? Math.round((installment / total) * 100) : 0 },
    { label: "Closed (History)", count: closedAccounts, color: "#555", pct: total ? Math.round((closedAccounts / total) * 100) : 0 },
  ];

  // Simple donut
  let cumPct = 0;
  const R = 40; const cx = 60; const cy = 60;
  const donutPaths = segments.map((seg) => {
    if (seg.pct === 0) return null;
    const start = (cumPct / 100) * 2 * Math.PI - Math.PI / 2;
    cumPct += seg.pct;
    const end = (cumPct / 100) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + R * Math.cos(start); const y1 = cy + R * Math.sin(start);
    const x2 = cx + R * Math.cos(end); const y2 = cy + R * Math.sin(end);
    const largeArc = seg.pct > 50 ? 1 : 0;
    return <path key={seg.label} d={`M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${largeArc} 1 ${x2} ${y2} Z`} fill={seg.color} opacity="0.85" />;
  });

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={PieChart} color="text-[#00ffff]" title="CREDIT MIX ANALYZER"
        desc="FICO scores best with a mix of revolving (credit cards) + installment (loans) accounts." />
      <div className="flex gap-6 items-center flex-wrap">
        <svg viewBox="0 0 120 120" className="w-28 h-28 shrink-0">
          {total === 0
            ? <circle cx={cx} cy={cy} r={R} fill="#1f2937" />
            : donutPaths}
          <circle cx={cx} cy={cy} r={R * 0.6} fill="#1a1a1a" />
          <text x={cx} y={cy + 4} textAnchor="middle" fill="#fff" fontSize="12" fontWeight="bold" fontFamily="monospace">{mixScore}</text>
          <text x={cx} y={cy + 14} textAnchor="middle" fill="#6b7280" fontSize="7" fontFamily="monospace">MIX SCORE</text>
        </svg>
        <div className="flex-1 space-y-2">
          {segments.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-xs">
              <div className="w-3 h-3 rounded-sm" style={{ background: s.color }} />
              <span className="text-zinc-400 font-mono w-32">{s.label}:</span>
              <span className="text-white font-bold font-mono">{s.count}</span>
              <div className="flex-1 bg-zinc-800 rounded-full h-1.5 max-w-24">
                <div className="h-1.5 rounded-full" style={{ background: s.color, width: `${s.pct}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {(needsInstallment || needsRevolving) && (
        <div className="mt-3 space-y-1">
          <div className="text-[10px] font-mono text-[#ff9900] font-bold">RECOMMENDATIONS:</div>
          {needsRevolving && <div className="text-[10px] text-zinc-400 font-mono">→ Add 1-2 revolving accounts (secured card, store card)</div>}
          {needsInstallment && <div className="text-[10px] text-zinc-400 font-mono">→ Add 1 installment account (credit builder loan, auto loan) for +10-15 pts credit mix boost</div>}
        </div>
      )}
    </div>
  );
}

function AgeOfCreditOptimizer({ creditCards, auAccounts }: any) {
  const currentAAoA = aaoa(creditCards, auAccounts);
  const newAccountImpact = (months: number): number => {
    const allMonths = [
      ...creditCards.map((c: CreditCard) => monthsBetween(c.openedDate)),
      ...auAccounts.filter((a: AuthorizedUserAccount) => a.status === "Active").map((a: AuthorizedUserAccount) => monthsBetween(a.openedDate)),
      months,
    ];
    const newAvg = allMonths.reduce((a, b) => a + b, 0) / allMonths.length;
    return Math.round(currentAAoA - newAvg);
  };

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={Clock} color="text-[#ff9900]" title="AGE OF CREDIT OPTIMIZER"
        desc="Average age of accounts (AAoA) = 15% of FICO score. New accounts reduce it." />
      <div className="flex gap-6 flex-wrap">
        <div>
          <div className="text-[10px] font-mono text-zinc-500">CURRENT AAoA</div>
          <div className="text-3xl font-bold font-mono text-[#ff9900]">{Math.round(currentAAoA)} mo</div>
          <div className="text-[10px] font-mono text-zinc-500">{(currentAAoA / 12).toFixed(1)} years</div>
          <div className="text-[9px] text-zinc-600 font-mono mt-1">{creditCards.length + auAccounts.filter((a: AuthorizedUserAccount) => a.status === "Active").length} accounts total</div>
        </div>
        <div className="flex-1 min-w-48">
          <div className="text-[10px] font-mono text-zinc-400 mb-2">IF YOU OPEN A NEW ACCOUNT TODAY:</div>
          <div className="text-sm font-bold font-mono text-red-400">AAoA drops by {Math.abs(newAccountImpact(0))} months</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-1">Recovers ~1 month per month naturally</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-2 leading-relaxed">
            <strong className="text-white">Best strategy:</strong> Wait until current AAoA is &gt; 24 months before opening new accounts to minimize score dip. Your optimal window:
            {currentAAoA >= 24
              ? <span className="text-[#00ff00]"> ✓ Now (AAoA is healthy)</span>
              : <span className="text-[#ff9900]"> Wait {Math.ceil((24 - currentAAoA))} more months</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AUTracker({ auAccounts, addAUAccount, updateAUAccount, removeAUAccount }: any) {
  const [form, setForm] = useState({ ownerName: "", creditor: "", limit: "", balance: "", openedDate: "", status: "Active" as const });
  const [adding, setAdding] = useState(false);

  const submit = () => {
    if (!form.creditor || !form.limit) return;
    addAUAccount({ id: uuidv4(), ownerName: form.ownerName, creditor: form.creditor, limit: Number(form.limit), balance: Number(form.balance || 0), openedDate: form.openedDate || new Date().toISOString().split("T")[0], status: form.status });
    setForm({ ownerName: "", creditor: "", limit: "", balance: "", openedDate: "", status: "Active" });
    setAdding(false);
  };

  return (
    <div className="cyber-panel p-5">
      <div className="flex justify-between items-start mb-4">
        <SectionTitle icon={Users} color="text-[#ff00ff]" title="AUTHORIZED USER TRACKER"
          desc="Inherit age + limit from a family member's account. Best: oldest account + highest limit + lowest util." />
        <button onClick={() => setAdding(!adding)} className="cyber-button text-[10px] border-[#ff00ff]/50 text-[#ff00ff] px-2 py-1 hover:bg-[#ff00ff]/10"><Plus size={10} /> ADD</button>
      </div>

      {adding && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-4 text-[10px]">
          {[["ownerName", "Owner (e.g. Mom)"], ["creditor", "Creditor"], ["limit", "Credit Limit"], ["balance", "Balance"], ["openedDate", "Opened Date (YYYY-MM-DD)"]].map(([key, ph]) => (
            <input key={key} placeholder={ph} value={(form as any)[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded" />
          ))}
          <button onClick={submit} className="cyber-button border-[#ff00ff]/50 text-[#ff00ff] text-[10px] py-1.5 hover:bg-[#ff00ff]/10">SAVE</button>
        </div>
      )}

      {auAccounts.length === 0
        ? <p className="text-zinc-600 text-xs text-center py-4">No AU accounts added yet. Add accounts where you're an authorized user.</p>
        : auAccounts.map((acc: AuthorizedUserAccount) => {
          const u = utilPct(acc.balance, acc.limit);
          const age = monthsBetween(acc.openedDate);
          const benefit = age + Math.round((100 - u) / 10) + Math.round(acc.limit / 500); // simple benefit score
          return (
            <div key={acc.id} className="flex items-center justify-between p-3 bg-[#0a0a0a] border border-[#ff00ff]/20 rounded mb-2">
              <div>
                <div className="text-xs font-bold text-white">{acc.creditor} <span className="text-zinc-500 font-normal">via {acc.ownerName}</span></div>
                <div className="text-[9px] font-mono text-zinc-500">
                  {fmtDollars(acc.limit)} limit | {u}% util | {Math.round(age / 12)}yr {age % 12}mo old | Benefit Score: {benefit}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] font-mono px-1 rounded border ${acc.status === "Active" ? "text-[#00ff00] border-[#00ff00]/30" : "text-zinc-600 border-zinc-700"}`}>{acc.status}</span>
                <button onClick={() => removeAUAccount(acc.id)} className="text-zinc-600 hover:text-red-400"><Trash2 size={12} /></button>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

function ThinFileRoadmap({ creditCards, auAccounts }: any) {
  const totalAccounts = creditCards.length + auAccounts.filter((a: AuthorizedUserAccount) => a.status === "Active").length;
  const hasSecured = creditCards.some((c: CreditCard) => c.limit <= 500 && c.type === "revolving");
  const hasInstallment = creditCards.some((c: CreditCard) => c.type === "installment");
  const hasAU = auAccounts.some((a: AuthorizedUserAccount) => a.status === "Active");
  const hasStoreCard = creditCards.length >= 2;

  const steps = [
    { label: "Open a Secured Card ($200+ deposit)", done: hasSecured, detail: "OpenSky, Discover Secured, Capital One Secured. Use for 6 months before applying elsewhere.", impact: "+25-35 pts" },
    { label: "Apply as Authorized User on someone's account", done: hasAU, detail: "Inherits the account's age, limit, and payment history instantly.", impact: "+15-30 pts" },
    { label: "Open a Credit Builder Loan", done: hasInstallment, detail: "Self ($25/mo), CreditStrong, or local credit union. Adds installment tradeline.", impact: "+10-20 pts" },
    { label: "Apply for a Store Card (after 6 months)", done: hasStoreCard, detail: "Target, Amazon, Walmart. Easier approval, becomes second revolving account.", impact: "+5-15 pts" },
    { label: "Request CLI or unsecured upgrade (12-18 months)", done: totalAccounts >= 4, detail: "Once profile is established, most secured cards graduate or issuers extend unsecured credit.", impact: "+5-10 pts" },
  ];

  const done = steps.filter((s) => s.done).length;

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={Target} color="text-[#00ff00]" title="THIN FILE BUILDER ROADMAP"
        desc={`You have ${totalAccounts} open accounts. ${totalAccounts < 5 ? `Build to at least 5 for full scoring.` : `Profile is established.`}`} />
      <div className="space-y-2">
        {steps.map((step, i) => (
          <div key={i} className={`flex items-start gap-3 p-3 rounded border ${step.done ? "border-[#00ff00]/20 bg-[#00ff00]/5" : "border-zinc-800"}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5 shrink-0 ${step.done ? "bg-[#00ff00] text-black" : "bg-zinc-800 text-zinc-500"}`}>
              {step.done ? "✓" : i + 1}
            </div>
            <div className="flex-1">
              <div className={`text-xs font-bold ${step.done ? "text-[#00ff00]" : "text-white"}`}>{step.label}</div>
              <div className="text-[9px] text-zinc-500 font-mono mt-0.5">{step.detail}</div>
            </div>
            <span className="text-[10px] font-bold text-[#00ff00] font-mono shrink-0">{step.impact}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 bg-zinc-800 rounded-full h-2"><div className="bg-[#00ff00] h-2 rounded-full transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <span className="text-[10px] font-mono text-zinc-400">{done}/{steps.length} complete</span>
      </div>
    </div>
  );
}

// ─── Tab: BUILD ─────────────────────────────────────────────────────────────

function SecuredCardROI() {
  const [deposit, setDeposit] = useState(300);
  const ISSUERS = [
    { name: "OpenSky Secured", graduateMonths: null, hardPull: false, fee: 35 },
    { name: "Capital One Secured", graduateMonths: 12, hardPull: true, fee: 0 },
    { name: "Discover It Secured", graduateMonths: 10, hardPull: true, fee: 0 },
    { name: "Self Secured Card", graduateMonths: 18, hardPull: false, fee: 25 },
  ];
  const utilAt10 = deposit * 0.10;
  const score6mo = 15; const score12mo = 30; const score18mo = 45;

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={CardIcon} color="text-[#00ffff]" title="SECURED CARD ROI CALCULATOR"
        desc="Deposit as low as $200. Models score gain, graduation timeline, and issuer comparison." />
      <div className="flex gap-4 flex-wrap items-end mb-4">
        <div>
          <label className="text-[10px] font-mono text-zinc-400 block mb-1">DEPOSIT AMOUNT</label>
          <input type="number" value={deposit} onChange={(e) => setDeposit(Number(e.target.value))} min={200} max={5000}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm font-mono px-3 py-2 rounded w-28" />
        </div>
        <div className="text-[10px] font-mono text-zinc-500">
          Keep balance ≤ {fmtDollars(utilAt10)} (10% util) for max score benefit
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        {[{ t: "+6 months", v: score6mo }, { t: "+12 months", v: score12mo }, { t: "+18 months", v: score18mo }].map(({ t, v }) => (
          <div key={t} className="bg-[#0a0a0a] border border-zinc-800 rounded p-3 text-center">
            <div className="text-[9px] font-mono text-zinc-500">{t}</div>
            <div className="text-xl font-bold font-mono text-[#00ff00]">+{v} pts</div>
            <div className="text-[9px] text-zinc-600 font-mono">est. score gain</div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-[10px] font-mono text-zinc-400 mb-1">ISSUER COMPARISON:</div>
        {ISSUERS.map((iss) => (
          <div key={iss.name} className="flex items-center justify-between p-2 bg-[#0a0a0a] border border-zinc-800 rounded text-[10px] font-mono">
            <span className="text-zinc-300">{iss.name}</span>
            <span className="text-zinc-500">Annual Fee: {iss.fee === 0 ? "None" : `$${iss.fee}`}</span>
            <span className="text-zinc-500">Hard Pull: {iss.hardPull ? "Yes" : "No"}</span>
            <span className={iss.graduateMonths ? "text-[#00ff00]" : "text-zinc-600"}>
              Graduate: {iss.graduateMonths ? `${iss.graduateMonths}mo` : "Never"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreditBuilderLoanSim() {
  const [amount, setAmount] = useState(500);
  const [term, setTerm] = useState<12 | 24>(12);
  const [currentInstallment, setCurrentInstallment] = useState(0);
  const apr = 0.10;
  const monthly = (amount * (apr / 12)) / (1 - Math.pow(1 + apr / 12, -term));
  const totalPaid = monthly * term;
  const interest = totalPaid - amount;
  const costPerPoint = interest / (currentInstallment === 0 ? 15 : 8);
  const mixGain = currentInstallment === 0 ? 15 : 8;

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={DollarSign} color="text-[#ff9900]" title="CREDIT BUILDER LOAN SIMULATOR"
        desc="Installment loans diversify credit mix. Payment history accumulates with every on-time payment." />
      <div className="grid sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[10px] font-mono text-zinc-400 block mb-1">LOAN AMOUNT</label>
          <input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} min={300} max={2500}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded w-full" />
        </div>
        <div>
          <label className="text-[10px] font-mono text-zinc-400 block mb-1">TERM</label>
          <select value={term} onChange={(e) => setTerm(Number(e.target.value) as 12 | 24)}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded w-full">
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
          </select>
        </div>
        <div>
          <label className="text-[10px] font-mono text-zinc-400 block mb-1">EXISTING INSTALLMENT ACCOUNTS</label>
          <select value={currentInstallment} onChange={(e) => setCurrentInstallment(Number(e.target.value))}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded w-full">
            <option value={0}>None (thin file)</option>
            <option value={1}>1 existing</option>
            <option value={2}>2+ existing</option>
          </select>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          { label: "Monthly Payment", value: `$${monthly.toFixed(2)}`, color: "text-white" },
          { label: "Total Interest Paid", value: `$${interest.toFixed(2)}`, color: "text-[#ff9900]" },
          { label: "Estimated Score Gain (Mix)", value: `+${mixGain} pts`, color: "text-[#00ff00]" },
          { label: "Cost Per Point", value: `$${costPerPoint.toFixed(2)}`, color: "text-zinc-400" },
          { label: "Payment History Entries", value: `${term} on-time marks`, color: "text-[#00ffff]" },
          { label: "Break-even (score gain value)", value: mixGain >= 12 ? "Excellent ROI" : "Good ROI", color: "text-[#00ff00]" },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex justify-between p-2 bg-[#0a0a0a] border border-zinc-800 rounded text-[10px] font-mono">
            <span className="text-zinc-500">{label}</span>
            <span className={`font-bold ${color}`}>{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[10px] font-mono text-zinc-500">Recommended: Self ($25/mo min), CreditStrong, or local credit union. Lock funds into savings — you get them back at maturity.</div>
    </div>
  );
}

function PaymentHistoryStreak({ negativeItems, creditCards }: any) {
  const latePays = negativeItems.filter((i: any) =>
    i.typeOfNegative?.toLowerCase().includes("late") || i.typeOfNegative?.toLowerCase().includes("30-day") || i.typeOfNegative?.toLowerCase().includes("60-day")
  );

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={Award} color="text-[#00ff00]" title="PAYMENT HISTORY STREAK ENGINE"
        desc="Payment history = 35% of FICO. Late payments lose impact after 24 months of clean history." />
      {latePays.length === 0
        ? <div className="text-[#00ff00] text-sm font-mono text-center py-4">✓ No late payments detected. Payment history is clean.</div>
        : latePays.map((item: any) => {
          const monthsAgo = item.dateOfLastReporting ? monthsBetween(item.dateOfLastReporting) : 0;
          const pctNeutralized = Math.min(100, Math.round((monthsAgo / 24) * 50));
          const monthsToHalf = Math.max(0, 24 - monthsAgo);
          const monthsToFull = Math.max(0, 84 - monthsAgo);
          return (
            <div key={item.id} className="bg-[#0a0a0a] border border-zinc-800 rounded p-3 mb-3">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-bold text-white">{item.creditorName} — {item.typeOfNegative}</div>
                <span className="text-[9px] font-mono text-zinc-500">{monthsAgo}mo ago</span>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 bg-zinc-800 rounded-full h-1.5">
                  <div className="bg-[#00ff00] h-1.5 rounded-full" style={{ width: `${pctNeutralized}%` }} />
                </div>
                <span className="text-[9px] text-[#00ff00] font-mono">{pctNeutralized}% neutralized</span>
              </div>
              <div className="text-[9px] text-zinc-500 font-mono">
                {monthsToHalf > 0 ? `${monthsToHalf} more months → 50% impact reduction` : "✓ 50% reduction achieved"}
                {" | "}
                {monthsToFull > 0 ? `${monthsToFull} months → removed from report (7yr SOL)` : "✓ Should have dropped off"}
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

function ExperianBoostTracker({ boostPrograms, updateBoostProgram }: any) {
  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={Zap} color="text-[#ff00ff]" title="EXPERIAN BOOST & PROGRAM TRACKER"
        desc="Add alternative data to your credit file. Some programs can add 10-30 pts without disputing anything." />
      <div className="space-y-3">
        {boostPrograms.map((prog: any) => (
          <div key={prog.id} className={`p-3 border rounded ${prog.enrolled ? "border-[#ff00ff]/30 bg-[#ff00ff]/5" : "border-zinc-800"}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-bold text-white">{prog.name}</div>
                <div className="text-[9px] text-zinc-500 font-mono">{prog.bureau} · {prog.notes}</div>
              </div>
              <div className="flex items-center gap-3">
                {prog.enrolled && (
                  <div>
                    <label className="text-[9px] font-mono text-zinc-500 block">EST POINTS</label>
                    <input type="number" value={prog.estimatedPoints} onChange={(e) => updateBoostProgram(prog.id, { estimatedPoints: Number(e.target.value) })}
                      className="bg-zinc-900 border border-zinc-700 text-[#ff00ff] text-[10px] font-mono px-2 py-0.5 rounded w-16" />
                  </div>
                )}
                <button onClick={() => updateBoostProgram(prog.id, { enrolled: !prog.enrolled })}
                  className={`relative w-10 h-5 rounded-full transition-all ${prog.enrolled ? "bg-[#ff00ff]" : "bg-zinc-700"}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${prog.enrolled ? "left-5" : "left-0.5"}`} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 p-3 bg-[#0a0a0a] border border-zinc-800 rounded text-[10px] font-mono text-zinc-500">
        <strong className="text-white">Total Estimated Boost:</strong> +{boostPrograms.filter((p: any) => p.enrolled).reduce((s: number, p: any) => s + p.estimatedPoints, 0)} pts<br />
        Experian Boost: connect utility/streaming bills at experian.com/boost. Takes 5 minutes. Immediate score update.
      </div>
      <div className="mt-2 text-[10px] font-mono text-zinc-600">
        <strong className="text-zinc-400">Rapid Rescore route:</strong> Pay down a balance → get statement → go to a mortgage broker → request rapid rescore → bureau updates in 3-7 business days instead of 30-45 for reporting cycle. Only available through a licensed mortgage professional.
      </div>
    </div>
  );
}

// ─── Tab: TIMING & PAYOFF ─────────────────────────────────────────────────

function UtilizationWarRoom({ creditCards, addCreditCard, updateCreditCard, removeCreditCard }: any) {
  const [form, setForm] = useState({ name: "", issuer: "", limit: "", balance: "", apr: "", openedDate: "" });
  const [adding, setAdding] = useState(false);
  const [paydown, setPaydown] = useState(500);

  const { balance: totBal, limit: totLim, pct: totPct } = totalUtil(creditCards);

  const submit = () => {
    if (!form.name || !form.limit) return;
    addCreditCard({ id: uuidv4(), name: form.name, issuer: form.issuer, type: "revolving", limit: Number(form.limit), balance: Number(form.balance || 0), apr: Number(form.apr || 24), openedDate: form.openedDate || new Date().toISOString().split("T")[0] });
    setForm({ name: "", issuer: "", limit: "", balance: "", apr: "", openedDate: "" });
    setAdding(false);
  };

  // Which card to pay first for max score gain (highest utilization that's >30%)
  const payOrder = [...creditCards].sort((a: CreditCard, b: CreditCard) => utilPct(b.balance, b.limit) - utilPct(a.balance, a.limit));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <SectionTitle icon={BarChart2} color="text-[#00ffff]" title="UTILIZATION WAR ROOM"
          desc="Per-card tracking. Hit 9% overall for maximum score benefit." />
        <button onClick={() => setAdding(!adding)} className="cyber-button text-[10px] border-[#00ffff]/50 text-[#00ffff] px-2 py-1 hover:bg-[#00ffff]/10"><Plus size={10} /> CARD</button>
      </div>

      {adding && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px] cyber-panel p-3">
          {[["name", "Card Name"], ["issuer", "Issuer"], ["limit", "Credit Limit $"], ["balance", "Current Balance $"], ["apr", "APR %"], ["openedDate", "Opened (YYYY-MM-DD)"]].map(([k, ph]) => (
            <input key={k} placeholder={ph} value={(form as any)[k]} onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded" />
          ))}
          <button onClick={submit} className="cyber-button border-[#00ffff]/50 text-[#00ffff] text-[10px] py-1.5">SAVE</button>
        </div>
      )}

      {/* Total utilization */}
      <div className="cyber-panel p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-[10px] font-mono text-zinc-400">TOTAL UTILIZATION</span>
          <span className={`text-xl font-bold font-mono ${utilColor(totPct)}`}>{totPct}%</span>
        </div>
        <div className="w-full bg-zinc-800 rounded-full h-3">
          <div className={`h-3 rounded-full transition-all ${totPct <= 10 ? "bg-[#00ff00]" : totPct <= 30 ? "bg-[#ff9900]" : "bg-red-500"}`} style={{ width: `${Math.min(100, totPct)}%` }} />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-zinc-600 mt-1">
          <span>{fmtDollars(totBal)} used</span>
          <span>{fmtDollars(totLim)} total limit</span>
        </div>
        {totPct > 9 && (
          <div className="mt-2 text-[10px] font-mono text-[#ff9900]">
            Pay down ${Math.max(0, totBal - Math.round(totLim * 0.09)).toLocaleString()} to reach 9% threshold
            {" | "}Pay ${Math.max(0, totBal - Math.round(totLim * 0.29)).toLocaleString()} to reach 29%
          </div>
        )}
      </div>

      {/* Per card */}
      <div className="space-y-2">
        {payOrder.map((card: CreditCard) => {
          const u = utilPct(card.balance, card.limit);
          const toNine = Math.max(0, card.balance - Math.round(card.limit * 0.09));
          return (
            <div key={card.id} className={`p-3 border rounded bg-[#0a0a0a] ${u > 30 ? "border-red-500/30" : u > 9 ? "border-[#ff9900]/30" : "border-[#00ff00]/20"}`}>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between items-center mb-1">
                    <div className="text-xs font-bold text-white">{card.name}</div>
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-bold font-mono ${utilColor(u)}`}>{u}%</span>
                      <button onClick={() => removeCreditCard(card.id)} className="text-zinc-700 hover:text-red-400"><Trash2 size={11} /></button>
                    </div>
                  </div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5 mb-1">
                    <div className={`h-1.5 rounded-full ${u <= 9 ? "bg-[#00ff00]" : u <= 30 ? "bg-[#ff9900]" : "bg-red-500"}`} style={{ width: `${Math.min(100, u)}%` }} />
                  </div>
                  <div className="flex items-center gap-4 text-[9px] font-mono text-zinc-500">
                    <span>{fmtDollars(card.balance)} / {fmtDollars(card.limit)}</span>
                    {toNine > 0 && <span className="text-[#ff9900]">Pay ${toNine.toLocaleString()} → 9%</span>}
                    <span>APR: {card.apr}%</span>
                  </div>
                </div>
              </div>
              {/* Inline balance editor */}
              <div className="flex gap-2 mt-2">
                <input type="number" defaultValue={card.balance} onBlur={(e) => updateCreditCard(card.id, { balance: Number(e.target.value) })}
                  className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[9px] font-mono px-2 py-0.5 rounded w-24" placeholder="Update balance" />
                <span className="text-[9px] text-zinc-600 font-mono self-center">← update balance</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Paydown optimizer */}
      {creditCards.length > 1 && (
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-400 mb-2">PAYDOWN OPTIMIZER — Enter available payment:</div>
          <div className="flex gap-3 items-center flex-wrap">
            <input type="number" value={paydown} onChange={(e) => setPaydown(Number(e.target.value))}
              className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm font-mono px-3 py-2 rounded w-28" />
            <div className="text-[10px] font-mono text-zinc-500">
              Best target: <strong className="text-[#00ffff]">{payOrder[0]?.name || "—"}</strong> (highest utilization = biggest score gain per dollar)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function HardInquiryFadeTimer({ hardInquiries, addHardInquiry, removeHardInquiry }: any) {
  const [form, setForm] = useState({ creditor: "", purpose: "credit-card", bureau: "Equifax", date: "" });
  const [adding, setAdding] = useState(false);

  const submit = () => {
    if (!form.creditor || !form.date) return;
    addHardInquiry({ id: uuidv4(), creditor: form.creditor, purpose: form.purpose as HardInquiry["purpose"], bureau: form.bureau, date: form.date });
    setForm({ creditor: "", purpose: "credit-card", bureau: "Equifax", date: "" });
    setAdding(false);
  };

  const now = new Date();

  // Group rate-shopping inquiries (same purpose within 14 days)
  const grouped = hardInquiries.reduce((acc: any, inq: HardInquiry) => {
    if (inq.purpose !== "auto" && inq.purpose !== "mortgage") { acc.push([inq]); return acc; }
    const window14 = 14 * 24 * 60 * 60 * 1000;
    const existing = acc.find((g: HardInquiry[]) =>
      g[0].purpose === inq.purpose &&
      Math.abs(new Date(g[0].date).getTime() - new Date(inq.date).getTime()) <= window14
    );
    if (existing) { existing.push(inq); } else { acc.push([inq]); }
    return acc;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <SectionTitle icon={Search} color="text-zinc-400" title="HARD INQUIRY FADE TIMER"
          desc="Hard inquiries reduce score for 12 months, removed at 24 months. Rate-shopping in 14-day window counts as 1." />
        <button onClick={() => setAdding(!adding)} className="cyber-button text-[10px] border-zinc-600 text-zinc-400 px-2 py-1"><Plus size={10} /> INQUIRY</button>
      </div>

      {adding && (
        <div className="grid grid-cols-2 gap-2 cyber-panel p-3 text-[10px]">
          <input placeholder="Creditor name" value={form.creditor} onChange={(e) => setForm((f) => ({ ...f, creditor: e.target.value }))}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded" />
          <input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded" />
          <select value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded">
            {["credit-card", "auto", "mortgage", "personal-loan", "other"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={form.bureau} onChange={(e) => setForm((f) => ({ ...f, bureau: e.target.value }))}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded">
            {["Equifax", "Experian", "TransUnion"].map((b) => <option key={b}>{b}</option>)}
          </select>
          <button onClick={submit} className="cyber-button border-zinc-600 text-zinc-300 text-[10px] py-1.5 col-span-2">SAVE</button>
        </div>
      )}

      {hardInquiries.length === 0
        ? <p className="text-zinc-600 text-xs text-center py-4">No hard inquiries logged. Add inquiries to track their expiration dates.</p>
        : grouped.map((group: HardInquiry[], gi: number) => {
          const primary = group[0];
          const daysOld = Math.round((now.getTime() - new Date(primary.date).getTime()) / (1000 * 60 * 60 * 24));
          const daysToScoreExpiry = Math.max(0, 365 - daysOld);
          const daysToRemoval = Math.max(0, 730 - daysOld);
          const isExpired = daysOld >= 365;
          const isGrouped = group.length > 1;
          return (
            <div key={gi} className={`p-3 border rounded bg-[#0a0a0a] ${isExpired ? "border-zinc-800 opacity-60" : "border-zinc-700"}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-bold text-white">
                    {primary.creditor}
                    {isGrouped && <span className="ml-2 text-[9px] text-[#00ffff] border border-[#00ffff]/30 px-1 rounded">RATE-SHOP ×{group.length} → counted as 1</span>}
                  </div>
                  <div className="text-[9px] font-mono text-zinc-500">{primary.bureau} · {primary.purpose} · {primary.date}</div>
                </div>
                <button onClick={() => group.forEach((i) => removeHardInquiry(i.id))} className="text-zinc-700 hover:text-red-400 ml-2"><Trash2 size={11} /></button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <div className="text-[9px] font-mono text-zinc-500 mb-0.5">SCORING IMPACT EXPIRES</div>
                  {isExpired
                    ? <div className="text-[10px] text-[#00ff00] font-mono">✓ No longer impacting score</div>
                    : <>
                      <div className="w-full bg-zinc-800 rounded-full h-1.5"><div className="bg-[#ff9900] h-1.5 rounded-full" style={{ width: `${(daysOld / 365) * 100}%` }} /></div>
                      <div className="text-[9px] font-mono text-[#ff9900] mt-0.5">{daysToScoreExpiry} days left</div>
                    </>}
                </div>
                <div>
                  <div className="text-[9px] font-mono text-zinc-500 mb-0.5">REMOVED FROM REPORT</div>
                  <div className="w-full bg-zinc-800 rounded-full h-1.5"><div className="bg-zinc-500 h-1.5 rounded-full" style={{ width: `${(daysOld / 730) * 100}%` }} /></div>
                  <div className="text-[9px] font-mono text-zinc-400 mt-0.5">{daysToRemoval} days left</div>
                </div>
              </div>
            </div>
          );
        })
      }
    </div>
  );
}

function CLIScheduler({ creditCards, updateCreditCard }: any) {
  const ISSUER_CLI: Record<string, { pull: "hard" | "soft"; minMonths: number; notes: string }> = {
    "american express": { pull: "soft", minMonths: 6, notes: "Request online — soft pull up to $3k, hard for larger" },
    "capital one": { pull: "hard", minMonths: 6, notes: "Automatic CLI reviews every 6 months; requesting triggers hard pull" },
    "chase": { pull: "hard", minMonths: 12, notes: "Chase 5/24 rule applies. CLI every 12 months" },
    "discover": { pull: "soft", minMonths: 12, notes: "Online CLI usually soft pull" },
    "citibank": { pull: "hard", minMonths: 6, notes: "Hard pull for manual CLI requests" },
    "bank of america": { pull: "soft", minMonths: 6, notes: "Often soft pull online" },
  };

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={TrendingUp} color="text-[#00ff00]" title="CREDIT LIMIT INCREASE SCHEDULER"
        desc="Higher limits = lower utilization. Most issuers allow CLI every 6-12 months." />
      {creditCards.length === 0
        ? <p className="text-zinc-600 text-xs text-center py-4">Add credit cards in Utilization War Room first.</p>
        : creditCards.filter((c: CreditCard) => c.type === "revolving").map((card: CreditCard) => {
          const ageMonths = monthsBetween(card.openedDate);
          const lastCLI = card.cliRequestedDate ? monthsBetween(card.cliRequestedDate) : ageMonths;
          const issuerKey = Object.keys(ISSUER_CLI).find((k) => card.issuer?.toLowerCase().includes(k));
          const issuerData = issuerKey ? ISSUER_CLI[issuerKey] : { pull: "hard" as const, minMonths: 6, notes: "Request by phone or online" };
          const ready = lastCLI >= issuerData.minMonths;
          return (
            <div key={card.id} className={`p-3 border rounded mb-2 ${ready ? "border-[#00ff00]/30 bg-[#00ff00]/5" : "border-zinc-800"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{card.name} — <span className="text-zinc-400">{card.issuer}</span></div>
                  <div className="text-[9px] font-mono text-zinc-500">{fmtDollars(card.limit)} current | Opened {ageMonths}mo ago | {issuerData.pull === "soft" ? "✓ Soft Pull" : "⚠ Hard Pull"}</div>
                  <div className="text-[9px] font-mono text-zinc-600">{issuerData.notes}</div>
                </div>
                {ready
                  ? <button onClick={() => updateCreditCard(card.id, { cliRequestedDate: new Date().toISOString().split("T")[0] })}
                    className="cyber-button text-[9px] border-[#00ff00]/50 text-[#00ff00] px-2 py-1 hover:bg-[#00ff00]/10">MARK REQUESTED</button>
                  : <span className="text-[9px] font-mono text-zinc-600">{Math.max(0, issuerData.minMonths - lastCLI)}mo to go</span>}
              </div>
              {card.cliRequestedDate && (
                <div className="text-[9px] font-mono text-[#00ffff] mt-1">Last requested: {card.cliRequestedDate}</div>
              )}
            </div>
          );
        })
      }
    </div>
  );
}

function DebtOptimizer({ creditCards }: any) {
  const [extraPayment, setExtraPayment] = useState(200);

  const debts = creditCards.filter((c: CreditCard) => c.balance > 0);
  if (debts.length === 0) return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={DollarSign} color="text-[#ff9900]" title="DEBT AVALANCHE VS SNOWBALL" desc="Add cards with balances in Utilization War Room first." />
      <p className="text-zinc-600 text-xs text-center py-4">No cards with balances found.</p>
    </div>
  );

  const calcPayoff = (sortedDebts: CreditCard[], extra: number) => {
    const balances = sortedDebts.map((d) => ({ ...d, bal: d.balance }));
    let months = 0;
    let totalInterest = 0;
    while (balances.some((d) => d.bal > 0) && months < 360) {
      months++;
      let remaining = extra;
      balances.forEach((d) => {
        if (d.bal <= 0) return;
        const monthlyRate = d.apr / 100 / 12;
        const interest = d.bal * monthlyRate;
        totalInterest += interest;
        d.bal += interest;
        const minPay = Math.max(25, d.bal * 0.02);
        const pay = Math.min(d.bal, minPay);
        d.bal -= pay;
      });
      const target = balances.find((d) => d.bal > 0);
      if (target && remaining > 0) {
        const pay = Math.min(target.bal, remaining);
        target.bal -= pay;
      }
    }
    return { months, totalInterest: Math.round(totalInterest) };
  };

  const avalanche = [...debts].sort((a, b) => b.apr - a.apr);
  const snowball = [...debts].sort((a, b) => a.balance - b.balance);
  const hybrid = [...debts].sort((a, b) => utilPct(b.balance, b.limit) - utilPct(a.balance, a.limit));

  const avRes = calcPayoff(avalanche, extraPayment);
  const sbRes = calcPayoff(snowball, extraPayment);
  const hybRes = calcPayoff(hybrid, extraPayment);

  const strategies = [
    { name: "Avalanche (Highest APR)", data: avRes, color: "#ff9900", desc: "Minimizes total interest" },
    { name: "Snowball (Smallest Balance)", data: sbRes, color: "#00ffff", desc: "Fastest psychological wins" },
    { name: "Hybrid (Score Optimized)", data: hybRes, color: "#00ff00", desc: "Drops utilization fastest → best score gain per dollar" },
  ];

  const fastest = strategies.reduce((a, b) => a.data.months < b.data.months ? a : b);
  const cheapest = strategies.reduce((a, b) => a.data.totalInterest < b.data.totalInterest ? a : b);

  return (
    <div className="cyber-panel p-5">
      <SectionTitle icon={DollarSign} color="text-[#ff9900]" title="DEBT AVALANCHE VS SNOWBALL — SCORE OPTIMIZER"
        desc="Compare payoff strategies by interest saved AND score impact timeline." />
      <div className="flex gap-3 items-end mb-4 flex-wrap">
        <div>
          <label className="text-[10px] font-mono text-zinc-400 block mb-1">EXTRA MONTHLY PAYMENT</label>
          <input type="number" value={extraPayment} onChange={(e) => setExtraPayment(Number(e.target.value))} min={50} max={5000}
            className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-sm font-mono px-3 py-2 rounded w-28" />
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {strategies.map(({ name, data, color, desc }) => (
          <div key={name} className="bg-[#0a0a0a] border border-zinc-800 rounded p-3">
            <div className="text-[10px] font-bold font-mono" style={{ color }}>{name}</div>
            <div className="text-[9px] text-zinc-500 font-mono mb-2">{desc}</div>
            <div className="text-2xl font-bold font-mono text-white">{data.months}mo</div>
            <div className="text-[10px] text-zinc-400 font-mono">${data.totalInterest.toLocaleString()} total interest</div>
            {fastest.name === name && <div className="text-[9px] text-[#00ff00] font-mono mt-1">✓ FASTEST PAYOFF</div>}
            {cheapest.name === name && <div className="text-[9px] text-[#00ffff] font-mono mt-1">✓ CHEAPEST</div>}
            {name.includes("Hybrid") && <div className="text-[9px] text-[#00ff00] font-mono mt-1">★ BEST FOR SCORE</div>}
          </div>
        ))}
      </div>
      <div className="mt-3 p-3 bg-[#0a0a0a] border border-[#00ff00]/20 rounded text-[10px] font-mono">
        <strong className="text-[#00ff00]">Recommendation:</strong> Use the <strong className="text-white">Hybrid (Score Optimized)</strong> strategy — pay down the highest-utilization card first regardless of APR. Each dollar reduces your utilization ratio, which is 30% of your FICO score. This produces faster score gains than either pure avalanche or snowball.
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export function CreditBuilder() {
  const {
    creditCards, hardInquiries, auAccounts, boostPrograms,
    addCreditCard, updateCreditCard, removeCreditCard,
    addHardInquiry, removeHardInquiry,
    addAUAccount, updateAUAccount, removeAUAccount,
    updateBoostProgram,
    negativeItems, scoreEntries,
  } = useAppContext();

  const [activeTab, setActiveTab] = useState<CBTab>("score-intel");

  const tabs: { id: CBTab; label: string; icon: React.ElementType; color: string }[] = [
    { id: "score-intel", label: "SCORE INTEL", icon: Activity, color: "text-[#00ffff]" },
    { id: "profile", label: "CREDIT PROFILE", icon: PieChart, color: "text-[#ff9900]" },
    { id: "build", label: "BUILD TOOLS", icon: Target, color: "text-[#00ff00]" },
    { id: "timing", label: "TIMING & PAYOFF", icon: Clock, color: "text-[#ff00ff]" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Target className="text-[#00ff00]" /> CREDIT BUILDER COMMAND CENTER
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          15 tools to actively BUILD your score — no disputes needed. FICO 8 optimized.
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Credit Cards", value: creditCards.length, color: "text-[#00ffff]" },
          { label: "Total Utilization", value: `${totalUtil(creditCards).pct}%`, color: utilColor(totalUtil(creditCards).pct) },
          { label: "Hard Inquiries", value: hardInquiries.filter((i: HardInquiry) => { const d = new Date(i.date); const days = (new Date().getTime() - d.getTime()) / (1000 * 60 * 60 * 24); return days < 365; }).length + " active", color: "text-[#ff9900]" },
          { label: "AU Accounts", value: auAccounts.filter((a: AuthorizedUserAccount) => a.status === "Active").length, color: "text-[#ff00ff]" },
        ].map(({ label, value, color }) => (
          <div key={label} className="cyber-panel p-3 text-center">
            <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
            <div className="text-[9px] font-mono text-zinc-500 mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Tab Nav */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-mono font-bold whitespace-nowrap transition-all ${activeTab === tab.id ? `${tab.color} border-b-2 border-current -mb-px` : "text-zinc-500 hover:text-zinc-300"}`}>
              <Icon size={12} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "score-intel" && (
        <div className="space-y-8">
          <FicoSimulator creditCards={creditCards} negativeItems={negativeItems} scoreEntries={scoreEntries} />
          <ScoreTimeline negativeItems={negativeItems} scoreEntries={scoreEntries} />
        </div>
      )}

      {activeTab === "profile" && (
        <div className="space-y-6">
          <CreditMixAnalyzer creditCards={creditCards} auAccounts={auAccounts} negativeItems={negativeItems} />
          <AgeOfCreditOptimizer creditCards={creditCards} auAccounts={auAccounts} />
          <AUTracker auAccounts={auAccounts} addAUAccount={addAUAccount} updateAUAccount={updateAUAccount} removeAUAccount={removeAUAccount} />
          <ThinFileRoadmap creditCards={creditCards} auAccounts={auAccounts} />
        </div>
      )}

      {activeTab === "build" && (
        <div className="space-y-6">
          <SecuredCardROI />
          <CreditBuilderLoanSim />
          <PaymentHistoryStreak negativeItems={negativeItems} creditCards={creditCards} />
          <ExperianBoostTracker boostPrograms={boostPrograms} updateBoostProgram={updateBoostProgram} />
        </div>
      )}

      {activeTab === "timing" && (
        <div className="space-y-6">
          <UtilizationWarRoom creditCards={creditCards} addCreditCard={addCreditCard} updateCreditCard={updateCreditCard} removeCreditCard={removeCreditCard} />
          <HardInquiryFadeTimer hardInquiries={hardInquiries} addHardInquiry={addHardInquiry} removeHardInquiry={removeHardInquiry} />
          <CLIScheduler creditCards={creditCards} updateCreditCard={updateCreditCard} />
          <DebtOptimizer creditCards={creditCards} />
        </div>
      )}
    </div>
  );
}
