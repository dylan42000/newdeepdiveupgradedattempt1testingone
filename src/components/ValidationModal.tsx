/**
 * ValidationModal.tsx — Letter Validation Self-Healing Modal
 *
 * BUG-06 FIX: Replaces the old static error-list modal with an actionable
 * self-healing modal that provides:
 *   - Clear error / warning separation
 *   - ⚡ Regenerate: re-runs AI generation with error context injected
 *   - ⚠️ Force Approve: bypass warnings-only failures (errors block this)
 *   - VIEW LETTER: open preview directly from the modal
 *   - CLOSE: dismiss without action
 */

import React, { useState } from "react";
import { AlertCircle, Eye, RefreshCw, ShieldAlert, X } from "lucide-react";
import { NegativeItem, DisputeLetter } from "../types";
import { regenerateLetterWithContext } from "../services/regenerationService";
import type { PassNumber } from "../types/creditRepair";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ValidationModalState {
  letterId: string;
  errors: string[];
  warnings: string[];
  isRegenerating?: boolean;
}

interface PersonalInfo {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  email: string;
  ssn?: string;
  dob?: string;
}

interface ValidationModalProps {
  modal: ValidationModalState;
  disputeLetters: DisputeLetter[];
  negativeItems: NegativeItem[];
  personalInfo: PersonalInfo;
  onClose: () => void;
  onUpdateLetter: (id: string, updates: Partial<DisputeLetter>) => void;
  onViewLetter: (letter: DisputeLetter) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export const ValidationModal: React.FC<ValidationModalProps> = ({
  modal,
  disputeLetters,
  negativeItems,
  personalInfo,
  onClose,
  onUpdateLetter,
  onViewLetter,
}) => {
  const [regenerating, setRegenerating] = useState(false);

  const letter = disputeLetters.find(l => l.id === modal.letterId) ?? null;
  const primaryItem = letter
    ? (negativeItems.find(i => letter.negativeItemIds.includes(i.id)) ?? null)
    : null;

  const hasErrors = modal.errors.length > 0;
  const hasWarnings = modal.warnings.length > 0;

  // ── Regenerate handler ────────────────────────────────────────────────────
  const handleRegenerate = async () => {
    if (!letter || !primaryItem) {
      onClose();
      return;
    }

    setRegenerating(true);

    try {
      // Issue 1 Fix: Use the dedicated regeneration service with full grounding context.
      // This resolves all 5 failure modes: proper awaiting, correct letter ID, state
      // propagation after await, grounding context included, full params object.
      const result = await regenerateLetterWithContext({
        letter,
        originalErrors: modal.errors,
        personalInfo,
        negativeItem: primaryItem,
        passNumber: (letter.round ?? 1) as PassNumber,
        targetBureau: letter.bureau,
      });

      if (result.success || result.newContent.length > 0) {
        // Issue 1 Failure Mode B Fix: save ALL three fields back to the CORRECT letter ID
        onUpdateLetter(letter.id, {
          content: result.newContent,
          htmlContent: result.newHtmlContent,
          bodyContent: result.newBodyContent,
        });
      } else {
        // Exhausted all attempts — still close and let user see the error in the next validate
        console.warn('[ValidationModal] Regeneration exhausted:', result.errorMessage);
      }
    } catch (err) {
      // Silent — keep existing letter on catastrophic error
      console.error('[ValidationModal] Regeneration threw unexpectedly:', err);
    }

    setRegenerating(false);
    onClose();
  };

  // ── Force-approve handler ─────────────────────────────────────────────────
  // Only available when there are ZERO hard errors (warnings only).
  const handleForceApprove = () => {
    if (letter) {
      onUpdateLetter(letter.id, { status: "Sent" });
    }
    onClose();
  };

  // ── View letter handler ───────────────────────────────────────────────────
  const handleViewLetter = () => {
    if (letter) {
      onViewLetter(letter);
    }
    onClose();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#0a0a0a] border border-red-500/30 rounded-lg p-6 max-w-lg w-full space-y-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-red-400">
            <AlertCircle size={18} />
            <h3 className="text-sm font-bold">
              {hasErrors ? "LETTER VALIDATION FAILED" : "LETTER VALIDATION WARNINGS"}
            </h3>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close validation modal"
            className="text-zinc-600 hover:text-white p-1"
          >
            <X size={14} />
          </button>
        </div>

        {/* Errors */}
        {hasErrors && (
          <div>
            <div className="text-[10px] font-mono text-red-500 mb-2 flex items-center gap-1">
              <ShieldAlert size={10} /> ERRORS ({modal.errors.length}) — must fix before sending
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
              {modal.errors.map((err, i) => (
                <div
                  key={i}
                  className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-2 py-1.5"
                >
                  • {err}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Warnings */}
        {hasWarnings && (
          <div>
            <div className="text-[10px] font-mono text-[#ff9900] mb-2">
              WARNINGS ({modal.warnings.length})
            </div>
            <div className="space-y-1 max-h-36 overflow-y-auto custom-scrollbar">
              {modal.warnings.map((warn, i) => (
                <div
                  key={i}
                  className="text-xs text-[#ff9900] bg-[#ff9900]/10 border border-[#ff9900]/20 rounded px-2 py-1.5"
                >
                  • {warn}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Self-healing note */}
        {hasErrors && (
          <p className="text-[10px] font-mono text-zinc-500">
            Click <span className="text-[#00ffff]">Regenerate</span> to re-run AI generation
            with these errors injected as explicit fix directives.
          </p>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap pt-1">
          {/* Regenerate — always available when a linked letter exists */}
          {letter && primaryItem && (
            <button
              disabled={regenerating}
              onClick={handleRegenerate}
              className="flex-1 cyber-button border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-4 py-2 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {regenerating ? (
                <>
                  <RefreshCw size={13} className="animate-spin" /> Regenerating…
                </>
              ) : (
                <>⚡ Regenerate Letter</>
              )}
            </button>
          )}

          {/* Force Approve — only when there are NO hard errors (warnings only) */}
          {!hasErrors && hasWarnings && (
            <button
              onClick={handleForceApprove}
              className="flex-1 cyber-button border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/10 px-4 py-2 text-sm"
            >
              ⚠️ Force Approve
            </button>
          )}

          {/* View Letter */}
          {letter && (
            <button
              onClick={handleViewLetter}
              className="flex-1 cyber-button border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-4 py-2 text-sm flex items-center justify-center gap-1"
            >
              <Eye size={13} /> VIEW LETTER
            </button>
          )}

          {/* Close */}
          <button
            onClick={onClose}
            className="flex-1 cyber-button border-zinc-700 text-zinc-400 hover:bg-zinc-800 px-4 py-2 text-sm"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
};
