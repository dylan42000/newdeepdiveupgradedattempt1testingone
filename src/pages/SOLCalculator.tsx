import React, { useState } from "react";
import { Scale, Calendar, AlertTriangle, Info, CheckCircle2 } from "lucide-react";

interface SOLEntry {
  state: string;
  written: number;
  oral: number;
  openEnd: number;
  notes?: string;
}

const SOL_DATA: SOLEntry[] = [
  { state: "Alabama", written: 6, oral: 6, openEnd: 6 },
  { state: "Alaska", written: 3, oral: 3, openEnd: 3 },
  { state: "Arizona", written: 6, oral: 3, openEnd: 6 },
  { state: "Arkansas", written: 5, oral: 3, openEnd: 5 },
  { state: "California", written: 4, oral: 2, openEnd: 4 },
  { state: "Colorado", written: 6, oral: 6, openEnd: 6 },
  { state: "Connecticut", written: 6, oral: 3, openEnd: 6 },
  { state: "Delaware", written: 3, oral: 3, openEnd: 4 },
  { state: "Florida", written: 5, oral: 4, openEnd: 4 },
  { state: "Georgia", written: 6, oral: 4, openEnd: 6 },
  { state: "Hawaii", written: 6, oral: 6, openEnd: 6 },
  { state: "Idaho", written: 5, oral: 4, openEnd: 4 },
  { state: "Illinois", written: 5, oral: 5, openEnd: 5 },
  { state: "Indiana", written: 10, oral: 6, openEnd: 6 },
  { state: "Iowa", written: 5, oral: 5, openEnd: 5 },
  { state: "Kansas", written: 5, oral: 3, openEnd: 3 },
  { state: "Kentucky", written: 10, oral: 5, openEnd: 5 },
  { state: "Louisiana", written: 10, oral: 10, openEnd: 3 },
  { state: "Maine", written: 6, oral: 6, openEnd: 6 },
  { state: "Maryland", written: 3, oral: 3, openEnd: 3 },
  { state: "Massachusetts", written: 6, oral: 6, openEnd: 6, notes: "Credit cards: 6 years" },
  { state: "Michigan", written: 6, oral: 6, openEnd: 3 },
  { state: "Minnesota", written: 6, oral: 6, openEnd: 6 },
  { state: "Mississippi", written: 3, oral: 3, openEnd: 3 },
  { state: "Missouri", written: 5, oral: 5, openEnd: 5 },
  { state: "Montana", written: 8, oral: 5, openEnd: 5 },
  { state: "Nebraska", written: 5, oral: 4, openEnd: 4 },
  { state: "Nevada", written: 6, oral: 4, openEnd: 6 },
  { state: "New Hampshire", written: 3, oral: 3, openEnd: 3 },
  { state: "New Jersey", written: 6, oral: 6, openEnd: 6 },
  { state: "New Mexico", written: 6, oral: 4, openEnd: 4 },
  { state: "New York", written: 6, oral: 6, openEnd: 6 },
  { state: "North Carolina", written: 3, oral: 3, openEnd: 3 },
  { state: "North Dakota", written: 6, oral: 6, openEnd: 6 },
  { state: "Ohio", written: 8, oral: 6, openEnd: 6 },
  { state: "Oklahoma", written: 5, oral: 3, openEnd: 3 },
  { state: "Oregon", written: 6, oral: 6, openEnd: 6 },
  { state: "Pennsylvania", written: 4, oral: 4, openEnd: 4 },
  { state: "Rhode Island", written: 10, oral: 10, openEnd: 4 },
  { state: "South Carolina", written: 3, oral: 3, openEnd: 3 },
  { state: "South Dakota", written: 6, oral: 6, openEnd: 6 },
  { state: "Tennessee", written: 6, oral: 6, openEnd: 6 },
  { state: "Texas", written: 4, oral: 4, openEnd: 4 },
  { state: "Utah", written: 6, oral: 4, openEnd: 6 },
  { state: "Vermont", written: 6, oral: 6, openEnd: 3 },
  { state: "Virginia", written: 5, oral: 3, openEnd: 3 },
  { state: "Washington", written: 6, oral: 3, openEnd: 3 },
  { state: "West Virginia", written: 10, oral: 5, openEnd: 5 },
  { state: "Wisconsin", written: 6, oral: 6, openEnd: 6 },
  { state: "Wyoming", written: 8, oral: 8, openEnd: 8 },
];

export function SOLCalculator() {
  const [selectedState, setSelectedState] = useState("California");
  const [debtType, setDebtType] = useState<"written" | "openEnd">("openEnd");
  const [dodDate, setDodDate] = useState("");
  const [search, setSearch] = useState("");

  const stateData = SOL_DATA.find((s) => s.state === selectedState);
  const solYears = stateData ? stateData[debtType] : 0;

  let solExpiry: string | null = null;
  let fcraExpiry: string | null = null;
  let isExpired = false;
  let isFcraExpired = false;
  let daysToSol = 0;
  let daysToFcra = 0;

  if (dodDate && stateData) {
    const dod = new Date(dodDate);
    const sol = new Date(dod); sol.setFullYear(sol.getFullYear() + solYears);
    const fcra = new Date(dod); fcra.setFullYear(fcra.getFullYear() + 7);
    solExpiry = sol.toLocaleDateString();
    fcraExpiry = fcra.toLocaleDateString();
    const now = Date.now();
    isExpired = sol.getTime() < now;
    isFcraExpired = fcra.getTime() < now;
    daysToSol = Math.round((sol.getTime() - now) / 86400000);
    daysToFcra = Math.round((fcra.getTime() - now) / 86400000);
  }

  const filtered = SOL_DATA.filter((s) => s.state.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Scale className="text-[#00ffff]" /> SOL CALCULATOR
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">STATUTE OF LIMITATIONS — STATE-BY-STATE DEBT COLLECTION WINDOW</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Calculator */}
        <div className="cyber-panel p-6">
          <h3 className="text-xs font-bold text-zinc-400 mb-4 font-mono">CALCULATE SOL EXPIRY</h3>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] font-mono text-zinc-600 block mb-1">STATE</label>
              <select value={selectedState} onChange={(e) => setSelectedState(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
                {SOL_DATA.map((s) => <option key={s.state} value={s.state}>{s.state}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-zinc-600 block mb-1">DEBT TYPE</label>
              <div className="flex gap-2">
                {["written", "openEnd"].map((t) => (
                  <button key={t} onClick={() => setDebtType(t as any)}
                    className={`text-xs px-3 py-1.5 rounded border font-mono ${debtType === t ? "border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10" : "border-zinc-800 text-zinc-500"}`}>
                    {t === "written" ? "Written Contract" : "Open-End (Credit Card)"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono text-zinc-600 block mb-1">DATE OF FIRST DELINQUENCY (DOFD)</label>
              <input type="date" value={dodDate} onChange={(e) => setDodDate(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none" />
            </div>
          </div>

          {stateData && (
            <div className="mt-4 space-y-3">
              <div className={`p-3 rounded-lg border ${isExpired ? "border-[#00ff00]/40 bg-[#00ff00]/5" : "border-[#ff9900]/40 bg-[#ff9900]/5"}`}>
                <div className="text-[10px] font-mono text-zinc-500">SOL WINDOW — {selectedState}</div>
                <div className={`text-2xl font-bold font-mono mt-1 ${isExpired ? "text-[#00ff00]" : "text-[#ff9900]"}`}>{solYears} YEARS</div>
                {solExpiry && (
                  <div className="text-sm text-zinc-300 mt-1 font-mono">
                    Expires: {solExpiry}
                    {isExpired ? (
                      <span className="ml-2 text-[#00ff00] text-xs">✓ SOL EXPIRED — COLLECTOR CANNOT SUE</span>
                    ) : (
                      <span className="ml-2 text-[#ff9900] text-xs">{daysToSol}d remaining</span>
                    )}
                  </div>
                )}
              </div>

              <div className={`p-3 rounded-lg border ${isFcraExpired ? "border-[#00ff00]/40 bg-[#00ff00]/5" : "border-blue-400/40 bg-blue-400/5"}`}>
                <div className="text-[10px] font-mono text-zinc-500">FCRA 7-YEAR REPORTING LIMIT</div>
                <div className={`text-2xl font-bold font-mono mt-1 ${isFcraExpired ? "text-[#00ff00]" : "text-blue-400"}`}>7 YEARS</div>
                {fcraExpiry && (
                  <div className="text-sm text-zinc-300 mt-1 font-mono">
                    Drops: {fcraExpiry}
                    {isFcraExpired ? (
                      <span className="ml-2 text-[#00ff00] text-xs">✓ MUST BE REMOVED FROM REPORT</span>
                    ) : (
                      <span className="ml-2 text-blue-400 text-xs">{daysToFcra}d remaining</span>
                    )}
                  </div>
                )}
              </div>

              {stateData.notes && (
                <div className="p-3 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2">
                  <Info size={12} className="shrink-0 mt-0.5 text-[#ff9900]" />{stateData.notes}
                </div>
              )}
            </div>
          )}
        </div>

        {/* SOL Table */}
        <div className="cyber-panel p-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-bold text-zinc-400 font-mono flex-1">ALL STATES SOL TABLE</h3>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter state..."
              className="bg-zinc-900 border border-zinc-800 text-xs px-3 py-1.5 rounded text-zinc-300 outline-none w-32 focus:border-[#00ffff]" />
          </div>
          <div className="overflow-y-auto max-h-96 custom-scrollbar">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#0f0f0f]">
                <tr className="text-zinc-500 font-mono text-[10px]">
                  <th className="text-left py-1 pr-3">STATE</th>
                  <th className="text-center py-1 px-2">WRITTEN</th>
                  <th className="text-center py-1 px-2">OPEN-END</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.state}
                    onClick={() => setSelectedState(s.state)}
                    className={`cursor-pointer border-b border-zinc-800/50 hover:bg-zinc-800/30 ${selectedState === s.state ? "bg-[#00ffff]/5" : ""}`}>
                    <td className={`py-1.5 pr-3 font-mono ${selectedState === s.state ? "text-[#00ffff]" : "text-zinc-300"}`}>{s.state}</td>
                    <td className="text-center py-1.5 px-2 text-zinc-400">{s.written}yr</td>
                    <td className="text-center py-1.5 px-2 text-zinc-400">{s.openEnd}yr</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="cyber-panel p-4 border-zinc-800">
        <div className="flex items-start gap-2 text-[10px] font-mono text-zinc-600">
          <AlertTriangle size={12} className="shrink-0 mt-0.5 text-[#ff9900]" />
          SOL determines how long a collector can sue you. FCRA 7-year limit determines how long the item can appear on your credit report. These are separate timers. A debt can be time-barred from lawsuits but still appear on your report until the FCRA window expires.
        </div>
      </div>
    </div>
  );
}
