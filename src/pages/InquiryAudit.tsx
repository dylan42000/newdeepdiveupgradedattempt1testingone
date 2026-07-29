import React, { useMemo } from "react";
import { Search, ShieldAlert, CheckCircle2, Ban } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { classifyInquiry, isInquiryItem } from "../services/inquiryDisputeEngine";

const STRATEGY_LABEL: Record<string, string> = {
  obsolete_removal: "Obsolete (≥2yr) — demand removal",
  permissible_purpose_demand: "Demand permissible purpose (§604)",
  duplicate_removal: "Duplicate / rate-shop cleanup",
  authorized_no_dispute: "Authorized — do not dispute",
};

export function InquiryAudit() {
  const { negativeItems } = useAppContext();

  const rows = useMemo(() => {
    return negativeItems
      .filter(isInquiryItem)
      .map((item) => ({ item, profile: classifyInquiry(item) }))
      .sort((a, b) => (b.profile.ageYears ?? 0) - (a.profile.ageYears ?? 0));
  }, [negativeItems]);

  const actionable = rows.filter((r) => r.profile.strategy !== "authorized_no_dispute");

  return (
    <div className="space-y-6" role="main" aria-labelledby="inquiry-audit-title">
      <div>
        <h2 id="inquiry-audit-title" className="text-2xl font-bold text-white flex items-center gap-2">
          <Search className="text-[#00ffff]" aria-hidden /> INQUIRY AUDIT
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          HARD-PULL REVIEW — SEPARATE FROM TRADELINE DISPUTE LETTERS (FCRA §604 / §605)
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3" role="group" aria-label="Inquiry summary">
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">HARD INQUIRIES</div>
          <div className="text-2xl font-bold text-white">{rows.length}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">ACTIONABLE</div>
          <div className="text-2xl font-bold text-[#00ffff]">{actionable.length}</div>
        </div>
        <div className="cyber-panel p-4">
          <div className="text-[10px] font-mono text-zinc-600">SKIP (AUTHORIZED)</div>
          <div className="text-2xl font-bold text-zinc-400">
            {rows.length - actionable.length}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="cyber-panel p-8 text-center text-zinc-500 text-sm" role="status">
          No hard inquiries detected in Negative Items. Upload a full report that includes inquiry sections.
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Inquiry list">
          {rows.map(({ item, profile }) => {
            const skip = profile.strategy === "authorized_no_dispute";
            return (
              <li key={item.id} className="cyber-panel p-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-zinc-900 rounded" aria-hidden>
                    {skip ? (
                      <Ban size={18} className="text-zinc-500" />
                    ) : profile.strategy === "obsolete_removal" ? (
                      <CheckCircle2 size={18} className="text-[#00ff00]" />
                    ) : (
                      <ShieldAlert size={18} className="text-[#ff9900]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{item.creditorName}</div>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5">
                      {item.creditBureau?.join(", ") || "Bureau unknown"}
                      {profile.inquiryDate ? ` · ${profile.inquiryDate}` : ""}
                      {profile.ageYears != null ? ` · ${profile.ageYears.toFixed(1)}y` : ""}
                    </div>
                    <div className={`text-xs mt-2 ${skip ? "text-zinc-500" : "text-[#00ffff]"}`}>
                      {STRATEGY_LABEL[profile.strategy] ?? profile.strategy}
                    </div>
                    <p className="text-xs text-zinc-400 mt-1">{profile.reason}</p>
                    <div className="text-[10px] font-mono text-zinc-600 mt-2">
                      Anchor: {profile.legalAnchor} · Never mix with tradeline letters
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
