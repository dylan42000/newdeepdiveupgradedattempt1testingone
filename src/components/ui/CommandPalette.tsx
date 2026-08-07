import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Terminal, LayoutDashboard, Upload, AlertTriangle, FileText,
  Zap, Shield, TrendingUp, Clock, MapPin, Scale, Settings,
  User, Trophy, Wrench, Target, X, Search,
  CalendarDays,
} from "lucide-react";
import { AppPage } from "../../App";

interface Command {
  id: string;
  label: string;
  desc?: string;
  page?: AppPage;
  icon: React.ElementType;
  color?: string;
  action?: () => void;
}

interface CommandPaletteProps {
  onNavigate: (page: AppPage) => void;
  onClose: () => void;
}

export function CommandPalette({ onNavigate, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const COMMANDS: Command[] = [
    { id: "autopilot", label: "AutoPilot Mission Control", desc: "Case manager — next best action", page: "autopilot", icon: Zap, color: "text-[#ff00ff]" },
    { id: "cases", label: "Cases", desc: "Canonical dispute cases", page: "cases", icon: Target, color: "text-cyan-400" },
    { id: "documents", label: "Documents", desc: "Evidence vault and packets", page: "documents", icon: Shield, color: "text-purple-400" },
    { id: "results", label: "Results", desc: "Confirmed outcomes and audit history", page: "results", icon: Clock, color: "text-emerald-400" },
    { id: "dashboard", label: "Dashboard", desc: "Overview, score snapshot", page: "dashboard", icon: LayoutDashboard, color: "text-[#00ffff]" },
    { id: "upload", label: "Upload Report", desc: "Import credit report CSV/PDF", page: "upload", icon: Upload, color: "text-blue-400" },
    { id: "negative-items", label: "Negative Items", desc: "Review and manage derogatory tradelines", page: "negative-items", icon: AlertTriangle, color: "text-red-400" },
    { id: "dispute-letters", label: "Dispute Letters", desc: "Generate and manage letters", page: "dispute-letters", icon: FileText, color: "text-[#ff9900]" },
    { id: "dispute-calendar", label: "Dispute Calendar", desc: "Track FCRA deadlines and follow-up windows", page: "dispute-calendar", icon: CalendarDays, color: "text-[#00ffff]" },
    { id: "credit-builder", label: "Credit Builder", desc: "15 score-building tools", page: "credit-builder", icon: Target, color: "text-[#00ff00]" },
    { id: "vault", label: "Evidence Vault", desc: "Secure document storage", page: "vault", icon: Shield, color: "text-purple-400" },
    { id: "score-tracker", label: "Score Tracker", desc: "Log and chart FICO scores", page: "score-tracker", icon: TrendingUp, color: "text-green-400" },
    { id: "history", label: "Audit History", desc: "Full event timeline", page: "history", icon: Clock, color: "text-zinc-400" },
    { id: "address-lookup", label: "Address Lookup", desc: "Bureau mailing addresses", page: "address-lookup", icon: MapPin, color: "text-blue-300" },
    { id: "sol-calculator", label: "SOL Calculator", desc: "Statute of limitations by state", page: "sol-calculator", icon: Scale, color: "text-[#ff9900]" },
    { id: "tools", label: "Tools", desc: "QR code, contacts, CSV import", page: "tools", icon: Wrench, color: "text-zinc-300" },
    { id: "gamification", label: "Achievements", desc: "XP, badges, missions", page: "gamification", icon: Trophy, color: "text-yellow-400" },
    { id: "profile", label: "Profile", desc: "Personal info and security settings", page: "profile", icon: User, color: "text-zinc-300" },
    { id: "settings", label: "Settings", desc: "App configuration", page: "settings", icon: Settings, color: "text-zinc-400" },
  ];

  const filtered = query.trim()
    ? COMMANDS.filter(
        (c) =>
          c.label.toLowerCase().includes(query.toLowerCase()) ||
          c.desc?.toLowerCase().includes(query.toLowerCase())
      )
    : COMMANDS;

  useEffect(() => {
    setSelected(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execute = useCallback(
    (cmd: Command) => {
      if (cmd.page) onNavigate(cmd.page);
      if (cmd.action) cmd.action();
      onClose();
    },
    [onNavigate, onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter" && filtered[selected]) {
        execute(filtered[selected]);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [filtered, selected, execute, onClose]
  );

  return (
    <div className="fixed inset-0 z-[9998] flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/75" onClick={onClose} />

      {/* Palette */}
      <div className="relative w-full max-w-lg mx-4 bg-[#111] border border-zinc-700 rounded-xl shadow-2xl shadow-black overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <Search size={14} className="text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages & actions..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none font-mono"
          />
          <div className="flex items-center gap-1">
            <kbd className="text-[9px] font-mono text-zinc-600 border border-zinc-700 rounded px-1">ESC</kbd>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-zinc-600 font-mono">No matching commands</div>
          ) : (
            filtered.map((cmd, i) => {
              const Icon = cmd.icon;
              const isSelected = i === selected;
              return (
                <button
                  key={cmd.id}
                  onClick={() => execute(cmd)}
                  onMouseEnter={() => setSelected(i)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                    isSelected ? "bg-zinc-800" : "hover:bg-zinc-800/50"
                  }`}
                >
                  <div className={`w-7 h-7 rounded flex items-center justify-center bg-zinc-900 ${cmd.color || "text-zinc-400"}`}>
                    <Icon size={13} />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-bold text-white font-mono">{cmd.label}</div>
                    {cmd.desc && <div className="text-[10px] text-zinc-500 font-mono">{cmd.desc}</div>}
                  </div>
                  {isSelected && <kbd className="text-[9px] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5 font-mono">↵</kbd>}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-4 px-4 py-2 border-t border-zinc-800 text-[9px] font-mono text-zinc-700">
          <span><kbd className="border border-zinc-700 rounded px-1">↑↓</kbd> navigate</span>
          <span><kbd className="border border-zinc-700 rounded px-1">↵</kbd> open</span>
          <span><kbd className="border border-zinc-700 rounded px-1">esc</kbd> close</span>
          <span className="ml-auto flex items-center gap-1"><Terminal size={9} /> DYLANDOS CMD</span>
        </div>
      </div>
    </div>
  );
}
