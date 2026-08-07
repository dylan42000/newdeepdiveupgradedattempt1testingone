import React, { useState } from "react";
import { TrendingUp, Plus, Trash2, BarChart2 } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { ScoreEntry } from "../types";
import { v4 as uuidv4 } from "uuid";

const SCORE_BAND = (s: number) =>
  s >= 800 ? { label: "Exceptional", color: "#00ff00" } :
  s >= 740 ? { label: "Very Good", color: "#66ff66" } :
  s >= 670 ? { label: "Good", color: "#ff9900" } :
  s >= 580 ? { label: "Fair", color: "#ff6600" } :
               { label: "Poor", color: "#ff2200" };

export function ScoreTracker() {
  const { scoreEntries, addScoreEntry, removeScoreEntry } = useAppContext();
  const [newScore, setNewScore] = useState("");
  const [newBureau, setNewBureau] = useState("Equifax");
  const [newDate, setNewDate] = useState(new Date().toISOString().split("T")[0]);
  const [newNotes, setNewNotes] = useState("");

  const sorted = [...scoreEntries].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  const prev = sorted[sorted.length - 2];
  const delta = latest && prev ? latest.score - prev.score : null;

  const handleAdd = () => {
    const s = parseInt(newScore, 10);
    if (isNaN(s) || s < 300 || s > 850) return;
    addScoreEntry({ date: newDate, score: s, bureau: newBureau, notes: newNotes.trim() || undefined });
    setNewScore(""); setNewNotes("");
  };

  // Simple SVG line chart
  const chartWidth = 600; const chartHeight = 160;
  const pad = { l: 40, r: 20, t: 20, b: 30 };
  const w = chartWidth - pad.l - pad.r;
  const h = chartHeight - pad.t - pad.b;
  const scores = sorted.map((e) => e.score);
  const minS = Math.max(300, Math.min(...scores) - 30);
  const maxS = Math.min(850, Math.max(...scores) + 30);
  const points = sorted.map((e, i) => ({
    x: pad.l + (i / Math.max(1, sorted.length - 1)) * w,
    y: pad.t + h - ((e.score - minS) / Math.max(1, maxS - minS)) * h,
    entry: e,
  }));
  const pathD = points.length > 1
    ? "M " + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ")
    : "";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <TrendingUp className="text-[#00ffff]" /> SCORE TRACKER
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">LOG SCORES TO TRACK YOUR FICO RECOVERY OVER TIME</p>
      </div>

      {/* Add entry */}
      <div className="cyber-panel p-6">
        <h3 className="text-xs font-bold text-zinc-400 mb-4 font-mono">ADD SCORE ENTRY</h3>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] font-mono text-zinc-600 block mb-1">SCORE (300-850)</label>
            <input type="number" value={newScore} onChange={(e) => setNewScore(e.target.value)}
              min={300} max={850} placeholder="e.g. 642"
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded w-28 focus:border-[#00ffff] outline-none font-mono" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-zinc-600 block mb-1">BUREAU</label>
            <select value={newBureau} onChange={(e) => setNewBureau(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
              <option>Equifax</option><option>Experian</option><option>TransUnion</option><option>All (Average)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono text-zinc-600 block mb-1">DATE</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
          </div>
          <div className="flex-1 min-w-40">
            <label className="text-[10px] font-mono text-zinc-600 block mb-1">NOTES (optional)</label>
            <input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} placeholder="What changed?"
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
          </div>
          <button onClick={handleAdd}
            className="cyber-button border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-4 py-2 flex items-center gap-2 text-sm font-bold">
            <Plus size={16} /> LOG
          </button>
        </div>
      </div>

      {/* Current snapshot */}
      {latest && (
        <div className="cyber-panel p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono text-zinc-600">LATEST SCORE — {latest.bureau}</div>
              <div className="text-5xl font-bold font-mono mt-1" style={{ color: SCORE_BAND(latest.score).color }}>{latest.score}</div>
              <div className="text-sm mt-1 font-mono" style={{ color: SCORE_BAND(latest.score).color }}>{SCORE_BAND(latest.score).label}</div>
            </div>
            {delta !== null && (
              <div className={`text-right ${delta >= 0 ? "text-[#00ff00]" : "text-red-400"}`}>
                <div className="text-3xl font-bold font-mono">{delta >= 0 ? "+" : ""}{delta}</div>
                <div className="text-[10px] font-mono">POINTS SINCE LAST</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Chart */}
      {sorted.length > 1 && (
        <div className="cyber-panel p-6">
          <h3 className="text-xs font-mono text-zinc-400 mb-4">SCORE HISTORY CHART</h3>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full max-w-2xl" style={{ minWidth: "300px" }}>
              {/* Grid lines */}
              {[300, 450, 580, 670, 740, 800, 850].filter((s) => s >= minS && s <= maxS).map((s) => {
                const y = pad.t + h - ((s - minS) / Math.max(1, maxS - minS)) * h;
                return (
                  <g key={s}>
                    <line x1={pad.l} y1={y} x2={chartWidth - pad.r} y2={y} stroke="#1f2937" strokeWidth="1" />
                    <text x={pad.l - 4} y={y + 4} fill="#4b5563" fontSize="9" textAnchor="end" fontFamily="monospace">{s}</text>
                  </g>
                );
              })}
              {/* Line */}
              {pathD && <path d={pathD} fill="none" stroke="#00ffff" strokeWidth="2" strokeLinejoin="round" />}
              {/* Points */}
              {points.map((p, i) => {
                const band = SCORE_BAND(p.entry.score);
                return (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r="5" fill={band.color} />
                    <title>{p.entry.score} — {p.entry.bureau} — {new Date(p.entry.date).toLocaleDateString()}</title>
                    <text x={p.x} y={chartHeight - pad.b + 14} fill="#4b5563" fontSize="8" textAnchor="middle" fontFamily="monospace">
                      {new Date(p.entry.date).toLocaleDateString("en", { month: "short", day: "numeric" })}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* Entry list */}
      <div className="cyber-panel p-6">
        <h3 className="text-xs font-bold text-zinc-400 mb-4 font-mono">ALL ENTRIES</h3>
        <div className="space-y-2">
          {sorted.length === 0 && <div className="text-zinc-700 text-sm text-center py-6">No score entries yet.</div>}
          {[...sorted].reverse().map((entry) => {
            const band = SCORE_BAND(entry.score);
            return (
              <div key={entry.id} className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded">
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold font-mono" style={{ color: band.color }}>{entry.score}</span>
                  <div>
                    <div className="text-xs font-bold text-white">{entry.bureau}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{new Date(entry.date).toLocaleDateString()}</div>
                    {entry.notes && <div className="text-[10px] text-zinc-600">{entry.notes}</div>}
                  </div>
                </div>
                <button onClick={() => removeScoreEntry(entry.id)} className="p-2 text-zinc-600 hover:text-red-400">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
