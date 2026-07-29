/**
 * Cases workspace — canonical AutoPilot cases with pipeline filter.
 */

import React, { useEffect, useState } from 'react';
import { Briefcase, RefreshCw } from 'lucide-react';
import type { AutopilotCase } from '../types/autopilotCase';
import { CaseRepository } from '../services/caseRepository';
import { useAppContext } from '../context/AppContext';
import { MissionControlPanel } from '../components/MissionControlPanel';

export function Cases() {
  const { personalInfo, negativeItems, autopilot, activeProfileId } = useAppContext();
  const profileId = activeProfileId || 'default';
  const [cases, setCases] = useState<AutopilotCase[]>([]);
  const [loading, setLoading] = useState(false);
  // Prefer V2 settings (source of truth on Autopilot page); fall back to legacy flag.
  const [v2Enabled, setV2Enabled] = useState(() => {
    try {
      const saved = localStorage.getItem('dylandos_autopilot_v2_settings');
      if (saved) {
        const parsed = JSON.parse(saved) as { enabled?: boolean };
        if (typeof parsed.enabled === 'boolean') return parsed.enabled;
      }
    } catch { /* ignore */ }
    return autopilot.enabled;
  });

  useEffect(() => {
    try {
      const saved = localStorage.getItem('dylandos_autopilot_v2_settings');
      if (saved) {
        const parsed = JSON.parse(saved) as { enabled?: boolean };
        if (typeof parsed.enabled === 'boolean') {
          setV2Enabled(parsed.enabled);
          return;
        }
      }
    } catch { /* ignore */ }
    setV2Enabled(autopilot.enabled);
  }, [autopilot.enabled]);

  const refresh = async () => {
    setLoading(true);
    try {
      await CaseRepository.syncFromItems(profileId, negativeItems);
      setCases(await CaseRepository.getCasesForProfile(profileId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [profileId, negativeItems.length]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-cyan-400" aria-hidden />
            Cases
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            Every bureau row is its own case with provenance, plan, and stop conditions.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:border-cyan-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Sync
        </button>
      </div>

      <MissionControlPanel
        profileId={profileId}
        hasPersonalInfo={Boolean(personalInfo.firstName && personalInfo.address)}
        hasReports={negativeItems.length > 0}
        autopilotEnabled={v2Enabled}
      />

      <div className="rounded-xl border border-zinc-800 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-900/80 text-[10px] font-mono text-zinc-500 uppercase">
            <tr>
              <th className="px-3 py-2">Creditor</th>
              <th className="px-3 py-2">Bureau</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Pass</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id} className="border-t border-zinc-800/80 hover:bg-zinc-900/40">
                <td className="px-3 py-2 text-white">{c.creditorName}</td>
                <td className="px-3 py-2 text-zinc-400">{c.bureau}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-cyan-400">{c.state}</td>
                <td className="px-3 py-2 text-zinc-300">{c.priorityLabel}</td>
                <td className="px-3 py-2 text-zinc-400">{c.passNumber}</td>
              </tr>
            ))}
            {cases.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-zinc-500 text-xs">
                  No cases yet — import a report from AutoPilot Mission Control.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
