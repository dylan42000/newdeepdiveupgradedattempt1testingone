import React, { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard, Upload, AlertTriangle, FileText, Zap, Shield,
  Clock, TrendingUp, MapPin, Scale, Settings, User, Trophy, Wrench, CalendarDays,
  MoreHorizontal, ChevronLeft, ChevronRight, Menu, X, Target, Keyboard,
  FolderOpen, BarChart3, Briefcase, Home, Inbox,
} from "lucide-react";
import { AppPage } from "../../App";
import { APP_VERSION, useAppContext } from "../../context/AppContext";
import { CommandPalette } from "../ui/CommandPalette";
import { PlatformService } from "../../services/platformService";

interface NavItem {
  id: AppPage;
  label: string;
  icon: React.ElementType;
  shortLabel?: string;
}

/** Primary PC nav per FINAL-WORLD-CLASS §3.3 — legacy tools live under Tools & Learn. */
const PRIMARY_NAV: NavItem[] = [
  { id: "autopilot", label: "AutoPilot", icon: Zap },
  { id: "cases", label: "Cases", icon: Briefcase },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "results", label: "Results", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
];

const TOOLS_NAV: NavItem[] = [
  { id: "dashboard", label: "Legacy Dashboard", icon: LayoutDashboard, shortLabel: "Dashboard" },
  { id: "upload", label: "Upload Report", icon: Upload },
  { id: "negative-items", label: "Negative Items", icon: AlertTriangle, shortLabel: "Negatives" },
  { id: "dispute-letters", label: "Dispute Letters", icon: FileText, shortLabel: "Letters" },
  { id: "dispute-calendar", label: "Dispute Calendar", icon: CalendarDays, shortLabel: "Calendar" },
  { id: "credit-builder", label: "Credit Builder", icon: Target, shortLabel: "Builder" },
  { id: "vault", label: "Evidence Vault", icon: Shield, shortLabel: "Vault" },
  { id: "score-tracker", label: "Score Tracker", icon: TrendingUp, shortLabel: "Scores" },
  { id: "history", label: "Audit History", icon: Clock, shortLabel: "History" },
  { id: "address-lookup", label: "Address Lookup", icon: MapPin, shortLabel: "Addresses" },
  { id: "sol-calculator", label: "SOL Calculator", icon: Scale, shortLabel: "SOL" },
  { id: "tools", label: "Utilities", icon: Wrench },
  { id: "more", label: "Tools & Learn", icon: MoreHorizontal, shortLabel: "More" },
  { id: "gamification", label: "Achievements", icon: Trophy, shortLabel: "Badges" },
  { id: "profile", label: "Profile", icon: User },
];

const ANDROID_BOTTOM_NAV: NavItem[] = [
  { id: "autopilot", label: "Home", icon: Home },
  { id: "cases", label: "Tasks", icon: Inbox, shortLabel: "Tasks" },
  { id: "negative-items", label: "Cases", icon: Briefcase },
  { id: "documents", label: "Documents", icon: FolderOpen },
  { id: "more", label: "More", icon: MoreHorizontal },
];

interface LayoutProps {
  children: React.ReactNode;
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
}

export function Layout({ children, currentPage, onNavigate }: LayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const { scoreEntries, negativeItems } = useAppContext();

  const latestScore = scoreEntries.length > 0
    ? (() => {
        const last = [...scoreEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
        return last.equifax ?? last.experian ?? last.transunion ?? null;
      })()
    : null;

  // Badge counts per page
  const badges: Partial<Record<AppPage, number>> = {
    "negative-items": negativeItems.filter((i) => !i.disputeStatus || i.disputeStatus === "Undisputed").length,
    "dispute-letters": negativeItems.filter((i) => (i.disputeStatus ?? "").includes("Pending")).length,
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      setShowPalette((p) => !p);
    }
    if (e.key === "?" && !e.ctrlKey && !e.metaKey && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
      setShowShortcuts((s) => !s);
    }
    if (e.key === "Escape") {
      setShowPalette(false);
      setShowShortcuts(false);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const brandMarkSrc = `${import.meta.env.BASE}dylandos-v5-icon.svg`;

  return (
    <div className="min-h-screen text-white flex bg-[#06060a] relative overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[#06060a] layout-backdrop-gradient" aria-hidden />
      <div className="pointer-events-none fixed inset-0 -z-10 opacity-[0.07] layout-backdrop-grid" aria-hidden />
      {/* Command Palette */}
      {showPalette && <CommandPalette onNavigate={(p) => { onNavigate(p); setShowPalette(false); }} onClose={() => setShowPalette(false)} />}

      {/* Keyboard Shortcut Overlay */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80" onClick={() => setShowShortcuts(false)}>
          <div className="bg-[#0f0f0f] border border-zinc-700 rounded-xl p-6 w-[480px] max-w-[90vw]" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Keyboard size={16} className="text-[#00ffff]" />
                <span className="text-sm font-bold font-mono text-white">KEYBOARD SHORTCUTS</span>
              </div>
              <button
                onClick={() => setShowShortcuts(false)}
                title="Close shortcuts"
                aria-label="Close shortcuts"
                className="text-zinc-500 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-2">
              {[
                ["Ctrl+K", "Open Command Palette"],
                ["?", "Toggle this overlay"],
                ["Esc", "Close modals"],
                ["D", "Go to Dashboard (via palette)"],
                ["N", "Go to Negative Items (via palette)"],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center justify-between p-2 bg-zinc-900 rounded">
                  <span className="text-zinc-400 text-xs font-mono">{desc}</span>
                  <kbd className="bg-zinc-700 text-zinc-200 text-[10px] px-2 py-0.5 rounded font-mono">{key}</kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/70 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed left-0 top-0 h-screen z-50 flex flex-col
        bg-[#0f0f0f] border-r border-zinc-800
        transition-all duration-300
        ${collapsed ? "w-16" : "w-56"}
        ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}>
        {/* Logo */}
        <div className={`flex items-center gap-2 px-4 py-4 border-b border-zinc-800 ${collapsed ? "justify-center" : ""}`}>
          <img src={brandMarkSrc} alt="Dylando Credit Repair" className="w-7 h-7 shrink-0" />
          {!collapsed && (
            <div>
              <div className="text-[10px] font-bold text-white leading-tight tracking-widest">DYLANDO ULTIMATE</div>
              <div className="text-[9px] font-mono text-[#00ffff] tracking-wider">CREDIT REPAIR SUITE</div>
            </div>
          )}
        </div>

        {/* Global Score Bar */}
        {latestScore !== null && (
          <div className={`px-3 py-2 border-b border-zinc-800/50 ${collapsed ? "flex justify-center" : ""}`}>
            {collapsed
              ? <div className="text-xs font-bold font-mono text-[#ff9900]">{latestScore}</div>
              : <div className="flex items-center justify-between">
                  <span className="text-[9px] font-mono text-zinc-500">LATEST SCORE</span>
                  <span className={`text-sm font-bold font-mono ${latestScore >= 720 ? "text-[#00ff00]" : latestScore >= 650 ? "text-[#ff9900]" : "text-red-400"}`}>{latestScore}</span>
                </div>
            }
            {!collapsed && (
              <progress
                value={Math.max(5, ((latestScore - 300) / 550) * 100)}
                max={100}
                aria-label="Latest score position"
                title="Latest score position"
                className="autopilot-progress h-1 mt-1.5"
              />
            )}
          </div>
        )}

        {/* Cmd+K pill */}
        {!collapsed && (
          <button onClick={() => setShowPalette(true)} className="mx-3 my-2 flex items-center gap-2 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 hover:border-zinc-600 text-zinc-500 hover:text-zinc-300 transition-all">
            <span className="text-[9px] font-mono flex-1 text-left">Search commands...</span>
            <kbd className="text-[8px] bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700 font-mono">Ctrl+K</kbd>
          </button>
        )}

        {/* Collapse toggle — desktop only */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex absolute -right-3 top-16 w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 items-center justify-center text-zinc-400 hover:text-white">
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>

        {/* Nav items — primary workspace first, then Tools & Learn */}
        <nav className="flex-1 overflow-y-auto py-2 custom-scrollbar">
          {!collapsed && (
            <div className="px-4 pb-1 text-[9px] font-mono text-zinc-600 tracking-widest">WORKSPACE</div>
          )}
          {PRIMARY_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all relative
                  ${isActive
                    ? "bg-[#00ffff]/10 text-[#00ffff] border-r-2 border-[#00ffff]"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50"
                  }
                  ${collapsed ? "justify-center" : ""}
                `}>
                <div className="relative shrink-0">
                  <Icon size={16} />
                  {badges[item.id] !== undefined && badges[item.id]! > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#ff9900] flex items-center justify-center text-black text-[7px] font-bold">
                      {badges[item.id]! > 9 ? "9+" : badges[item.id]}
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <span className="text-[11px] font-mono tracking-wide truncate flex-1 text-left">
                    {item.shortLabel || item.label}
                  </span>
                )}
              </button>
            );
          })}
          {!collapsed && (
            <div className="px-4 pt-3 pb-1 text-[9px] font-mono text-zinc-600 tracking-widest">TOOLS & LEARN</div>
          )}
          {TOOLS_NAV.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { onNavigate(item.id); setMobileOpen(false); }}
                title={collapsed ? item.label : undefined}
                className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-all relative
                  ${isActive
                    ? "bg-[#00ffff]/10 text-[#00ffff] border-r-2 border-[#00ffff]"
                    : "text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50"
                  }
                  ${collapsed ? "justify-center" : ""}
                `}>
                <div className="relative shrink-0">
                  <Icon size={15} />
                  {badges[item.id] !== undefined && badges[item.id]! > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-[#ff9900] flex items-center justify-center text-black text-[7px] font-bold">
                      {badges[item.id]! > 9 ? "9+" : badges[item.id]}
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <span className="text-[10px] font-mono tracking-wide truncate flex-1 text-left">
                    {item.shortLabel || item.label}
                  </span>
                )}
                {!collapsed && badges[item.id] !== undefined && badges[item.id]! > 0 && (
                  <span className="text-[8px] font-bold font-mono text-[#ff9900] bg-[#ff9900]/10 border border-[#ff9900]/30 px-1 rounded">{badges[item.id]}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Version */}
        {!collapsed && (
          <div className="px-4 py-3 border-t border-zinc-800 text-[9px] font-mono text-zinc-700">v{APP_VERSION} • SUITE AI</div>
        )}
      </aside>

      {/* Mobile header */}
      <div className="fixed top-0 left-0 right-0 z-30 md:hidden bg-[#0f0f0f] border-b border-zinc-800 flex items-center px-4 py-3 gap-3">
        <button onClick={() => setMobileOpen(true)} title="Open navigation" aria-label="Open navigation" className="text-zinc-400">
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <img src={brandMarkSrc} alt="Dylando Credit Repair" className="w-4 h-4" />
          <span className="text-[11px] font-bold tracking-widest text-white">DYLANDO ULTIMATE</span>
        </div>
      </div>

      {/* Main content */}
      <main className={`
        flex-1 min-h-screen transition-all duration-300
        ${collapsed ? "md:ml-16" : "md:ml-56"}
        pt-14 md:pt-0
        ${PlatformService.isAndroid() ? "pb-20" : ""}
      `}>
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          {children}
        </div>
      </main>

      {/* Android bottom navigation (§12.1) */}
      {PlatformService.isAndroid() && (
        <nav
          className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-800 bg-[#0f0f0f]/95 backdrop-blur md:hidden"
          aria-label="Primary"
        >
          <div className="grid grid-cols-5">
            {ANDROID_BOTTOM_NAV.map((item) => {
              const Icon = item.icon;
              const isActive =
                currentPage === item.id ||
                (item.id === "documents" && currentPage === "vault");
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={`flex flex-col items-center gap-0.5 py-2 text-[9px] font-mono ${
                    isActive ? "text-[#00ffff]" : "text-zinc-500"
                  }`}
                >
                  <Icon size={18} />
                  {item.shortLabel || item.label}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
