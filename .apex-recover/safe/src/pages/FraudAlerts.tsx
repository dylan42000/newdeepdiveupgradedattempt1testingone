import React, { useMemo } from "react";
import { Siren, ExternalLink } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { scanReportForFraud } from "../services/fraudDetectionEngine";
import { PlatformService } from "../services/platformService";

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400",
  high: "text-[#ff6600]",
  medium: "text-[#ff9900]",
  low: "text-zinc-400",
};

export function FraudAlerts() {
  const { negativeItems, personalInfo } = useAppContext();

  const flags = useMemo(
    () =>
      scanReportForFraud(negativeItems, {
        personalInfo: {
          ssn: personalInfo.ssn,
          address: personalInfo.address,
          city: personalInfo.city,
          state: personalInfo.state,
        },
      }),
    [negativeItems, personalInfo],
  );

  const bySeverity = useMemo(() => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
    return [...flags].sort((a, b) => order[a.severity] - order[b.severity]);
  }, [flags]);

  const openFtc = async () => {
    await PlatformService.openExternal("https://www.identitytheft.gov/");
  };

  return (
    <div className="space-y-6" role="main" aria-labelledby="fraud-alerts-title">
      <div>
        <h2 id="fraud-alerts-title" className="text-2xl font-bold text-white flex items-center gap-2">
          <Siren className="text-red-400" aria-hidden /> FRAUD ALERTS
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          PASSIVE MIXED-FILE / IDENTITY-THEFT SCAN — FCRA §605B GUIDANCE
        </p>
      </div>

      <div className="cyber-panel p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-white font-semibold">{bySeverity.length} flag(s) on current report</div>
          <p className="text-xs text-zinc-500 mt-1">
            No data is sent off-device. File an FTC report yourself if you suspect identity theft.
          </p>
        </div>
        <button
          type="button"
          onClick={openFtc}
          className="inline-flex items-center gap-2 px-3 py-2 text-xs font-mono border border-zinc-700 rounded hover:border-red-500 text-zinc-200"
          aria-label="Open IdentityTheft.gov in browser"
        >
          <ExternalLink size={14} aria-hidden /> IdentityTheft.gov
        </button>
      </div>

      {bySeverity.length === 0 ? (
        <div className="cyber-panel p-8 text-center text-zinc-500 text-sm" role="status">
          No fraud indicators detected on the current Negative Items set.
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Fraud flags">
          {bySeverity.map((flag, idx) => {
            const item = negativeItems.find((i) => i.id === flag.itemId);
            return (
              <li key={`${flag.itemId}-${flag.code}-${idx}`} className="cyber-panel p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className={`text-[10px] font-mono uppercase ${SEVERITY_COLOR[flag.severity]}`}>
                      {flag.severity} · {flag.code}
                    </div>
                    <div className="text-sm font-bold text-white mt-1">
                      {item?.creditorName ?? flag.itemId}
                    </div>
                    <p className="text-xs text-zinc-400 mt-2">{flag.rule}</p>
                    <div className="text-[10px] font-mono text-zinc-600 mt-2">
                      Action: {flag.action}
                      {flag.fcraPath ? ` · ${flag.fcraPath}` : ""}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
