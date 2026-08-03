import React from "react";
import {
  MapPin, Scale, TrendingUp, Clock, Wrench, Trophy, User, Settings, CalendarDays,
  ChevronRight, Search, ShieldAlert, HeartHandshake, BarChart3, FileText,
} from "lucide-react";
import { AppPage } from "../App";

interface MoreMenuProps {
  navigate: (page: AppPage) => void;
}

const SECTIONS = [
  {
    title: "ANALYSIS TOOLS",
    items: [
      { page: "score-tracker" as AppPage, label: "Score Tracker", desc: "Log and chart your FICO score over time", icon: TrendingUp, color: "text-[#00ff00]" },
      { page: "dispute-calendar" as AppPage, label: "Dispute Calendar", desc: "Live FCRA deadlines, follow-up windows, and SOL watch", icon: CalendarDays, color: "text-[#00ffff]" },
      { page: "sol-calculator" as AppPage, label: "SOL Calculator", desc: "Statute of limitations by state — 50 states", icon: Scale, color: "text-[#ff9900]" },
      { page: "address-lookup" as AppPage, label: "AI Address Lookup", desc: "Find bureau/collector dispute addresses via AI", icon: MapPin, color: "text-[#00ffff]" },
      { page: "tools" as AppPage, label: "Utilities", desc: "Utilization calculator, payoff planner, score impact", icon: Wrench, color: "text-purple-400" },
    ],
  },
  {
    title: "APEX INTELLIGENCE",
    items: [
      { page: "inquiry-audit" as AppPage, label: "Inquiry Audit", desc: "Hard-pull review with §604 / §605 strategies", icon: Search, color: "text-[#00ffff]" },
      { page: "fraud-alerts" as AppPage, label: "Fraud Alerts", desc: "Mixed-file and identity-theft indicators", icon: ShieldAlert, color: "text-[#ff4444]" },
      { page: "goodwill" as AppPage, label: "Goodwill Campaigns", desc: "Paid-account goodwill request ladder (not a dispute)", icon: HeartHandshake, color: "text-[#ff99cc]" },
      { page: "kpi-cockpit" as AppPage, label: "KPI Cockpit", desc: "Win rates, A/B angle intelligence, cycle KPIs", icon: BarChart3, color: "text-[#00ff00]" },
      { page: "consumer-statement" as AppPage, label: "Consumer Statement", desc: "FCRA ≤100-word statement drafts for verified items", icon: FileText, color: "text-[#ffcc00]" },
    ],
  },
  {
    title: "RECORDS & HISTORY",
    items: [
      { page: "history" as AppPage, label: "Audit History", desc: "Full 5-year FCRA audit trail of all actions", icon: Clock, color: "text-blue-400" },
      { page: "gamification" as AppPage, label: "Achievements", desc: "Badges, streaks, and credit repair milestones", icon: Trophy, color: "text-yellow-400" },
    ],
  },
  {
    title: "ACCOUNT",
    items: [
      { page: "profile" as AppPage, label: "Profile", desc: "Your identity info used in dispute letters", icon: User, color: "text-zinc-400" },
      { page: "settings" as AppPage, label: "Settings", desc: "Backup, restore, theme, and app preferences", icon: Settings, color: "text-zinc-400" },
    ],
  },
];

export function MoreMenu({ navigate }: MoreMenuProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">MORE FEATURES</h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">TOOLS, HISTORY & ACCOUNT</p>
      </div>
      {SECTIONS.map((section) => (
        <div key={section.title}>
          <div className="text-[10px] font-mono text-zinc-600 mb-2">{section.title}</div>
          <div className="space-y-2">
            {section.items.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.page} onClick={() => navigate(item.page)}
                  className="w-full cyber-panel p-4 flex items-center gap-4 hover:border-zinc-700 transition-all text-left">
                  <div className="p-2 bg-zinc-900 rounded">
                    <Icon size={18} className={item.color} />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{item.label}</div>
                    <div className="text-xs text-zinc-500">{item.desc}</div>
                  </div>
                  <ChevronRight size={16} className="text-zinc-700" />
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
