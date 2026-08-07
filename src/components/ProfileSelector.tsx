/**
 * ProfileSelector.tsx — Multi-Profile Switcher
 * Shows all credit profiles with key stats. Allows quick switching.
 */

import React, { useState } from 'react';
import { User, Plus, ChevronDown, Target, Calendar, TrendingUp } from 'lucide-react';
import { CreditProfile } from '../types/creditRepair';

interface ProfileSelectorProps {
  profiles: CreditProfile[];
  activeProfileId: string;
  onSelectProfile: (profileId: string) => void;
  onAddProfile: () => void;
}

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({
  profiles,
  activeProfileId,
  onSelectProfile,
  onAddProfile,
}) => {
  const [open, setOpen] = useState(false);
  const active = profiles.find(p => p.id === activeProfileId) ?? profiles[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 hover:border-cyan-800 transition-colors text-sm"
      >
        <div className="w-7 h-7 rounded-full bg-cyan-900 border border-cyan-700 flex items-center justify-center text-cyan-300 font-bold text-xs">
          {active?.avatarInitials ?? 'ME'}
        </div>
        <span className="text-gray-200 max-w-[120px] truncate">{active?.firstName ?? 'My Profile'}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl overflow-hidden">
          {profiles.map(profile => (
            <button
              key={profile.id}
              onClick={() => { onSelectProfile(profile.id); setOpen(false); }}
              className={`w-full flex items-start gap-3 p-4 hover:bg-gray-800 transition-colors text-left ${
                profile.id === activeProfileId ? 'bg-gray-800 border-l-2 border-cyan-500' : ''
              }`}
            >
              <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                profile.id === activeProfileId
                  ? 'bg-cyan-900 border border-cyan-500 text-cyan-300'
                  : 'bg-gray-700 border border-gray-600 text-gray-300'
              }`}>
                {profile.avatarInitials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-100">
                    {profile.firstName} {profile.lastName}
                  </span>
                  {profile.id === activeProfileId && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900 text-cyan-400 font-bold">ACTIVE</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Target className="w-3 h-3" />
                    {profile.activeCount} active
                  </span>
                  {profile.nextCycleDate && (
                    <span className="text-xs text-gray-400 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(profile.nextCycleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {profile.estimatedScoreImpact && (
                    <span className="text-xs text-green-400 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      {profile.estimatedScoreImpact}
                    </span>
                  )}
                </div>
                {profile.removedCount > 0 && (
                  <div className="mt-1 text-xs text-cyan-400">{profile.removedCount} items removed ✓</div>
                )}
              </div>
            </button>
          ))}

          <div className="border-t border-gray-700">
            <button
              onClick={() => { onAddProfile(); setOpen(false); }}
              className="w-full flex items-center gap-2 p-4 hover:bg-gray-800 transition-colors text-sm text-cyan-400"
            >
              <div className="w-9 h-9 rounded-full border border-dashed border-cyan-700 flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              Add New Profile
            </button>
          </div>
        </div>
      )}

      {/* Backdrop */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}
    </div>
  );
};
