import React, { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { AbStrategyTracker } from "../services/abStrategyTracker";
import { simulateRemovals } from "../services/scoreImpactSimulator";
import { scanReportForFraud } from "../services/fraudDetectionEngine";
import { isInquiryItem } from "../services/inquiryDisputeEngine";
import { evaluateGoodwillEligibility } from "../services/goodwillCampaignEngine";

export function KPICockpit() {
  const { negativeItems, disputeLetters, campaigns, personalInfo } = useAppContext();

  const winRates = useMemo(() => AbStrategyTracker.getWinRates().slice(0, 12), []);
  const portfolioImpact = useMemo(() => simulateRemovals(negativeItems), [negativeItems]);
  const fraudCount = useMemo(
    () =>
      scanReportForFraud(negativeItems, {
        personalInfo: {
          ssn: personalInfo.ssn,
          address: personalInfo.address,
          city: personalInfo.city,
          state: personalInfo.state,
        },
      }).length,
    [negativeItems, personalInfo],
  );
  const inquiryCount = useMemo(() => negativeItems.filter(isInquiryItem).length, [negativeItems]);
  const goodwillCount = useMemo(
    () => negativeItems.filter((i) => evaluateGoodwillEligibility(i).eligible).length,
    [negativeItems],
  );

  const disputed = negativeItems.filter((i) => i.disputeStatus && i.disputeStatus !== "Undisputed");
  const won = negativeItems.filter((i) => i.disputeStatus === "Won");

  return (
    <div className="space-y-6" role="main" aria-labelledby="kpi-title">
      <div>
        <h2 id="kpi-title" className="text-2xl font-bold text-white flex items-center gap-2">
          <BarChart3 className="text-[#00ffff]" aria-hidden /> KPI COCKPIT
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          STRATEGY INTELLIGENCE — LOCAL A/B WIN RATES + PORTFOLIO SNAPSHOT
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" role="group" aria-label="Portfolio KPIs">
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">NEGATIVE ITEMS</div>
          <div className="text-2xl font-bold text-white">{negativeItems.length}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">IN DISPUTE</div>
          <div className="text-2xl font-bold text-[#ff9900]">{disputed.length}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">WON / DELETED</div>
          <div className="text-2xl font-bold text-[#00ff00]">{won.length}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">LETTERS / CAMPAIGNS</div>
          <div className="text-2xl font-bold text-[#00ffff]">
            {disputeLetters.length}/{campaigns.length}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">FRAUD FLAGS</div>
          <div className="text-xl font-bold text-red-400">{fraudCount}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">INQUIRIES</div>
          <div className="text-xl font-bold text-white">{inquiryCount}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">GOODWILL ELIGIBLE</div>
          <div className="text-xl font-bold text-[#00ff00]">{goodwillCount}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">SCORE Δ RANGE</div>
          <div className="text-xl font-bold text-[#00ffff]">
            +{portfolioImpact.low}–{portfolioImpact.high}
          </div>
          <div className="text-[9px] text-zinc-600 mt-1">{portfolioImpact.disclaimer}</div>
        </div>
      </div>

      <section aria-labelledby="ab-win-rates">
        <h3 id="ab-win-rates" className="text-xs font-mono text-zinc-500 mb-2">
          A/B STRATEGY WIN RATES
        </h3>
        {winRates.length === 0 ? (
          <div className="cyber-panel p-6 text-sm text-zinc-500" role="status">
            No A/B outcomes recorded yet. Log bureau responses in Autopilot to build win-rate
            intelligence.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs" role="table">
              <thead>
                <tr className="text-[10px] font-mono text-zinc-600 border-b border-zinc-800">
                  <th scope="col" className="py-2 pr-3">Angle</th>
                  <th scope="col" className="py-2 pr-3">Bureau</th>
                  <th scope="col" className="py-2 pr-3">Type</th>
                  <th scope="col" className="py-2 pr-3">n</th>
                  <th scope="col" className="py-2 pr-3">Delete %</th>
                  <th scope="col" className="py-2">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {winRates.map((row) => (
                  <tr key={`${row.angle}-${row.bureau}-${row.debtType}`} className="border-b border-zinc-900">
                    <td className="py-2 pr-3 text-white">{row.angle}</td>
                    <td className="py-2 pr-3 text-zinc-400">{row.bureau}</td>
                    <td className="py-2 pr-3 text-zinc-400">{row.debtType}</td>
                    <td className="py-2 pr-3 font-mono">{row.sampleSize}</td>
                    <td className="py-2 pr-3 font-mono text-[#00ff00]">
                      {Math.round(row.deletionRate * 100)}%
                    </td>
                    <td className="py-2 text-zinc-500">{row.confidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
