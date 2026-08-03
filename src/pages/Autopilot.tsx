import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Zap, BrainCircuit, Activity, Play, Pause,
  Search, Clock, Terminal,
  AlertTriangle, Target, RefreshCw, Send, TrendingUp,
  Mail, Shield, BarChart2,
  FileText, Layers, Settings2, FlameKindling, Siren, Calendar,
  Copy, CheckSquare, Star, SkipForward, Megaphone,
  Inbox, List, Hash, Stamp, Package, Table2, Bot,
} from "lucide-react";
import { useAppContext, calcPriorityScore } from "../context/AppContext";
import {
  checkOverdueItems, getDaysRemaining,
  ESCALATION_LADDER, BUREAUS,
  autoDetectGoodwill, autoDetectP4D, checkSolPause,
  checkDoubleVerified, getAutoAdvanceRound, recalcPriorityAfterVerification,
  getFollowUpCandidates, buildDisputeCalendar, computeAutopilotIntel,
  getGoodwillPostWinCandidates, detectDisputeFatigue, getSOLCalendarEntries,
  detectPaymentPlanCandidates, getMilestoneAlerts, getCFPBAutoEscalationCandidates,
  canLaunchAdditionalCampaign,
} from "../services/autopilotEngine";
import {
  generateCFPBComplaint,
  generateFurnisherBypassLetter,
} from "../services/geminiService";
import { v4 as uuidv4 } from "uuid";
import type { AutopilotCampaign, NegativeItem, DisputeItemStatus, DisputeRound, DisputeLetter } from "../types";
import ScoreSimulator from "../components/ScoreSimulator";
import DisputeTimeline from "../components/DisputeTimeline";
import CrossBureauMatrix from "../components/CrossBureauMatrix";

import { AutoPilotDashboard } from "../components/AutoPilotDashboard";
import type { ResponseOutcome, ResponseOption } from "../components/AutoPilotDashboard";
import { AutoPilotEngineV2, DEFAULT_SETTINGS_V3 } from "../services/autoPilotEngineV2";
import { AutopilotOrchestrator } from "../services/autopilotOrchestrator";
import { MissionControlPanel } from "../components/MissionControlPanel";
import type { AppPage } from "../App";
import { HoldQueue } from "../services/holdQueue";
import { TimelineTracker } from "../services/timelineTracker";
import { AndroidScheduler } from "../services/platform/androidScheduler";
import type { AutoPilotSettingsV3, AutoPilotEngineState, HoldQueueEntry, FCRADeadline, PassNumber, AutoPilotCycleResult, FailedDisputeLetter } from "../types/creditRepair";
import { getBureauCreditorStats, loadOutcomesFromIdb } from "../services/disputeOutcomeTracker";
import { getResolvedAccountNumber } from "../services/tradelineMerger";
import { markDisputeResolutionTaskResubmitted, type DisputeResolutionTask } from "../services/disputeResolutionQueue";
import { regenerateLetterWithContext, type RegenerationRequest } from "../services/regenerationService";

function resolveResponseOutcome(item: NegativeItem, outcome: ResponseOutcome): { newStatus: string; newRound: number; logMessage: string } {
  const currentRound = item.disputeRound || 1;
  if (outcome === "Deleted") {
    return { newStatus: "Won", newRound: currentRound, logMessage: `Item ${item.creditorName} marked as Won (Deleted by bureau)` };
  }
  if (outcome === "Verified" || outcome === "Updated") {
    const statusMap: Record<number, string> = {
      1: "Round1-Verified",
      2: "Round2-Verified",
      3: "Round3-Verified",
      4: "Round4-Verified",
      5: "Round5-Verified",
      6: "Round6-PreLit",
    };
    return { newStatus: statusMap[currentRound] || "Round1-Verified", newRound: currentRound, logMessage: `Item ${item.creditorName} verified by bureau in Round ${currentRound}` };
  }
  const nextRound = Math.min(6, currentRound + 1);
  const pendingMap: Record<number, string> = {
    1: "Round1-Pending",
    2: "Round2-Pending",
    3: "Round3-Pending",
    4: "Round4-Legal",
    5: "Round5-CFPB",
    6: "Round6-PreLit",
  };
  return { newStatus: pendingMap[nextRound] || "Round1-Pending", newRound: nextRound, logMessage: `Item ${item.creditorName} advanced to Round ${nextRound}` };
}

type ActiveTab = "v4" | "command" | "arsenal" | "mail-queue" | "campaigns" | "intel" | "pipeline" | "validation" | "simulator" | "cross-bureau" | "responses";

const FORCE_STRATEGY_OPTIONS = [
  { value: "default", label: "Default (Campaign)" },
  { value: "goodwill", label: "Goodwill Only" },
  { value: "pay-for-delete", label: "Pay-for-Delete" },
  { value: "aggressive", label: "Aggressive Force" },
  { value: "legal", label: "Legal Demand" },
] as const;

const RESPONSE_OPTIONS: ResponseOption[] = ["Verified", "Deleted", "Updated", "NoResponse"];

export function Autopilot({ onNavigate }: { onNavigate?: (page: AppPage) => void }) {
  const {
    autopilot, updateAutopilot, negativeItems, disputeLetters,
    personalInfo, isPersonalInfoComplete, addDisputeLetter, updateDisputeItemStatus, addAutopilotLog,
    autopilotLogs, campaigns, addCampaign, updateCampaign, addBatchToCampaign, updateBatch,
    logEvent, updateNegativeItem, scoreEntries, updateDisputeLetter, contacts, addXP,
    vaultDocs, activeProfileId,
  } = useAppContext();

  const isActive = autopilot.enabled;
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("v4");
  const [responseTarget, setResponseTarget] = useState<{ itemId: string; bureau: string } | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<ResponseOption>("Verified");
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<{ itemCount: number; bureaus: string[]; round: number; dualDispute: boolean; mailMode: string; scheduledDate: string } | null>(null);
  const [cfpbModal, setCfpbModal] = useState<{ content: string; copied: boolean } | null>(null);
  const [furnisherBypassModal, setFurnisherBypassModal] = useState<{ content: string; itemName: string } | null>(null);
  const [successReportModal, setSuccessReportModal] = useState<{ content: string; campaignName: string } | null>(null);
  const [scheduledDate, setScheduledDate] = useState("");
  const [validationNotes, setValidationNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    const waiting = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; retryAt: number }>).detail;
      const seconds = Math.max(1, Math.ceil((detail.retryAt - Date.now()) / 1000));
      addAutopilotLog({ message: `[AI QUEUE] ${detail.taskId} is waiting ${seconds}s for Groq/Gemini capacity. No generic letter will be created.`, level: 'info', type: 'system' as const });
    };
    const resumed = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string }>).detail;
      addAutopilotLog({ message: `[AI QUEUE] Resuming ${detail.taskId} with Groq/Gemini.`, level: 'info', type: 'system' as const });
    };
    window.addEventListener('queue:waiting', waiting);
    window.addEventListener('queue:resumed', resumed);
    return () => {
      window.removeEventListener('queue:waiting', waiting);
      window.removeEventListener('queue:resumed', resumed);
    };
  }, [addAutopilotLog]);

  // ─── V2 Engine State for AutoPilotDashboard ──────────────────────────────
  const profileId =
    activeProfileId ||
    (typeof window !== 'undefined'
      ? ((window as any).__dylandos_active_profile_id as string | undefined) ??
        localStorage.getItem('dylandos_active_profile_v4')
      : null) ||
    'default';
  const evidenceDocs = vaultDocs.map((d) => ({
    id: d.id,
    category: d.category || d.type || 'other',
    tags: d.tags,
    name: d.name,
  }));
  const [v2EngineState, setV2EngineState] = useState<AutoPilotEngineState>(() => AutoPilotEngineV2.loadState());
  const [v2Settings, setV2Settings] = useState<AutoPilotSettingsV3>(() => {
    try {
      const saved = localStorage.getItem("dylandos_autopilot_v2_settings");
      return saved ? { ...DEFAULT_SETTINGS_V3, ...JSON.parse(saved) } : DEFAULT_SETTINGS_V3;
    } catch { return DEFAULT_SETTINGS_V3; }
  });
  const [v2HoldEntries, setV2HoldEntries] = useState<HoldQueueEntry[]>(() => HoldQueue.getAll(profileId));
  const [v2Deadlines, setV2Deadlines] = useState<FCRADeadline[]>(() => TimelineTracker.getByProfile(profileId));
  const [v2PassNumbers, setV2PassNumbers] = useState<Record<string, PassNumber>>(() => {
    try { return JSON.parse(localStorage.getItem(`dylandos_item_passes_v2_${profileId}`) || "{}"); } catch { return {}; }
  });
  const [v2LastCycleResult, setV2LastCycleResult] = useState<AutoPilotCycleResult | null>(v2EngineState.lastCycleResult);
  // The engine protects the lease, but this immediate UI lock prevents a fast
  // second click from producing a noisy "profile lease held" error.
  const v2CycleInFlight = useRef(false);
  const [failedDisputeLetters, setFailedDisputeLetters] = useState<FailedDisputeLetter[]>(() => {
    try {
      const saved = localStorage.getItem(`dylandos_failed_letters_${profileId}`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Refresh V2 data periodically
  useEffect(() => {
    const refresh = () => {
      setV2EngineState(AutoPilotEngineV2.getState());
      setV2HoldEntries(HoldQueue.getAll(profileId));
      setV2Deadlines(TimelineTracker.getByProfile(profileId));
      try { setV2PassNumbers(JSON.parse(localStorage.getItem(`dylandos_item_passes_v2_${profileId}`) || "{}")); } catch {}
    };
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [profileId]);

  const handleRedoFailedLetter = useCallback(async (failed: FailedDisputeLetter) => {
    const item = negativeItems.find((i) => i.id === failed.itemId);
    if (!item) return;

    addAutopilotLog({
      message: `[REDO] Regenerating dispute letter for ${failed.itemName} (${failed.bureau || 'Bureau'})...`,
      level: 'info',
      type: 'system' as const,
    });

    try {
      const tempLetter: DisputeLetter = {
        id: failed.id || uuidv4(),
        negativeItemIds: [item.id],
        content: '',
        createdAt: new Date().toISOString(),
        status: 'Draft',
        bureau: (failed.bureau || item.creditBureau?.[0] || 'Experian') as any,
        round: (Math.min(failed.passNumber || 1, 6) as DisputeRound),
        templateType: '611-Reinvestigation',
        batchId: null,
      };

      const request: RegenerationRequest = {
        letter: tempLetter,
        originalErrors: [failed.reason],
        personalInfo: {
          firstName: personalInfo.firstName || '',
          lastName: personalInfo.lastName || '',
          address: personalInfo.address || '',
          city: personalInfo.city || '',
          state: personalInfo.state || '',
          zip: personalInfo.zip || '',
          phone: personalInfo.phone || '',
          email: personalInfo.email || '',
          ssn: personalInfo.ssn || '',
          dob: personalInfo.dob || '',
        },
        negativeItem: item,
        passNumber: (Math.min(failed.passNumber || 1, 6) as PassNumber),
        targetBureau: failed.bureau || item.creditBureau?.[0] || 'Experian',
      };

      const regenResult = await regenerateLetterWithContext(request, 3);
      if (regenResult.success && (regenResult.newContent || regenResult.newHtmlContent)) {
        const newDisputeLetter: DisputeLetter = {
          id: uuidv4(),
          negativeItemIds: [item.id],
          content: regenResult.newContent || '',
          htmlContent: regenResult.newHtmlContent || undefined,
          letterVersion: 'v2',
          createdAt: new Date().toISOString(),
          status: 'Draft',
          bureau: failed.bureau || item.creditBureau?.[0] || 'Experian',
          round: (Math.min(failed.passNumber || 1, 6) as DisputeRound),
          templateType: '611-Reinvestigation',
          batchId: null,
          certifiedMail: autopilot.certifiedMailDefault,
          mailed: false,
          mailedAt: null,
        };

        addDisputeLetter(newDisputeLetter);
        setFailedDisputeLetters((prev) => {
          const next = prev.filter((f) => f.id !== failed.id && f.itemId !== failed.itemId);
          try { localStorage.setItem(`dylandos_failed_letters_${profileId}`, JSON.stringify(next)); } catch {}
          return next;
        });

        addAutopilotLog({
          message: `[REDO SUCCESS] ✅ Regenerated letter for ${failed.itemName} → saved to mail queue!`,
          level: 'success',
          type: 'system' as const,
        });
      } else {
        addAutopilotLog({
          message: `[REDO FAILED] Could not regenerate letter for ${failed.itemName}: ${regenResult.errorMessage || 'AI generation failed'}`,
          level: 'error',
          type: 'system' as const,
        });
      }
    } catch (err: any) {
      addAutopilotLog({
        message: `[REDO ERROR] Unexpected failure while redoing ${failed.itemName}: ${err.message}`,
        level: 'error',
        type: 'system' as const,
      });
    }
  }, [negativeItems, personalInfo, v2Settings, profileId, addAutopilotLog, addDisputeLetter]);

  const handleRedoAllFailedLetters = useCallback(async () => {
    for (const failed of [...failedDisputeLetters]) {
      await handleRedoFailedLetter(failed);
    }
  }, [failedDisputeLetters, handleRedoFailedLetter]);

  const handleV2RunCycle = useCallback(async (onlyItemIds?: string[]) => {
    if (v2CycleInFlight.current) {
      addAutopilotLog({ message: "[V2] A cycle is already running. The request was ignored to protect the active letter queue.", level: "info", type: "system" as const });
      return;
    }
    if (!isPersonalInfoComplete) {
      addAutopilotLog({
        message: "[V2 PREFLIGHT FAILED] Missing profile fields: first name, last name, street, city, state, or ZIP.",
        level: "error",
        type: 'system' as const,
      });
      return;
    }

    v2CycleInFlight.current = true;
    setV2EngineState((current) => ({ ...current, isRunning: true }));

    const now = Date.now();
    const cycleItems = onlyItemIds?.length ? negativeItems.filter((item) => onlyItemIds.includes(item.id)) : negativeItems;
    const overdueForNextRound = cycleItems.filter((item) => {
      const deadline = item.disputeDeadline ? new Date(item.disputeDeadline).getTime() : NaN;
      return Number.isFinite(deadline)
        && deadline < now
        && item.disputeRound < 6
        && item.disputeStatus !== "Won"
        && item.disputeStatus !== "Deleted";
    });
    for (const item of overdueForNextRound) {
      const currentPass = AutoPilotEngineV2.getPassNumber(profileId, item.id);
      const nextPass = Math.min(6, Math.max(currentPass, (item.disputeRound ?? 1) + 1)) as PassNumber;
      if (nextPass > currentPass) {
        AutoPilotEngineV2.setPassNumber(profileId, item.id, nextPass);
        updateDisputeItemStatus(item.id, resolveResponseOutcome(item, "NoResponse").newStatus as import('../types').DisputeItemStatus, nextPass as DisputeRound);
        addAutopilotLog({
          message: `[DEADLINE] ${item.creditorName} passed its Round ${item.disputeRound} response deadline — Round ${nextPass} draft queued for review.`,
          level: "warning",
          type: "system" as const,
          metadata: { itemId: item.id },
        });
      }
    }

    let result: AutoPilotCycleResult | null = null;
    try {
      const orchestrated = await AutopilotOrchestrator.runCycle({
        profileId,
        items: cycleItems,
        personalInfo: {
          firstName: personalInfo.firstName || "",
          lastName: personalInfo.lastName || "",
          address: personalInfo.address || "",
          city: personalInfo.city || "",
          state: personalInfo.state || "",
          zip: personalInfo.zip || "",
          phone: personalInfo.phone || "",
          email: personalInfo.email || "",
          ssn: personalInfo.ssn || "",
          dob: personalInfo.dob || "",
        },
        settings: v2Settings,
        mode: "guided",
        vaultDocs: evidenceDocs,
        onProgress: (msg) => addAutopilotLog({ message: `[V2] ${msg}`, level: "info", type: 'system' as const }),
        priorLetters: disputeLetters.map((l) => ({
          itemId: l.negativeItemIds?.[0] ?? '',
          content: l.content || l.bodyContent || l.htmlContent || '',
          bureau: l.bureau,
        })).filter((l) => l.itemId && l.content),
        hasReports: cycleItems.length > 0,
        onStatusUpdate: (planItem, pass) => {
          const statusMap: Record<number, import('../types').DisputeItemStatus> = {
            1: "Round1-Pending",
            2: "Round2-Pending",
            3: "Round3-Pending",
            4: "Round4-Legal",
            5: "Round5-CFPB",
            6: "Round6-PreLit",
          };
          const newStatus = statusMap[pass] ?? "Round1-Pending";
          updateDisputeItemStatus(planItem.itemId, newStatus, Math.min(pass, 6) as import('../types').DisputeRound);
        },
      });

      result = orchestrated.cycle;

      if (result && result.errors && result.errors.length > 0) {
        result.errors.forEach((e) => addAutopilotLog({ message: `[V2 ERROR] ${e}`, level: "error", type: 'system' as const }));
      }
      addAutopilotLog({ message: `[V2 CYCLE] Complete — ${result?.lettersGenerated ?? 0} letters, ${result?.itemsOnHold ?? 0} on hold`, level: "success", type: 'system' as const });
      logEvent({ type: "autopilot_cycle_run", title: "AutoPilot V2 Cycle Complete", detail: `${result?.lettersGenerated ?? 0} letters generated, ${result?.itemsOnHold ?? 0} items on hold` });
    } catch (err: any) {
      addAutopilotLog({ message: `[V2 CYCLE ERROR] ${err.message}`, level: "error", type: 'system' as const });
    } finally {
      v2CycleInFlight.current = false;
      setV2EngineState(AutoPilotEngineV2.getState());
      if (result) setV2LastCycleResult(result);
      setV2HoldEntries(HoldQueue.getAll(profileId));
      setV2Deadlines(TimelineTracker.getByProfile(profileId));
    }
  }, [profileId, negativeItems, personalInfo, isPersonalInfoComplete, v2Settings, evidenceDocs, addAutopilotLog, addDisputeLetter, updateDisputeItemStatus, logEvent, disputeLetters]);

  const handleResubmitFailedTask = useCallback((task: DisputeResolutionTask) => {
    markDisputeResolutionTaskResubmitted(task.id);
    addAutopilotLog({ message: `[RECOVERY] Resubmitting only ${task.creditorName}${task.targetName ? ` → ${task.targetName}` : ''}.`, level: 'info', type: 'system' as const, metadata: { itemId: task.itemId } });
    void handleV2RunCycle([task.itemId]);
  }, [addAutopilotLog, handleV2RunCycle]);

  const handleV2LogResponse = useCallback((itemId: string, outcome: ResponseOutcome, bureau: string) => {
    const item = negativeItems.find((i) => i.id === itemId);
    if (!item) return;

    const passForItem = (v2PassNumbers[item.id] ?? Math.min(6, Math.max(1, item.disputeRound))) as PassNumber;
    const outcomeMap: Record<ResponseOutcome, 'deleted' | 'verified' | 'updated' | 'no_response'> = {
      Deleted: 'deleted',
      Verified: 'verified',
      Updated: 'updated',
      NoResponse: 'no_response',
    };

    const latestLetter = [...disputeLetters]
      .filter((l) => l.negativeItemIds.includes(item.id) && (l.bureau === bureau || l.bureau === item.creditorName))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    void AutoPilotEngineV2.handleResponse({
      profileId,
      itemId: item.id,
      bureau,
      outcome: outcomeMap[outcome],
      passNumber: passForItem,
      letterId: latestLetter?.id || `manual-${item.id}-${Date.now()}`,
      settings: v2Settings,
    }).then(() => {
      setV2EngineState(AutoPilotEngineV2.getState());
      setV2HoldEntries(HoldQueue.getAll(profileId));
      setV2Deadlines(TimelineTracker.getByProfile(profileId));
      try {
        setV2PassNumbers(JSON.parse(localStorage.getItem(`dylandos_item_passes_v2_${profileId}`) || "{}"));
      } catch {
        setV2PassNumbers({});
      }
    }).catch((err) => {
      addAutopilotLog({ message: `[V2 RESPONSE ERROR] ${(err as Error).message}`, level: "error", type: 'system' as const, metadata: { itemId: item.id } });
    });

    const newStatus = resolveResponseOutcome(item, outcome).newStatus as import('../types').DisputeItemStatus;
    const nextRound = outcome === "NoResponse"
      ? (Math.min(6, item.disputeRound + 1) as DisputeRound)
      : item.disputeRound;
    updateDisputeItemStatus(item.id, newStatus, nextRound);

    if (outcome === 'Verified') {
      const newVerCount = (item.verificationCount ?? 0) + 1;
      updateNegativeItem(item.id, {
        verificationCount: newVerCount,
        doubleVerified: newVerCount >= 2,
        priorityScore: Math.max(0, (item.priorityScore ?? 50) - 10),
      });
    }

    addAutopilotLog({ message: `[V2 RESPONSE] ${item.creditorName} — ${bureau}: ${outcome}`, level: outcome === 'Deleted' ? 'success' : outcome === 'Verified' ? 'warning' : 'info', type: 'system' as const, metadata: { itemId: item.id } });
    logEvent({ type: 'response_logged', title: 'Bureau Response Logged', detail: `${item.creditorName} (${bureau}): ${outcome}`, itemId: item.id, bureau, outcome });
  }, [negativeItems, disputeLetters, profileId, v2PassNumbers, v2Settings, updateDisputeItemStatus, updateNegativeItem, addAutopilotLog, logEvent]);

  const handleV2EnableToggle = useCallback(async (enabled: boolean) => {
    const updated = { ...v2Settings, enabled };
    setV2Settings(updated);
    localStorage.setItem("dylandos_autopilot_v2_settings", JSON.stringify(updated));
    // Keep legacy AppContext flag in sync so Cases Mission Control matches Autopilot.
    updateAutopilot({ enabled });
    try {
      if (enabled) {
        await AutoPilotEngineV2.scheduleNextCycle(updated, profileId);
        setV2EngineState(AutoPilotEngineV2.getState());
        // Android WorkManager (best-effort)
        try {
          const scheduler = new AndroidScheduler();
          if (await scheduler.isAvailable()) {
            const next = AutoPilotEngineV2.getState().nextCycleDate
              ? new Date(AutoPilotEngineV2.getState().nextCycleDate as string)
              : new Date(Date.now() + (updated.cycleIntervalDays || 32) * 86400000);
            await scheduler.enable(next, [], [], { cycleIntervalDays: updated.cycleIntervalDays, maxPassCount: 6 });
          }
        } catch { /* not on Android or plugin missing */ }
      } else {
        await AutoPilotEngineV2.cancelSchedule();
        setV2EngineState(AutoPilotEngineV2.getState());
        try {
          const scheduler = new AndroidScheduler();
          if (await scheduler.isAvailable()) {
            await scheduler.disable();
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      addAutopilotLog({
        message: `[V2 SCHEDULER] Failed to ${enabled ? "enable" : "cancel"} schedule: ${String(err)}`,
        level: "error",
        type: "system" as const,
      });
    }
  }, [v2Settings, profileId, addAutopilotLog, updateAutopilot]);

  // Electron Autopilot trigger / overdue listeners
  useEffect(() => {
    const api = (window as any).electronAPI;
    if (!api) return;

    const onTrigger = () => {
      addAutopilotLog({
        message: "[V2 SCHEDULER] Electron autopilot:trigger received — cycle ready for review",
        level: "info",
        type: "system" as const,
      });
      setV2EngineState(AutoPilotEngineV2.loadState());
    };

    const unsubOverdue = api.onAutoPilotCycleOverdue?.(() => {
      addAutopilotLog({
        message: "[V2 SCHEDULER] Cycle overdue notice received",
        level: "warning",
        type: "system" as const,
      });
    });

    api.onAutopilotTrigger?.(onTrigger);
    return () => {
      api.removeAutopilotTriggerListener?.();
      if (typeof unsubOverdue === "function") unsubOverdue();
    };
  }, [addAutopilotLog]);

  const handleV2UpdateSettings = useCallback((updates: Partial<AutoPilotSettingsV3>) => {
    const updated = { ...v2Settings, ...updates };
    setV2Settings(updated);
    localStorage.setItem("dylandos_autopilot_v2_settings", JSON.stringify(updated));
  }, [v2Settings]);

  const activeCampaign = campaigns.find((c) => c.id === autopilot.activeCampaignId) || null;
  const overdueItems = checkOverdueItems(negativeItems, disputeLetters);
  const undisputedItems = negativeItems.filter((i) => i.disputeStatus === "Undisputed");
  const pendingItems = negativeItems.filter((i) => (i.disputeStatus ?? "").includes("Pending"));
  const wonItems = negativeItems.filter((i) => i.disputeStatus === "Won" || i.disputeStatus === "Deleted");
  const solPausedItems = negativeItems.filter((i) => checkSolPause(i) && i.disputeStatus !== "Won" && i.disputeStatus !== "Deleted");
  const doubleVerifiedItems = negativeItems.filter((i) => checkDoubleVerified(i));
  const mailQueueLetters = disputeLetters.filter((l) => l.status === "Draft");
  const sentLetters = disputeLetters.filter((l) => l.status === "Sent");
  const followUpCandidates = getFollowUpCandidates(negativeItems, disputeLetters);
  const fatigueItems = detectDisputeFatigue(negativeItems);
  const solCalendar = getSOLCalendarEntries(negativeItems);
  const paymentPlanCandidates = detectPaymentPlanCandidates(negativeItems);
  const cfpbAutoCandidates = getCFPBAutoEscalationCandidates(negativeItems);
  const goodwillPostWin = getGoodwillPostWinCandidates(negativeItems);
  const intel = computeAutopilotIntel(negativeItems, disputeLetters, campaigns);
  const disputeCalendar = buildDisputeCalendar(negativeItems);
  const latestScore = scoreEntries.length
    ? [...scoreEntries].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0]
    : null;
  const avgScore = latestScore
    ? [latestScore.equifax, latestScore.experian, latestScore.transunion].filter((v): v is number => typeof v === "number").reduce((s, v, _, arr) => s + v / arr.length, 0)
    : null;
  const milestones = getMilestoneAlerts(negativeItems, disputeLetters);
  const confirmedAccuracyCount = negativeItems.filter((item) => item.accuracyConfirmedByUser).length;
  const validationQueueItems = negativeItems.filter((item) => {
    if (item.disputeStatus === "Won" || item.disputeStatus === "Deleted") return false;
    const lowConfidence = typeof item.parseConfidence === "number" && item.parseConfidence < 0.7;
    const missingCritical = !item.creditorName || !getResolvedAccountNumber(item) || !item.status;
    const parserNeedsReview = item.dataSource === "parser" && (lowConfidence || missingCritical);
    const notConfirmed = !item.accuracyConfirmedByUser;
    return parserNeedsReview || notConfirmed;
  });

  // Auto-detect goodwill + P4D + SOL flags on item changes
  useEffect(() => {
    negativeItems.forEach((item) => {
      const goodwill = autoDetectGoodwill(item);
      const p4d = autoDetectP4D(item);
      const sol = checkSolPause(item);
      if (item.goodwillEligible !== goodwill || item.p4dEligible !== p4d || item.solPaused !== sol) {
        updateNegativeItem(item.id, { goodwillEligible: goodwill, p4dEligible: p4d, solPaused: sol });
      }
    });
  }, [negativeItems, updateNegativeItem]);

  // Auto-check overdue items when autopilot is active
  useEffect(() => {
    if (!isActive || overdueItems.length === 0) return;
    overdueItems.forEach((item) => {
      addAutopilotLog({ message: `⚡ OVERDUE: ${item.creditorName} Round ${item.disputeRound} deadline expired — queued for escalation`, level: "warning", type: 'system' as const, metadata: { itemId: item.id } });
    });
  }, [isActive, overdueItems.length, addAutopilotLog]);

  // Upgrade 10 — Auto-advance rounds
  useEffect(() => {
    if (!autopilot.autoAdvanceRounds || !activeCampaign || !isActive) return;
    const nextRound = getAutoAdvanceRound(activeCampaign as any);
    if (nextRound && nextRound !== activeCampaign.currentRound) {
      updateCampaign(activeCampaign.id, { currentRound: nextRound as DisputeRound });
      addAutopilotLog({ message: `[AUTO-ADVANCE] All Round ${activeCampaign.currentRound} responses collected — advancing to Round ${nextRound}`, level: "success", type: 'system' as const });
    }
  }, [autopilot.autoAdvanceRounds, activeCampaign, isActive, negativeItems, updateCampaign, addAutopilotLog]);

  useEffect(() => {
    if (!autopilot.smartFollowUp || !isActive || followUpCandidates.length === 0) return;
    addAutopilotLog({
      message: `[FOLLOW-UP] ${followUpCandidates.length} item(s) at day 25-29 without response — recommend immediate follow-up demand`,
      level: "warning",
      type: 'system' as const,
    });
  }, [autopilot.smartFollowUp, followUpCandidates.length, isActive]);

  useEffect(() => {
    if (!autopilot.fatigueDetect || fatigueItems.length === 0) return;
    addAutopilotLog({
      message: `[FATIGUE] ${fatigueItems.length} item(s) repeatedly verified — switch to furnisher bypass / CFPB escalation`,
      level: "warning",
      type: 'system' as const,
    });
  }, [autopilot.fatigueDetect, fatigueItems.length]);

  useEffect(() => {
    if (!autopilot.cfpbAutoEscalate || cfpbAutoCandidates.length === 0) return;
    addAutopilotLog({
      message: `[CFPB AUTO] ${cfpbAutoCandidates.length} Round 3+ verified item(s) qualify for auto-escalation`,
      level: "error",
      type: 'system' as const,
    });
  }, [autopilot.cfpbAutoEscalate, cfpbAutoCandidates.length]);

  useEffect(() => {
    if (!autopilot.goodwillPostWin || goodwillPostWin.length === 0) return;
    addAutopilotLog({
      message: `[GOODWILL POST-WIN] ${goodwillPostWin.length} resolved late-payment account(s) eligible for goodwill follow-through`,
      level: "info",
      type: 'system' as const,
    });
  }, [autopilot.goodwillPostWin, goodwillPostWin.length]);

  const strategies = [
    { id: "item_verify", name: "Item Verification", desc: "FCRA §611 burden-of-proof. Challenge bureau's legal right to report without full documentation.", icon: Search, color: "text-[#00ffff]" },
    { id: "methodical", name: "Methodical", desc: "Oldest items first. 1/3 per round. Wait for responses before each new batch.", icon: Clock, color: "text-[#ff9900]" },
    { id: "aggressive", name: "Aggressive", desc: "Highest priority first. All bureaus simultaneously. 1/3 per round.", icon: Zap, color: "text-[#ff00ff]" },
    { id: "aggressive_plus", name: "AGGRESSIVE+", desc: "ALL items. ALL bureaus. AggressiveDual template. Bureau + furnisher in parallel. Maximum legal pressure.", icon: FlameKindling, color: "text-red-400" },
  ];

  const startNewCampaign = useCallback(() => {
    const activeCount = campaigns.filter((c) => c.status === "Active").length;
    if (!canLaunchAdditionalCampaign(activeCount, 3)) {
      addAutopilotLog({ message: "[CAMPAIGN] Max concurrent campaigns reached (3). Complete/pause one before starting another.", level: "warning", type: 'system' as const });
      return;
    }
    const campaign: AutopilotCampaign = {
      id: uuidv4(),
      name: `Campaign ${new Date().toLocaleDateString()}`,
      startDate: new Date().toISOString(),
      totalItems: negativeItems.length,
      resolvedItems: wonItems.length,
      currentRound: 1,
      status: "Active",
      batches: [],
    };
    addCampaign(campaign);
    updateAutopilot({ activeCampaignId: campaign.id, enabled: true });
    addAutopilotLog({ message: `[CAMPAIGN] Started: ${campaign.name} — ${negativeItems.length} items in scope`, level: "info", type: 'system' as const });
  }, [campaigns, negativeItems, wonItems, addCampaign, updateAutopilot, addAutopilotLog]);

  const runBatch = useCallback(async (dryRun = false) => {
    if (!isPersonalInfoComplete) {
      addAutopilotLog({
        message: "[PREFLIGHT FAILED] AutoPilot aborted: complete your profile name and mailing address before running.",
        level: "error",
        type: 'system' as const,
      });
      return;
    }

    if (!activeCampaign) { startNewCampaign(); return; }

    if (dryRun) {
      const bureaus = [...BUREAUS];
      setPreviewData({
        itemCount: negativeItems.filter((i) => i.disputeStatus === "Undisputed" || (i.disputeStatus ?? "").includes("Verified")).length,
        bureaus,
        round: activeCampaign.currentRound,
        dualDispute: autopilot.dualDispute,
        mailMode: autopilot.certifiedMailDefault ? "Certified Mail ($)" : "Regular Stamp",
        scheduledDate: scheduledDate || "Send immediately",
      });
      setShowPreviewModal(true);
      return;
    }

    // V2 is the single production autopilot path.
    setIsRunning(true);
    try {
      await handleV2RunCycle();
    } finally {
      setIsRunning(false);
    }
  }, [isPersonalInfoComplete, activeCampaign, startNewCampaign, negativeItems, autopilot, scheduledDate, handleV2RunCycle]);

  const handleLogResponse = useCallback(() => {
    if (!responseTarget) return;
    const item = negativeItems.find((i) => i.id === responseTarget.itemId);
    if (!item) return;
    const { newStatus, newRound, logMessage } = resolveResponseOutcome(item, selectedResponse);
    updateDisputeItemStatus(item.id, newStatus as import('../types').DisputeItemStatus, newRound as import('../types').DisputeRound);
    // Upgrade 17 — Smart re-sort: boost priority on verification
    if (selectedResponse === "Verified") {
      updateNegativeItem(item.id, {
        priorityScore: recalcPriorityAfterVerification(item),
        verificationCount: (item.verificationCount || 0) + 1,
        doubleVerified: (item.verificationCount || 0) >= 1,
      });
    }
    addAutopilotLog({ message: logMessage, level: newStatus === "Won" ? "success" : "warning", type: 'system' as const, metadata: { itemId: item.id } });
    logEvent({ type: "response_logged", title: "Bureau Response Logged", detail: logMessage, itemId: item.id, bureau: responseTarget.bureau, outcome: selectedResponse });
    setResponseTarget(null);
  }, [responseTarget, selectedResponse, negativeItems, updateDisputeItemStatus, addAutopilotLog, logEvent, updateNegativeItem]);

  // Upgrade 12 — CFPB Complaint
  const handleGenerateCFPB = useCallback(async (bureau: string) => {
    const items = negativeItems.filter((i) => i.disputeRound >= 3);
    if (items.length === 0) { addAutopilotLog({ message: "[CFPB] No Round 3+ items found. Escalate to Round 3 first.", level: "warning", type: 'system' as const }); return; }
    addAutopilotLog({ message: `[CFPB] Generating complaint narrative for ${bureau}...`, level: "info", type: 'system' as const });
    try {
      const complaint = await generateCFPBComplaint(items, { name: `${personalInfo.firstName} ${personalInfo.lastName}`, address: `${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}`, ssn: personalInfo.ssn, dob: personalInfo.dob }, bureau, activeCampaign?.currentRound || 4);
      setCfpbModal({ content: complaint, copied: false });
    } catch (err: any) {
      addAutopilotLog({ message: `[CFPB] Failed: ${err.message}`, level: "error", type: 'system' as const });
    }
  }, [negativeItems, personalInfo, activeCampaign, addAutopilotLog]);

  // Upgrade 11 — Furnisher bypass
  const handleFurnisherBypass = useCallback(async (itemId: string) => {
    const item = negativeItems.find((i) => i.id === itemId);
    if (!item) return;
    addAutopilotLog({ message: `[BYPASS] Generating furnisher bypass letter for ${item.creditorName}...`, level: "warning", type: 'system' as const });
    try {
      const content = await generateFurnisherBypassLetter([item], { name: `${personalInfo.firstName} ${personalInfo.lastName}`, address: `${personalInfo.address}, ${personalInfo.city}, ${personalInfo.state} ${personalInfo.zip}`, ssn: personalInfo.ssn, dob: personalInfo.dob }, item.creditorName);
      setFurnisherBypassModal({ content, itemName: item.creditorName });
      addDisputeLetter({ id: uuidv4(), negativeItemIds: [item.id], content, createdAt: new Date().toISOString(), status: "Draft", bureau: item.creditorName, round: item.disputeRound, batchId: null, templateType: "623-Furnisher", certifiedMail: true, targetType: "furnisher" });
    } catch (err: any) {
      addAutopilotLog({ message: `[BYPASS] Failed: ${err.message}`, level: "error", type: 'system' as const });
    }
  }, [negativeItems, personalInfo, addDisputeLetter, addAutopilotLog]);

  const handleConfirmValidationItem = useCallback((itemId: string) => {
    const item = negativeItems.find((i) => i.id === itemId);
    if (!item) return;
    const note = validationNotes[itemId]?.trim() || "Confirmed by user in AutoPilot validation tab.";
    updateNegativeItem(itemId, {
      dataSource: item.dataSource || "manual",
      accuracyConfirmedByUser: true,
      accuracyConfirmedAt: new Date().toISOString(),
      accuracyConfirmationNote: note,
    });
    addAutopilotLog({ message: `[VALIDATION] ${item.creditorName} marked as user-confirmed.`, level: "success", type: 'system' as const, metadata: { itemId } });
  }, [negativeItems, validationNotes, updateNegativeItem, addAutopilotLog]);

  const handleClearValidationItem = useCallback((itemId: string) => {
    const item = negativeItems.find((i) => i.id === itemId);
    if (!item) return;
    updateNegativeItem(itemId, {
      accuracyConfirmedByUser: false,
      accuracyConfirmedAt: null,
      accuracyConfirmationNote: null,
    });
    addAutopilotLog({ message: `[VALIDATION] ${item.creditorName} returned to review queue.`, level: "warning", type: 'system' as const, metadata: { itemId } });
  }, [negativeItems, updateNegativeItem, addAutopilotLog]);

  const markAsMailed = useCallback((letterId: string, trackingNumber?: string) => {
    const letter = disputeLetters.find((l) => l.id === letterId);
    if (!letter) return;
    updateDisputeLetter(letterId, { mailed: true, mailedAt: new Date().toISOString(), trackingNumber: trackingNumber || undefined, status: "Sent" });
    logEvent({ type: "letter_sent", title: "Letter Mailed", detail: `Letter to ${letter.bureau} R${letter.round} marked as ${letter.certifiedMail ? "CERTIFIED" : "REGULAR"} mail`, letterId, bureau: letter.bureau, round: letter.round });
    addAutopilotLog({ message: `[MAIL] ✉️ ${letter.bureau} R${letter.round} — marked as ${letter.certifiedMail ? "CERTIFIED MAIL" : "regular mail"}${trackingNumber ? ` (${trackingNumber})` : ""}`, level: "success", type: 'system' as const });
  }, [disputeLetters, logEvent, addAutopilotLog, updateDisputeLetter]);

  const getStatusColor = (status: string) => {
    if (status === "Won" || status === "Deleted") return "text-[#00ff00] border-[#00ff00]/50";
    if (status.includes("Verified")) return "text-[#ff9900] border-[#ff9900]/50";
    if (status.includes("Pending")) return "text-blue-400 border-blue-400/50";
    if (status === "Round4-Legal") return "text-red-400 border-red-400/50";
    return "text-zinc-500 border-zinc-700";
  };

  const progressPct = negativeItems.length > 0 ? Math.round((wonItems.length / negativeItems.length) * 100) : 0;

  const tabs: { id: ActiveTab; label: string; icon: any; badge?: number }[] = [
    { id: "v4", label: "AutoPilot", icon: Bot },
    { id: "mail-queue", label: "Letters to Mail", icon: Mail, badge: mailQueueLetters.length || undefined },
    { id: "command", label: "Advanced", icon: Terminal },
    { id: "arsenal", label: "Special Tactics", icon: Shield, badge: (negativeItems.filter((i) => i.goodwillEligible || i.p4dEligible || i.doubleVerified).length) || undefined },
    { id: "campaigns", label: "Campaigns", icon: Layers },
    { id: "intel", label: "Intel", icon: BrainCircuit },
    { id: "pipeline", label: "Pipeline", icon: Table2, badge: pendingItems.length || undefined },
    { id: "validation", label: "Validation", icon: CheckSquare, badge: validationQueueItems.length || undefined },
    { id: "simulator", label: "Simulator", icon: TrendingUp },
    { id: "cross-bureau", label: "Cross-Bureau", icon: BarChart2 },
    { id: "responses", label: "Record Responses", icon: Inbox, badge: pendingItems.filter(i => i.disputeStatus !== 'Undisputed').length || undefined },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <BrainCircuit className="text-[#00ffff]" /> AutoPilot Dispute System
          </h2>
          <p className="text-zinc-400 mt-1 text-xs">
            {isActive ? "Active — disputes running automatically" : "Paused"} · {negativeItems.length} items · {wonItems.length} removed · {overdueItems.length} overdue
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => updateAutopilot({ enabled: !isActive })}
            className={`cyber-button flex items-center gap-2 px-4 py-2 font-bold tracking-widest ${isActive ? "border-red-500 text-red-500 hover:bg-red-500/10" : "border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10"}`}>
            {isActive ? <Pause size={16} /> : <Play size={16} />}
            {isActive ? "STANDBY" : "ENGAGE"}
          </button>
          <button onClick={() => runBatch(true)} disabled={isRunning || negativeItems.length === 0}
            className="cyber-button flex items-center gap-2 px-3 py-2 font-bold border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 disabled:opacity-40 text-sm">
            <Search size={14} /> PREVIEW
          </button>
          <button onClick={() => runBatch(false)} disabled={isRunning || negativeItems.length === 0}
            className="cyber-button flex items-center gap-2 px-4 py-2 font-bold border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/10 disabled:opacity-40">
            {isRunning ? <RefreshCw size={16} className="animate-spin" /> : <Zap size={16} />}
            {isRunning ? "RUNNING..." : "RUN BATCH"}
          </button>
        </div>
      </div>

      {/* Failed Dispute Letters — Redo Before Round Ends */}
      {failedDisputeLetters.length > 0 && (
        <div className="cyber-panel p-4 border-red-800/80 bg-gradient-to-r from-red-950/40 to-zinc-950 rounded-2xl shadow-xl">
          <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
            <div className="flex items-center gap-2 text-white font-bold text-sm">
              <AlertTriangle className="h-5 w-5 text-red-400" />
              <span>{failedDisputeLetters.length} Failed Dispute Letter{failedDisputeLetters.length === 1 ? '' : 's'} — Redo Needed Before Round Ends</span>
            </div>
            <button
              type="button"
              onClick={handleRedoAllFailedLetters}
              className="px-3.5 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow-md"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Redo All Failed Letters
            </button>
          </div>
          <div className="space-y-2">
            {failedDisputeLetters.map((failed) => (
              <div key={failed.id} className="p-3 rounded-xl bg-black/60 border border-red-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-bold text-white flex items-center gap-2">
                    <span>{failed.itemName}</span>
                    <span className="text-[10px] text-red-300 font-mono border border-red-800/60 px-2 py-0.5 rounded">{failed.bureau || 'Target Bureau'}</span>
                  </div>
                  <p className="text-zinc-400 mt-1 line-clamp-2">{failed.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRedoFailedLetter(failed)}
                  className="px-3.5 py-1.5 rounded-lg bg-red-950 hover:bg-red-900 text-red-200 border border-red-700 font-bold flex items-center gap-1.5 self-start sm:self-auto transition-colors flex-shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Fix & Redo Now
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Campaign Progress Banner */}
      {activeCampaign && (
        <div className="cyber-panel p-4 border-[#00ffff]/30 bg-[#00ffff]/5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-bold text-[#00ffff]">
              <Target size={16} />
              {activeCampaign.name} — Round {activeCampaign.currentRound} of 6
              {activeCampaign.status === "Complete" && <span className="text-[10px] text-[#00ff00] border border-[#00ff00]/30 px-2 py-0.5 rounded ml-2">COMPLETE</span>}
            </div>
            <span className="text-[10px] font-mono text-[#00ffff]">{progressPct}% RESOLVED</span>
          </div>
          <progress
            value={progressPct}
            max={100}
            aria-label="Campaign resolution progress"
            title="Campaign resolution progress"
            className="autopilot-progress autopilot-progress-sm"
          />
          <div className="flex gap-4 mt-2 text-[10px] font-mono text-zinc-400 flex-wrap">
            <span>UNDISPUTED: {undisputedItems.length}</span>
            <span>PENDING: {pendingItems.length}</span>
            <span>OVERDUE: {overdueItems.length}</span>
            <span>WON: {wonItems.length}</span>
            {solPausedItems.length > 0 && <span className="text-yellow-500">SOL-PAUSED: {solPausedItems.length}</span>}
            {doubleVerifiedItems.length > 0 && <span className="text-red-400">BYPASS-READY: {doubleVerifiedItems.length}</span>}
          </div>
        </div>
      )}

      {/* SOL Pause Guard alert */}
      {solPausedItems.length > 0 && (
        <div className="cyber-panel p-3 border-yellow-500/40 bg-yellow-500/5">
          <div className="flex items-center gap-2 text-yellow-400 font-bold text-sm">
            <AlertTriangle size={14} /> SOL DROP IMMINENT — {solPausedItems.length} ITEM(S) FROZEN (within 90 days of 7-year drop)
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            {solPausedItems.map((i) => (
              <span key={i.id} className="text-[9px] font-mono text-yellow-400 border border-yellow-500/30 px-2 py-0.5 rounded">
                {i.creditorName} — drops {i.solDropDate}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Overdue alert */}
      {overdueItems.length > 0 && (
        <div className="cyber-panel p-4 border-red-500/50 bg-red-500/5">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-2">
            <Siren size={16} /> FCRA DEADLINE EXPIRED — {overdueItems.length} ITEM(S) REQUIRE ESCALATION
          </div>
          <div className="space-y-1">
            {overdueItems.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between text-xs font-mono text-zinc-400">
                <span>{item.creditorName} — Round {item.disputeRound} — {item.disputeStatus}</span>
                <button onClick={() => setResponseTarget({ itemId: item.id, bureau: item.creditBureau[0] || "All" })}
                  className="text-[#ff9900] text-[10px] border border-[#ff9900]/30 px-2 py-0.5 rounded hover:bg-[#ff9900]/10">
                  LOG RESPONSE
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Furnisher Bypass alert */}
      {doubleVerifiedItems.length > 0 && (
        <div className="cyber-panel p-3 border-red-400/30 bg-red-400/5">
          <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-1">
            <SkipForward size={14} /> FURNISHER BYPASS AVAILABLE — {doubleVerifiedItems.length} ITEM(S) DOUBLE-VERIFIED BY BUREAU
          </div>
          <p className="text-[10px] text-zinc-500 font-mono mb-2">Skip the bureau — send §1681s-2(b) legal demand directly to furnisher.</p>
          <div className="flex flex-wrap gap-2">
            {doubleVerifiedItems.map((item) => (
              <button key={item.id} onClick={() => handleFurnisherBypass(item.id)}
                className="text-[9px] font-mono text-red-400 border border-red-400/30 px-2 py-1 rounded hover:bg-red-400/10">
                BYPASS: {item.creditorName}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 border-b border-zinc-800 overflow-x-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[11px] font-mono font-bold whitespace-nowrap transition-all ${activeTab === tab.id ? "text-[#00ffff] border-b-2 border-[#00ffff] -mb-px" : "text-zinc-500 hover:text-zinc-300"}`}>
              <Icon size={12} />
              {tab.label}
              {tab.badge ? <span className="bg-[#ff9900] text-black text-[8px] font-bold px-1.5 py-0.5 rounded-full">{tab.badge}</span> : null}
            </button>
          );
        })}
      </div>

      {!isPersonalInfoComplete && (
        <div className="rounded-lg border border-red-500/60 bg-red-500/10 p-3">
          <div className="flex items-center gap-2 text-red-300 font-semibold text-sm">
            <AlertTriangle size={14} /> AUTOPILOT BLOCKED: profile info incomplete
          </div>
          <p className="text-xs text-red-200/90 mt-1">
            Fill in first name, last name, street address, city, state, and ZIP in Profile before running AutoPilot.
          </p>
        </div>
      )}

      {/* ─── V4 AUTOPILOT ENGINE TAB ────────────────────────────────────────── */}
      {activeTab === "v4" && (
        <div className="space-y-5">
          <MissionControlPanel
            profileId={profileId}
            hasPersonalInfo={isPersonalInfoComplete}
            hasReports={negativeItems.length > 0}
            autopilotEnabled={v2Settings.enabled}
            onNavigate={onNavigate}
            onRunCycle={handleV2RunCycle}
            refreshKey={v2LastCycleResult ? Date.parse(v2LastCycleResult.completedAt || v2LastCycleResult.startedAt) : 0}
          />
          <AutoPilotDashboard
            engineState={v2EngineState}
            settings={v2Settings}
            items={negativeItems}
            holdEntries={v2HoldEntries}
            deadlines={v2Deadlines}
            passNumbers={v2PassNumbers}
            lastCycleResult={v2LastCycleResult}
            profileId={profileId}
            profileComplete={isPersonalInfoComplete}
            vaultDocs={evidenceDocs}
            onRunCycle={handleV2RunCycle}
            onEnableToggle={handleV2EnableToggle}
            onUpdateSettings={handleV2UpdateSettings}
            onLogResponse={handleV2LogResponse}
            onResubmitFailedTask={handleResubmitFailedTask}
            onViewLetters={() => setActiveTab('mail-queue')}
          />
        </div>
      )}

      {/* ─── COMMAND TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "command" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            {/* Strategy Engine */}
            <div className="cyber-panel p-6 border-[#00ffff]/30">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2"><Zap className="text-[#ff9900]" size={20} /> STRATEGY ENGINE</h3>
                <div className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
                  BATCH: {Math.round(autopilot.batchFraction * 100)}% | STAGGER: {autopilot.bureauStagger ? "ON" : "OFF"}
                  {autopilot.dualDispute && " | DUAL: ON"}
                  {autopilot.smartLetterMode && " | SMART: ON"}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                {strategies.map((s) => {
                  const isSel = autopilot.strategy === s.id;
                  const Icon = s.icon;
                  return (
                    <div key={s.id} onClick={() => updateAutopilot({ strategy: s.id })}
                      className={`p-3 rounded border cursor-pointer transition-all ${isSel ? "border-[#00ffff] bg-[#00ffff]/5" : "border-zinc-800 bg-[#0a0a0a] hover:border-zinc-700"}`}>
                      <Icon size={16} className={isSel ? s.color : "text-zinc-600"} />
                      <div className={`text-[11px] font-bold mt-2 ${isSel ? "text-white" : "text-zinc-500"}`}>{s.name}</div>
                      <div className="text-[9px] text-zinc-600 mt-1 leading-tight">{s.desc}</div>
                      {isSel && <div className="text-[9px] text-[#00ffff] font-mono mt-2">✓ ACTIVE</div>}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <span className="text-xs text-zinc-400 font-mono">BATCH:</span>
                {[0.25, 0.33].map((f) => (
                  <button key={f} onClick={() => updateAutopilot({ batchFraction: f as 0.25 | 0.33 })}
                    className={`text-xs px-3 py-1 rounded border font-mono ${autopilot.batchFraction === f ? "border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10" : "border-zinc-700 text-zinc-500"}`}>
                    {f === 0.25 ? "1/4" : "1/3"}
                  </button>
                ))}
                <span className="text-xs text-zinc-400 font-mono ml-2">STAGGER:</span>
                <button onClick={() => updateAutopilot({ bureauStagger: !autopilot.bureauStagger })}
                  className={`text-xs px-3 py-1 rounded border font-mono ${autopilot.bureauStagger ? "border-[#00ff00] text-[#00ff00] bg-[#00ff00]/10" : "border-zinc-700 text-zinc-500"}`}>
                  {autopilot.bureauStagger ? "ON" : "OFF"}
                </button>
              </div>
            </div>

            {/* Dispute Queue */}
            <div className="cyber-panel p-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2 mb-4">
                <FlameKindling className="text-[#ff00ff]" size={20} /> DISPUTE QUEUE
                <span className="text-[10px] font-mono text-zinc-500 ml-auto">{negativeItems.length} TOTAL ITEMS</span>
              </h3>
              <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
                {negativeItems.length === 0 && <div className="text-zinc-600 text-sm text-center py-8">No negative items loaded. Upload a credit report first.</div>}
                {[...negativeItems].sort((a, b) => b.priorityScore - a.priorityScore).map((item) => {
                  const daysLeft = getDaysRemaining(item.disputeDeadline ?? null);
                  const isOverdue = daysLeft !== null && daysLeft < 0;
                  const isSolPaused = checkSolPause(item);
                  const isDoubleV = checkDoubleVerified(item);
                  return (
                    <div key={item.id} className={`flex items-center justify-between p-3 bg-[#0a0a0a] border rounded-lg transition-all ${isSolPaused ? "border-yellow-500/30" : getStatusColor(item.disputeStatus)}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-bold text-white truncate">{item.creditorName}</span>
                          <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${getStatusColor(item.disputeStatus)}`}>{item.disputeStatus}</span>
                          {item.goodwillEligible && <span className="text-[9px] text-emerald-400 border border-emerald-400/30 px-1 rounded">GW</span>}
                          {item.p4dEligible && <span className="text-[9px] text-purple-400 border border-purple-400/30 px-1 rounded">P4D</span>}
                          {isSolPaused && <span className="text-[9px] text-yellow-400 border border-yellow-500/30 px-1 rounded">SOL⚠</span>}
                          {isDoubleV && <span className="text-[9px] text-red-400 border border-red-400/30 px-1 rounded">2x✗</span>}
                          {item.forceStrategy && item.forceStrategy !== "default" && <span className="text-[9px] text-[#00ffff] border border-[#00ffff]/30 px-1 rounded">{item.forceStrategy}</span>}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                          {item.typeOfNegative} | R{item.disputeRound} | P:{item.priorityScore}
                          {daysLeft !== null && <span className={isOverdue ? " text-red-400" : " text-[#ff9900]"}> | {isOverdue ? `OVERDUE ${Math.abs(daysLeft)}d` : `${daysLeft}d left`}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 ml-2">
                        {(item.disputeStatus ?? "").includes("Pending") && (
                          <button onClick={() => setResponseTarget({ itemId: item.id, bureau: item.creditBureau[0] || "All" })}
                            className="text-[10px] border border-[#ff9900]/30 text-[#ff9900] px-2 py-1 rounded hover:bg-[#ff9900]/10">LOG</button>
                        )}
                        {isDoubleV && (
                          <button onClick={() => handleFurnisherBypass(item.id)}
                            className="text-[10px] border border-red-400/30 text-red-400 px-2 py-1 rounded hover:bg-red-400/10">BYPASS</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Escalation Ladder */}
            <div className="cyber-panel p-6 border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-400 mb-1 font-mono">6-ROUND ESCALATION ROADMAP</h3>
              <p className="text-[10px] text-zinc-600 mb-3">Each response advances the account deliberately. Rounds 5–6 are regulatory and pre-litigation stages and remain visible even when they require manual review.</p>
              <div className="space-y-2">
                {([1, 2, 3, 4, 5, 6] as DisputeRound[]).map((r) => {
                  const e = ESCALATION_LADDER[r];
                  const count = negativeItems.filter((i) => i.disputeRound === r && !['Deleted', 'Won'].includes(i.disputeStatus ?? '')).length;
                  return (
                    <div key={r} className={`flex items-center gap-3 p-2 rounded text-xs ${count > 0 ? "bg-[#ff9900]/5 border border-[#ff9900]/20" : "bg-[#0a0a0a]"}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] ${count > 0 ? "bg-[#ff9900] text-black" : "bg-zinc-800 text-zinc-500"}`}>R{r}</div>
                      <div className="flex-1">
                        <div className="font-bold text-zinc-300">{e.description}</div>
                        <div className="text-zinc-600 font-mono text-[10px]">{e.lawRef}</div>
                      </div>
                      {r === 5 && count > 0 && (
                        <button onClick={() => handleGenerateCFPB("Equifax")}
                          className="text-[9px] border border-red-400/30 text-red-400 px-2 py-1 rounded hover:bg-red-400/10 font-mono">CFPB</button>
                      )}
                      {count > 0 && <span className="text-[#ff9900] font-mono text-[10px]">{count} pending</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-4">
            {/* Response Logger */}
            {responseTarget && (
              <div className="cyber-panel p-4 border-[#ff9900]/50 bg-[#ff9900]/5">
                <h4 className="text-sm font-bold text-[#ff9900] mb-3">LOG BUREAU RESPONSE</h4>
                <div className="text-xs text-zinc-400 mb-2">
                  {negativeItems.find((i) => i.id === responseTarget.itemId)?.creditorName} — {responseTarget.bureau}
                </div>
                <div className="space-y-1 mb-3">
                  {RESPONSE_OPTIONS.map((opt) => (
                    <button key={opt} onClick={() => setSelectedResponse(opt)}
                      className={`w-full text-left text-xs p-2 rounded border font-mono ${selectedResponse === opt ? "border-[#ff9900] text-[#ff9900] bg-[#ff9900]/10" : "border-zinc-800 text-zinc-500 hover:border-zinc-600"}`}>
                      {opt === "Verified" && "⚡ VERIFIED — Escalate + Boost Priority"}
                      {opt === "Updated" && "✅ UPDATED — Favorably corrected"}
                      {opt === "Deleted" && "🏆 DELETED — Won!"}
                      {opt === "NoResponse" && "⏰ NO RESPONSE — Auto-Escalate"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={handleLogResponse} className="flex-1 cyber-button text-xs border-[#ff9900] text-[#ff9900] hover:bg-[#ff9900]/10 py-2">SUBMIT</button>
                  <button onClick={() => setResponseTarget(null)} className="cyber-button text-xs border-zinc-700 text-zinc-400 px-3 py-2">✕</button>
                </div>
              </div>
            )}

            {/* Log Stream */}
            <div className="cyber-panel p-4">
              <div className="flex items-center gap-2 text-[#00ffff] text-xs font-mono mb-2">
                <Terminal size={12} /> SYSTEM LOG STREAM
              </div>
              <div className="bg-[#050505] border border-zinc-800 rounded-lg p-3 h-72 overflow-y-auto custom-scrollbar space-y-1 font-mono text-[10px]">
                {autopilotLogs.length === 0 && <div className="text-zinc-700 italic">Waiting for system engagement...</div>}
                {autopilotLogs.slice(0, 100).map((log) => (
                  <div key={log.id} className={log.level === "success" ? "text-[#00ff00]" : log.level === "error" ? "text-red-400" : log.level === "warning" ? "text-[#ff9900]" : "text-zinc-400"}>
                    [{new Date(log.timestamp).toLocaleTimeString()}] {log.message}
                  </div>
                ))}
              </div>
            </div>

            {/* Campaign Stats */}
            {activeCampaign && (
              <div className="cyber-panel p-4">
                <h4 className="text-xs font-mono text-zinc-400 mb-3">CAMPAIGN STATS</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-zinc-500">Started</span><span className="text-white">{new Date(activeCampaign.startDate).toLocaleDateString()}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Round</span><span className="text-[#ff9900]">{activeCampaign.currentRound} / 4</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Batches Run</span><span className="text-white">{activeCampaign.batches.length}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Letters</span><span className="text-white">{disputeLetters.filter((l) => l.batchId).length}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Dual Disputes</span><span className="text-[#ff00ff]">{disputeLetters.filter((l) => l.targetType === "furnisher").length}</span></div>
                  <div className="flex justify-between"><span className="text-zinc-500">Items Won</span><span className="text-[#00ff00] font-bold">{wonItems.length}</span></div>
                  {activeCampaign.winRate !== undefined && <div className="flex justify-between"><span className="text-zinc-500">Win Rate</span><span className="text-[#00ff00] font-bold">{activeCampaign.winRate}%</span></div>}
                </div>
                {activeCampaign.successReport && (
                  <button onClick={() => setSuccessReportModal({ content: activeCampaign.successReport!, campaignName: activeCampaign.name })}
                    className="mt-3 w-full text-[10px] border border-[#00ff00]/30 text-[#00ff00] py-1.5 rounded hover:bg-[#00ff00]/10 font-mono">
                    VIEW SUCCESS REPORT
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── ARSENAL TAB ──────────────────────────────────────────────────────── */}
      {activeTab === "arsenal" && (
        <div className="space-y-6">
          {/* Per-item overrides */}
          <div className="cyber-panel p-6">
            <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2"><Settings2 size={14} className="text-[#ff9900]" /> PER-ITEM STRATEGY OVERRIDES</h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-4">Override the campaign strategy per item. Items set to "Goodwill" or "Pay-for-Delete" are held from standard batches.</p>
            <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
              {negativeItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between p-3 bg-[#0a0a0a] border border-zinc-800 rounded">
                  <div>
                    <div className="text-xs font-bold text-white">{item.creditorName}</div>
                    <div className="text-[10px] text-zinc-500 font-mono">{item.typeOfNegative} | ${item.balance ?? 0} | {item.disputeStatus}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.goodwillEligible && <span className="text-[9px] text-emerald-400 border border-emerald-400/30 px-1 rounded font-mono">GW</span>}
                    {item.p4dEligible && <span className="text-[9px] text-purple-400 border border-purple-400/30 px-1 rounded font-mono">P4D</span>}
                    <select value={item.forceStrategy || "default"} onChange={(e) => updateNegativeItem(item.id, { forceStrategy: e.target.value as any })}
                      title="Override dispute strategy for this item"
                      aria-label={`Strategy override for ${item.creditorName}`}
                      className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1 rounded">
                      {FORCE_STRATEGY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Goodwill Candidates */}
          <div className="cyber-panel p-6 border-emerald-500/20">
            <h3 className="text-sm font-bold text-emerald-400 mb-1 flex items-center gap-2"><Star size={14} /> GOODWILL REMOVAL CANDIDATES</h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-3">Paid-off late payment accounts. Goodwill letters often succeed without a formal FCRA dispute.</p>
            {negativeItems.filter((i) => i.goodwillEligible).length === 0
              ? <p className="text-zinc-600 text-xs text-center py-4">No goodwill candidates detected yet.</p>
              : negativeItems.filter((i) => i.goodwillEligible).map((item) => (
                <div key={item.id} className="flex justify-between items-center p-3 bg-emerald-500/5 border border-emerald-500/20 rounded mb-2">
                  <div><div className="text-xs font-bold text-white">{item.creditorName}</div><div className="text-[10px] text-zinc-500 font-mono">{item.typeOfNegative} — paid/closed</div></div>
                  <button onClick={() => updateNegativeItem(item.id, { forceStrategy: "goodwill" })} className="text-[10px] border border-emerald-500/30 text-emerald-400 px-2 py-1 rounded hover:bg-emerald-500/10 font-mono">ASSIGN GW</button>
                </div>
              ))
            }
          </div>

          {/* P4D Candidates */}
          <div className="cyber-panel p-6 border-purple-500/20">
            <h3 className="text-sm font-bold text-purple-400 mb-1 flex items-center gap-2"><Package size={14} /> PAY-FOR-DELETE CANDIDATES</h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-3">Open collections/charge-offs under $1,000. Get deletion agreement in writing before paying.</p>
            {negativeItems.filter((i) => i.p4dEligible).length === 0
              ? <p className="text-zinc-600 text-xs text-center py-4">No P4D candidates. Collections under $1,000 will appear here.</p>
              : negativeItems.filter((i) => i.p4dEligible).map((item) => (
                <div key={item.id} className="flex justify-between items-center p-3 bg-purple-500/5 border border-purple-500/20 rounded mb-2">
                  <div><div className="text-xs font-bold text-white">{item.creditorName}</div><div className="text-[10px] text-zinc-500 font-mono">${item.balance} — {item.typeOfNegative}</div></div>
                  <button onClick={() => updateNegativeItem(item.id, { forceStrategy: "pay-for-delete" })} className="text-[10px] border border-purple-500/30 text-purple-400 px-2 py-1 rounded hover:bg-purple-500/10 font-mono">ASSIGN P4D</button>
                </div>
              ))
            }
          </div>

          {/* CFPB Complaint Generator */}
          <div className="cyber-panel p-6 border-red-500/20">
            <h3 className="text-sm font-bold text-red-400 mb-1 flex items-center gap-2"><Megaphone size={14} /> CFPB COMPLAINT GENERATOR</h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-3">Generate a pre-filled CFPB complaint for Round 3-4 items. Copy directly to consumerfinance.gov/complaint.</p>
            <div className="flex gap-2 flex-wrap">
              {[...BUREAUS].map((b) => (
                <button key={b} onClick={() => handleGenerateCFPB(b)} className="cyber-button text-xs border-red-400/50 text-red-400 hover:bg-red-400/10 px-3 py-2">
                  {b.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── MAIL QUEUE TAB ───────────────────────────────────────────────────── */}
      {activeTab === "mail-queue" && (
        <div className="space-y-6">
          {/* FCRA Deadline Tracker */}
          {pendingItems.length > 0 && (
            <div className="cyber-panel p-4 border-[#ff9900]/30 bg-[#ff9900]/5">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Clock size={14} className="text-[#ff9900]" /> FCRA DEADLINE TRACKER</h3>
              <div className="space-y-2">
                {pendingItems.slice(0, 5).map((item) => {
                  const daysRemaining = getDaysRemaining(item.disputeDeadline ?? null);
                  const isOverdue = daysRemaining !== null && daysRemaining < 0;
                  const isCritical = daysRemaining !== null && daysRemaining <= 5 && daysRemaining >= 0;
                  return (
                    <div key={item.id} className={`flex items-center justify-between p-2 rounded border ${
                      isOverdue ? "border-red-500/30 bg-red-500/10" :
                      isCritical ? "border-[#ff9900]/30 bg-[#ff9900]/10" :
                      "border-zinc-800 bg-zinc-900"
                    }`}>
                      <div className="flex-1">
                        <div className="text-xs font-bold text-white">{item.creditorName}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{item.creditBureau?.[0] || "All Bureaus"} — Round {item.disputeRound}</div>
                      </div>
                      <div className={`text-xs font-mono font-bold ${
                        isOverdue ? "text-red-400" :
                        isCritical ? "text-[#ff9900]" :
                        "text-[#00ffff]"
                      }`}>
                        {isOverdue ? `${Math.abs(daysRemaining!)} DAYS OVERDUE` : `${daysRemaining} DAYS LEFT`}
                      </div>
                    </div>
                  );
                })}
              </div>
              {overdueItems.length > 0 && (
                <div className="mt-3 text-[10px] text-red-400 font-mono bg-red-500/10 border border-red-500/30 rounded p-2">
                  ⚠ {overdueItems.length} ITEM(S) OVERDUE — Log bureau responses or escalate to next round immediately.
                </div>
              )}
            </div>
          )}

          {/* Response Logging Panel */}
          {pendingItems.length > 0 && (
            <div className="cyber-panel p-5 border-[#00ffff]/20">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><CheckSquare size={14} className="text-[#00ffff]" /> LOG BUREAU RESPONSES</h3>
              <p className="text-[10px] text-zinc-500 font-mono mb-4">Mark each disputed item with bureau response to track progress and auto-escalate.</p>
              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar">
                {pendingItems.map((item) => (
                  <div key={item.id} className="bg-[#0a0a0a] border border-zinc-800 rounded p-3">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <div className="text-xs font-bold text-white">{item.creditorName}</div>
                        <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{item.typeOfNegative} — {item.creditBureau?.join(", ") || "All Bureaus"} — Round {item.disputeRound}</div>
                      </div>
                      <span className={`text-[9px] px-2 py-0.5 rounded border font-mono ${getStatusColor(item.disputeStatus)}`}>
                        {item.disputeStatus}
                      </span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {RESPONSE_OPTIONS.map((resp) => (
                        <button key={resp} onClick={() => {
                          const { newStatus, newRound, logMessage } = resolveResponseOutcome(item, resp);
                          updateDisputeItemStatus(item.id, newStatus as import('../types').DisputeItemStatus, newRound as import('../types').DisputeRound);
                          if (resp === "Verified") {
                            updateNegativeItem(item.id, {
                              priorityScore: recalcPriorityAfterVerification(item),
                              verificationCount: (item.verificationCount || 0) + 1,
                              doubleVerified: (item.verificationCount || 0) >= 1,
                            });
                          }
                          addAutopilotLog({ message: logMessage, level: newStatus === "Won" ? "success" : "warning", type: 'system' as const, metadata: { itemId: item.id } });
                          logEvent({ type: "response_logged", title: "Bureau Response Logged", detail: logMessage, itemId: item.id, outcome: resp });
                        }}
                          className={`text-[10px] px-3 py-1.5 rounded border font-mono hover:bg-white/5 transition-all ${
                            resp === "Deleted" ? "border-[#00ff00]/30 text-[#00ff00]" :
                            resp === "Verified" ? "border-[#ff9900]/30 text-[#ff9900]" :
                            resp === "Updated" ? "border-blue-400/30 text-blue-400" :
                            "border-zinc-700 text-zinc-500"
                          }`}>
                          {resp === "NoResponse" ? "No Response" : resp}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {/* Round Auto-Advance */}
              {activeCampaign && pendingItems.every(i => (i.disputeStatus ?? "").includes("Verified") || i.disputeStatus === "Won") && pendingItems.length > 0 && (
                <div className="mt-4 p-3 bg-[#00ffff]/10 border border-[#00ffff]/30 rounded">
                  <div className="text-xs font-bold text-[#00ffff] mb-2">⚡ ALL RESPONSES LOGGED — READY TO ADVANCE</div>
                  <div className="text-[10px] text-zinc-400 mb-3">All items in this batch have been responded to. Advance to Round {Math.min(activeCampaign.currentRound + 1, 6)}?</div>
                  <button onClick={() => {
                    const nextRound = Math.min(activeCampaign.currentRound + 1, 6) as DisputeRound;
                    updateCampaign(activeCampaign.id, { currentRound: nextRound });
                    addAutopilotLog({ message: `[AUTO-ADVANCE] Campaign advanced to Round ${nextRound}`, level: "success", type: 'system' as const });
                  }}
                    className="cyber-button text-xs border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-4 py-2">
                    → ADVANCE TO ROUND {Math.min(activeCampaign.currentRound + 1, 6)}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Campaign Scheduler */}
          <div className="cyber-panel p-4 border-[#00ffff]/20">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2"><Calendar size={14} className="text-[#00ffff]" /> BATCH SEND DATE SCHEDULER</h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-3">Schedule letters for a specific mail date instead of printing immediately.</p>
            <div className="flex gap-3 items-center flex-wrap">
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]}
                title="Schedule batch send date"
                aria-label="Scheduled send date"
                className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded" />
              {scheduledDate && <button onClick={() => setScheduledDate("")} className="text-xs text-zinc-500 border border-zinc-700 px-3 py-2 rounded hover:text-zinc-300">Clear (Immediate)</button>}
              <span className="text-[10px] text-zinc-500 font-mono">{scheduledDate ? `Scheduled for ${new Date(scheduledDate + "T12:00:00").toLocaleDateString()}` : "No schedule — send immediately"}</span>
            </div>
          </div>

          {/* Mail Mode Toggle */}
          <div className="cyber-panel p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Stamp size={14} className="text-[#ff9900]" /> MAIL DELIVERY MODE</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-0.5">Default: regular first-class stamp. Certified mail adds USPS tracking + legal proof of delivery (~$4-5 extra).</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs font-mono ${!autopilot.certifiedMailDefault ? "text-[#00ff00]" : "text-zinc-500"}`}>STAMP</span>
                <button onClick={() => updateAutopilot({ certifiedMailDefault: !autopilot.certifiedMailDefault })}
                  title={autopilot.certifiedMailDefault ? "Switch to regular stamp mail" : "Switch to certified mail"}
                  aria-label="Toggle certified mail mode"
                  className={`relative w-12 h-6 rounded-full transition-all ${autopilot.certifiedMailDefault ? "bg-[#ff9900]" : "bg-zinc-700"}`}>
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autopilot.certifiedMailDefault ? "left-7" : "left-1"}`} />
                </button>
                <span className={`text-xs font-mono ${autopilot.certifiedMailDefault ? "text-[#ff9900]" : "text-zinc-500"}`}>CERTIFIED</span>
              </div>
            </div>
            {autopilot.certifiedMailDefault && (
              <div className="text-[10px] text-[#ff9900] font-mono bg-[#ff9900]/5 border border-[#ff9900]/20 rounded p-2">
                ⚠ CERTIFIED MAIL ACTIVE — All new letters will include USPS tracking number entry field below.
              </div>
            )}
          </div>

          {/* Mail Queue */}
          <div className="cyber-panel p-6">
            <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <Inbox size={14} className="text-[#ff9900]" /> READY TO MAIL
              <span className="text-[10px] font-mono text-zinc-500 ml-auto">{mailQueueLetters.length} PENDING</span>
            </h3>
            {mailQueueLetters.length === 0
              ? <p className="text-zinc-600 text-sm text-center py-8">No letters in queue. Run a batch to generate dispute letters.</p>
              : (
                <div className="space-y-3">
                  {mailQueueLetters.map((letter) => {
                    const item = negativeItems.find((i) => letter.negativeItemIds.includes(i.id));
                    return (
                      <MailQueueItem
                        key={letter.id}
                        letter={letter}
                        itemName={item?.creditorName || ""}
                        itemType={item?.typeOfNegative || ""}
                        onMarkMailed={markAsMailed}
                      />
                    );
                  })}
                </div>
              )
            }
          </div>

          {sentLetters.length > 0 && (
            <div className="cyber-panel p-4">
              <h3 className="text-xs font-mono text-zinc-400 mb-3 flex items-center gap-2"><CheckSquare size={12} /> SENT ({sentLetters.length})</h3>
              <div className="space-y-1">
                {sentLetters.slice(0, 20).map((l) => (
                  <div key={l.id} className="flex justify-between text-[10px] text-zinc-500 font-mono py-1 border-b border-zinc-800/50">
                    <span>{l.bureau} — R{l.round} — {l.templateType}</span>
                    <span className="text-[#00ff00]">✓ SENT</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── CAMPAIGNS TAB ────────────────────────────────────────────────────── */}
      {activeTab === "campaigns" && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-bold text-white flex items-center gap-2"><Layers size={14} className="text-[#00ffff]" /> ALL CAMPAIGNS</h3>
            <button onClick={startNewCampaign} className="cyber-button text-xs border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 px-3 py-2">+ NEW CAMPAIGN</button>
          </div>

          {/* Active Campaign Dashboard Card */}
          {activeCampaign && (
            <div className="cyber-panel p-6 border-[#00ffff]/30 bg-[#00ffff]/5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-lg font-bold text-white flex items-center gap-2">
                    <Target size={18} className="text-[#00ffff]" />
                    {activeCampaign.name}
                    <span className="text-xs font-mono text-[#00ffff] border border-[#00ffff]/30 px-2 py-0.5 rounded">ACTIVE</span>
                  </h4>
                  <div className="text-[10px] text-zinc-500 font-mono mt-1">Started {new Date(activeCampaign.startDate).toLocaleDateString()}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-[#00ffff]">{progressPct}%</div>
                  <div className="text-[10px] text-zinc-500 font-mono">RESOLVED</div>
                </div>
              </div>

              {/* Campaign Stats Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-[#0a0a0a] border border-zinc-800 rounded p-3">
                  <div className="text-2xl font-bold text-white">{activeCampaign.totalItems}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">TOTAL ITEMS</div>
                </div>
                <div className="bg-[#0a0a0a] border border-[#00ff00]/30 rounded p-3">
                  <div className="text-2xl font-bold text-[#00ff00]">{wonItems.length}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">WON/DELETED</div>
                </div>
                <div className="bg-[#0a0a0a] border border-blue-500/30 rounded p-3">
                  <div className="text-2xl font-bold text-blue-400">{pendingItems.length}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">IN PROGRESS</div>
                </div>
                <div className="bg-[#0a0a0a] border border-[#ff9900]/30 rounded p-3">
                  <div className="text-2xl font-bold text-[#ff9900]">{activeCampaign.batches.length}</div>
                  <div className="text-[10px] text-zinc-500 font-mono">BATCHES SENT</div>
                </div>
              </div>

              {/* Current Round Info */}
              <div className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-800 rounded">
                <div>
                  <div className="text-xs font-bold text-white">Current Round: {activeCampaign.currentRound} of 6</div>
                  <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{ESCALATION_LADDER[activeCampaign.currentRound]?.description}</div>
                </div>
                <div className="text-[10px] font-mono text-[#00ffff]">{ESCALATION_LADDER[activeCampaign.currentRound]?.lawRef}</div>
              </div>

              {/* Progress Bar */}
              <div>
                <div className="flex justify-between text-[10px] font-mono text-zinc-500 mb-1">
                  <span>DISPUTE PROGRESS</span>
                  <span>{wonItems.length} / {activeCampaign.totalItems} ITEMS</span>
                </div>
                <progress
                  value={progressPct}
                  max={100}
                  aria-label="Campaign dispute progress"
                  title="Campaign dispute progress"
                  className="autopilot-progress autopilot-progress-lg"
                />
              </div>

              {/* Next Deadline */}
              {activeCampaign.batches.length > 0 && (
                <div className="p-3 bg-[#ff9900]/10 border border-[#ff9900]/30 rounded">
                  <div className="text-xs font-bold text-[#ff9900]">⏰ Next Deadline: {Math.min(...activeCampaign.batches.filter(b => b.status === "sent" || b.status === "responded").map(b => getDaysRemaining(b.responseDue ?? null) || 999))} days</div>
                  <div className="text-[10px] text-zinc-400 mt-1">Pending responses on {activeCampaign.batches.filter(b => b.status === "sent" || b.status === "responded").length} active batch(es)</div>
                </div>
              )}
            </div>
          )}

          {campaigns.length === 0
            ? <p className="text-zinc-600 text-sm text-center py-12">No campaigns yet. Engage autopilot to start your first campaign.</p>
            : campaigns.map((c) => {
              const rate = c.totalItems > 0 ? Math.round((c.resolvedItems / c.totalItems) * 100) : 0;
              const isCurrentActive = c.id === autopilot.activeCampaignId;
              return (
                <div key={c.id} className={`cyber-panel p-5 ${isCurrentActive ? "border-[#00ffff]/30" : "border-zinc-800"}`}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-bold text-white text-sm">{c.name}</div>
                      <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                        Started: {new Date(c.startDate).toLocaleDateString()} | Round: {c.currentRound}/6 | Batches: {c.batches.length}
                        {c.completedAt && ` | Completed: ${new Date(c.completedAt).toLocaleDateString()}`}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${c.status === "Active" ? "text-[#00ff00] border-[#00ff00]/30" : c.status === "Complete" ? "text-blue-400 border-blue-400/30" : "text-zinc-500 border-zinc-700"}`}>{c.status}</span>
                      {isCurrentActive && <span className="text-[9px] text-[#00ffff] border border-[#00ffff]/30 px-2 py-0.5 rounded font-mono">ACTIVE</span>}
                    </div>
                  </div>
                  <progress
                    value={rate}
                    max={100}
                    aria-label={`${c.name} progress`}
                    title={`${c.name} progress`}
                    className="autopilot-progress autopilot-progress-xs mb-2"
                  />
                  <div className="flex gap-4 text-[10px] font-mono text-zinc-500 flex-wrap">
                    <span>TOTAL: {c.totalItems}</span>
                    <span className="text-[#00ff00]">WON: {c.resolvedItems}</span>
                    <span>RATE: {rate}%</span>
                    {c.winRate !== undefined && <span className="text-[#00ff00]">FINAL WIN: {c.winRate}%</span>}
                  </div>
                  <div className="flex gap-2 mt-3">
                    {!isCurrentActive && c.status !== "Complete" && (
                      <button onClick={() => updateAutopilot({ activeCampaignId: c.id })}
                        className="text-[10px] border border-zinc-700 text-zinc-400 px-3 py-1 rounded hover:border-zinc-500 font-mono">SET ACTIVE</button>
                    )}
                    {c.successReport && (
                      <button onClick={() => setSuccessReportModal({ content: c.successReport!, campaignName: c.name })}
                        className="text-[10px] border border-[#00ff00]/30 text-[#00ff00] px-3 py-1 rounded hover:bg-[#00ff00]/10 font-mono">SUCCESS REPORT</button>
                    )}
                  </div>
                </div>
              );
            })
          }
        </div>
      )}

      {/* ─── INTEL TAB ────────────────────────────────────────────────────────── */}
      {activeTab === "intel" && (
        <div className="space-y-5">
          <div className="cyber-panel p-5 border-[#00ffff]/20">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><BarChart2 size={14} className="text-[#00ffff]" /> WORLD-CLASS AUTOMATION INTEL</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono mb-3">
              <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">TOTAL</div><div className="text-white font-bold">{intel.total}</div></div>
              <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">RESOLVED</div><div className="text-[#00ff00] font-bold">{intel.resolved}</div></div>
              <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">WIN RATE</div><div className="text-[#00ff00] font-bold">{intel.winRate}%</div></div>
              <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">EST SCORE GAIN</div><div className="text-[#00ffff] font-bold">+{intel.estimatedNetScoreGain}</div></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
              <div className="border border-zinc-800 rounded p-2 text-zinc-400">Follow-Up Candidates: <span className="text-[#ff9900]">{followUpCandidates.length}</span></div>
              <div className="border border-zinc-800 rounded p-2 text-zinc-400">Fatigue Alerts: <span className="text-red-400">{fatigueItems.length}</span></div>
              <div className="border border-zinc-800 rounded p-2 text-zinc-400">CFPB Auto-Escalate Queue: <span className="text-red-400">{cfpbAutoCandidates.length}</span></div>
              <div className="border border-zinc-800 rounded p-2 text-zinc-400">Payment Plan Candidates: <span className="text-purple-400">{paymentPlanCandidates.length}</span></div>
              <div className="border border-zinc-800 rounded p-2 text-zinc-400">Dispute Calendar Events: <span className="text-[#00ffff]">{disputeCalendar.length}</span></div>
              <div className="border border-zinc-800 rounded p-2 text-zinc-400">SOL Calendar Events: <span className="text-yellow-400">{solCalendar.length}</span></div>
            </div>
            {milestones.length > 0 && (
              <div className="mt-3 text-[10px] font-mono text-[#00ff00] bg-[#00ff00]/5 border border-[#00ff00]/20 rounded p-2">
                {milestones.map(m => m.message).join(" | ")}
              </div>
            )}
          </div>

          {/* KPI Cockpit — pass / bureau / creditor deletion rates */}
          <KpiCockpitPanel />

          <div className="cyber-panel p-5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Settings2 size={14} className="text-[#ff9900]" /> FINAL AUTOMATION SWITCHES (A21-A30)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono">
              <ToggleSwitch label="Smart Follow-Up" enabled={autopilot.smartFollowUp} onClick={() => updateAutopilot({ smartFollowUp: !autopilot.smartFollowUp })} color="bg-[#ff9900]" />
              <ToggleSwitch label="Dispute Calendar" enabled={autopilot.showDisputeCalendar} onClick={() => updateAutopilot({ showDisputeCalendar: !autopilot.showDisputeCalendar })} color="bg-[#00ffff]" />
              <ToggleSwitch label="Goodwill Post-Win" enabled={autopilot.goodwillPostWin} onClick={() => updateAutopilot({ goodwillPostWin: !autopilot.goodwillPostWin })} color="bg-emerald-500" />
              <ToggleSwitch label="Fatigue Detection" enabled={autopilot.fatigueDetect} onClick={() => updateAutopilot({ fatigueDetect: !autopilot.fatigueDetect })} color="bg-red-500" />
              <ToggleSwitch label="SOL Calendar" enabled={autopilot.showSOLCalendar} onClick={() => updateAutopilot({ showSOLCalendar: !autopilot.showSOLCalendar })} color="bg-yellow-500" />
              <ToggleSwitch label="CFPB Auto-Escalate" enabled={autopilot.cfpbAutoEscalate} onClick={() => updateAutopilot({ cfpbAutoEscalate: !autopilot.cfpbAutoEscalate })} color="bg-red-600" />
            </div>
          </div>

          {/* Dual Dispute */}
          <div className="cyber-panel p-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Send size={14} className="text-[#ff00ff]" /> DUAL DISPUTE MODE</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-1">Simultaneously dispute with the credit bureau (§611) AND the furnisher/creditor (§623) starting at Round 1. Generates 2 letters per batch — doubles legal pressure from day one. Furnisher cannot claim they weren't notified.</p>
              </div>
              <button onClick={() => updateAutopilot({ dualDispute: !autopilot.dualDispute })}
                title="Toggle dual dispute mode (bureau + furnisher simultaneously)"
                aria-label="Toggle dual dispute mode"
                className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${autopilot.dualDispute ? "bg-[#ff00ff]" : "bg-zinc-700"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autopilot.dualDispute ? "left-7" : "left-1"}`} />
              </button>
            </div>
            {autopilot.dualDispute && <div className="mt-2 text-[10px] text-[#ff00ff] font-mono bg-[#ff00ff]/5 border border-[#ff00ff]/20 rounded p-2">✓ DUAL ACTIVE — §611 bureau + §623 furnisher letters generated simultaneously per batch</div>}
          </div>

          {/* Smart Letter Intelligence */}
          <div className="cyber-panel p-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><BrainCircuit size={14} className="text-[#00ffff]" /> SMART LETTER INTELLIGENCE</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-1">AI analyzes each item's specific legal vulnerabilities — reporting age, balance inconsistencies, SOL proximity, Metro 2 violations — and builds unique targeted arguments per item. Uses Groq llama models. Dispute Strength Scoring also enabled.</p>
              </div>
              <button onClick={() => updateAutopilot({ smartLetterMode: !autopilot.smartLetterMode })}
                title="Toggle AI smart letter mode"
                aria-label="Toggle smart letter intelligence"
                className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${autopilot.smartLetterMode ? "bg-[#00ffff]" : "bg-zinc-700"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autopilot.smartLetterMode ? "left-7" : "left-1"}`} />
              </button>
            </div>
            {autopilot.smartLetterMode && <div className="mt-2 text-[10px] text-[#00ffff] font-mono bg-[#00ffff]/5 border border-[#00ffff]/20 rounded p-2">✓ SMART MODE — Each letter uses item-specific vulnerability targeting. Dispute Strength score logged after each batch.</div>}
          </div>

          {/* Auto-Advance Rounds */}
          <div className="cyber-panel p-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><SkipForward size={14} className="text-[#ff9900]" /> AUTO-ADVANCE ROUNDS</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-1">When all pending items in the current round have responses (or deadlines expire), automatically advance the campaign to the next round without manual intervention.</p>
              </div>
              <button onClick={() => updateAutopilot({ autoAdvanceRounds: !autopilot.autoAdvanceRounds })}
                title="Toggle auto-advance rounds"
                aria-label="Toggle automatic round advancement"
                className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${autopilot.autoAdvanceRounds ? "bg-[#ff9900]" : "bg-zinc-700"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autopilot.autoAdvanceRounds ? "left-7" : "left-1"}`} />
              </button>
            </div>
          </div>

          {/* SOL Pause Guard */}
          <div className="cyber-panel p-5">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <h3 className="text-sm font-bold text-white flex items-center gap-2"><Shield size={14} className="text-yellow-400" /> SOL PAUSE GUARD</h3>
                <p className="text-[10px] text-zinc-500 font-mono mt-1">Automatically holds items within 90 days of their 7-year mandatory deletion date from new disputes. Prevents inadvertent reporting clock resets.</p>
              </div>
              <button onClick={() => updateAutopilot({ solPauseGuard: !autopilot.solPauseGuard })}
                title="Toggle SOL pause guard"
                aria-label="Toggle statute of limitations pause guard"
                className={`relative w-12 h-6 rounded-full transition-all flex-shrink-0 ${autopilot.solPauseGuard ? "bg-yellow-500" : "bg-zinc-700"}`}>
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${autopilot.solPauseGuard ? "left-7" : "left-1"}`} />
              </button>
            </div>
          </div>

          {/* Personalization Variables */}
          <div className="cyber-panel p-5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><FileText size={14} className="text-[#ff9900]" /> SMART LETTER PERSONALIZATION</h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-4">Injected into every Smart Letter — replaces generic phrases with consumer-specific context that bureaus cannot auto-reject as a template.</p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-zinc-400 mb-1 block">PREFERRED NAME (overrides legal name in letters)</label>
                <input type="text" value={autopilot.personalizationVars?.preferredName || ""} onChange={(e) => updateAutopilot({ personalizationVars: { ...autopilot.personalizationVars, preferredName: e.target.value } })}
                  placeholder={`${personalInfo.firstName} ${personalInfo.lastName}`}
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-zinc-400 mb-1 block">HARDSHIP REASON (injected into goodwill / empathy arguments)</label>
                <input type="text" value={autopilot.personalizationVars?.hardshipReason || ""} onChange={(e) => updateAutopilot({ personalizationVars: { ...autopilot.personalizationVars, hardshipReason: e.target.value } })}
                  placeholder="e.g., medical emergency, job loss, divorce, COVID-19 impact..."
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded" />
              </div>
              <div>
                <label className="text-[10px] font-mono text-zinc-400 mb-1 block">SPECIAL INSTRUCTIONS (appended to all Smart Letters)</label>
                <textarea value={autopilot.personalizationVars?.specialInstructions || ""} onChange={(e) => updateAutopilot({ personalizationVars: { ...autopilot.personalizationVars, specialInstructions: e.target.value } })}
                  placeholder="e.g., Respond only in writing. Do not contact by phone." rows={2}
                  className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-3 py-2 rounded resize-none" />
              </div>
            </div>
          </div>

          {/* Auto-on features */}
          <div className="cyber-panel p-4 border-zinc-800">
            <h3 className="text-xs font-mono text-zinc-400 mb-3 flex items-center gap-2"><List size={11} /> ALWAYS-ACTIVE PROTECTIONS</h3>
            <div className="space-y-2 text-[10px] font-mono">
              <div className="flex justify-between"><span className="text-zinc-500">Dispute Uniqueness Guard</span><span className="text-[#00ff00]">✓ ON — blocks duplicates per item+bureau+round+template</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Smart Re-Sort on Verification</span><span className="text-[#00ff00]">✓ ON — +15 priority boost when bureau verifies item</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">SOL 7yr Injection</span><span className="text-[#00ff00]">✓ ON — §1681c drop date cited in all letters within 1yr of SOL</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Goodwill Auto-Detect</span><span className="text-[#00ff00]">✓ ON — paid late payments flagged automatically</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">P4D Auto-Detect</span><span className="text-[#00ff00]">✓ ON — collections under $1,000 flagged automatically</span></div>
              <div className="flex justify-between"><span className="text-zinc-500">Furnisher Bypass Detect</span><span className="text-[#00ff00]">✓ ON — 2x verified items trigger bypass alert</span></div>
            </div>
          </div>
        </div>
      )}

      {/* ─── PIPELINE TAB ─────────────────────────────────────────────────────── */}
      {activeTab === "pipeline" && (
        <div className="space-y-4">
          {/* Summary stat row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
            <div className="cyber-panel p-3 border-zinc-800">
              <div className="text-zinc-500 mb-1">TOTAL ITEMS</div>
              <div className="text-white text-lg font-bold">{negativeItems.length}</div>
            </div>
            <div className="cyber-panel p-3 border-[#ff9900]/30">
              <div className="text-zinc-500 mb-1">PENDING</div>
              <div className="text-[#ff9900] text-lg font-bold">{pendingItems.length}</div>
            </div>
            <div className="cyber-panel p-3 border-red-500/30">
              <div className="text-zinc-500 mb-1">OVERDUE</div>
              <div className="text-red-400 text-lg font-bold">{overdueItems.length}</div>
            </div>
            <div className="cyber-panel p-3 border-[#00ff00]/30">
              <div className="text-zinc-500 mb-1">DELETED / WON</div>
              <div className="text-[#00ff00] text-lg font-bold">{wonItems.length}</div>
            </div>
          </div>

          {/* Pipeline table */}
          <div className="cyber-panel p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] font-mono">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/60">
                    <th className="text-left text-zinc-500 px-3 py-2 font-normal">ACCOUNT</th>
                    <th className="text-left text-zinc-500 px-3 py-2 font-normal">BUREAU</th>
                    <th className="text-center text-zinc-500 px-3 py-2 font-normal">RND</th>
                    <th className="text-left text-zinc-500 px-3 py-2 font-normal">STATUS</th>
                    <th className="text-right text-zinc-500 px-3 py-2 font-normal">PRIORITY</th>
                    <th className="text-center text-zinc-500 px-3 py-2 font-normal">TIMELINE</th>
                  </tr>
                </thead>
                <tbody>
                  {[...negativeItems]
                    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
                    .map((item) => {
                      const isOverdue = overdueItems.some((o) => o.id === item.id);
                      const isPending = (item.disputeStatus ?? "").includes("Pending");
                      const isWon = item.disputeStatus === "Won" || item.disputeStatus === "Deleted";
                      const rowColor = isOverdue
                        ? "border-l-2 border-l-red-500 bg-red-950/10"
                        : isPending
                        ? "border-l-2 border-l-[#ff9900] bg-[#ff9900]/5"
                        : isWon
                        ? "border-l-2 border-l-[#00ff00] bg-[#00ff00]/5"
                        : "border-l-2 border-l-zinc-700";
                      const statusColor = isOverdue
                        ? "text-red-400"
                        : isPending
                        ? "text-[#ff9900]"
                        : isWon
                        ? "text-[#00ff00]"
                        : "text-zinc-400";
                      return (
                        <tr key={item.id} className={`border-b border-zinc-800/60 hover:bg-zinc-900/40 transition-colors ${rowColor}`}>
                          <td className="px-3 py-2">
                            <div className="text-white font-bold truncate max-w-[140px]">{item.creditorName}</div>
                            {item.accountType && <div className="text-zinc-600 text-[9px]">{item.accountType}</div>}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(item.creditBureau && item.creditBureau.length > 0 ? item.creditBureau : ["—"]).map((b) => (
                                <span key={b} className="text-[9px] bg-zinc-800 text-zinc-300 px-1 rounded">{b.slice(0, 2).toUpperCase()}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-[#00ffff] font-bold">R{item.disputeRound ?? 0}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`${statusColor} font-bold`}>{item.disputeStatus}</span>
                            {isOverdue && <div className="text-[9px] text-red-400">⚠ OVERDUE</div>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-bold ${(item.priorityScore ?? 0) >= 80 ? "text-red-400" : (item.priorityScore ?? 0) >= 50 ? "text-[#ff9900]" : "text-zinc-400"}`}>
                              {item.priorityScore ?? 0}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <DisputeTimeline item={item} rounds={[]} compact />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {negativeItems.length === 0 && (
                <div className="py-12 text-center text-zinc-600 text-xs font-mono">NO ITEMS IN PIPELINE — UPLOAD A CREDIT REPORT FIRST</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── VALIDATION TAB ─────────────────────────────────────────────────── */}
      {activeTab === "validation" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
            <div className="cyber-panel p-3 border-zinc-800">
              <div className="text-zinc-500 mb-1">TOTAL ITEMS</div>
              <div className="text-white text-lg font-bold">{negativeItems.length}</div>
            </div>
            <div className="cyber-panel p-3 border-[#ff9900]/30">
              <div className="text-zinc-500 mb-1">NEEDS REVIEW</div>
              <div className="text-[#ff9900] text-lg font-bold">{validationQueueItems.length}</div>
            </div>
            <div className="cyber-panel p-3 border-[#00ff00]/30">
              <div className="text-zinc-500 mb-1">CONFIRMED</div>
              <div className="text-[#00ff00] text-lg font-bold">{confirmedAccuracyCount}</div>
            </div>
            <div className="cyber-panel p-3 border-zinc-800">
              <div className="text-zinc-500 mb-1">PARSER LOW CONF.</div>
              <div className="text-white text-lg font-bold">
                {negativeItems.filter((item) => typeof item.parseConfidence === "number" && item.parseConfidence < 0.7).length}
              </div>
            </div>
          </div>

          <div className="cyber-panel p-5 border-[#00ffff]/20">
            <h3 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <CheckSquare size={14} className="text-[#00ffff]" /> VALIDATION OVERRIDE QUEUE
            </h3>
            <p className="text-[10px] text-zinc-500 font-mono mb-4">
              Confirm rejected or uncertain parser items so AutoPilot can trust manually verified account facts during dispute generation.
            </p>

            {validationQueueItems.length === 0 ? (
              <div className="text-zinc-600 text-sm text-center py-10">
                Validation queue is clear. All active items are currently confirmed.
              </div>
            ) : (
              <div className="space-y-3 max-h-[36rem] overflow-y-auto custom-scrollbar">
                {validationQueueItems.map((item) => {
                  const lowConfidence = typeof item.parseConfidence === "number" && item.parseConfidence < 0.7;
                  const resolvedAccountNumber = getResolvedAccountNumber(item);
                  const missingCritical = !item.creditorName || !resolvedAccountNumber || !item.status;

                  return (
                    <div key={item.id} className="bg-[#0a0a0a] border border-zinc-800 rounded p-3">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1">
                          <div className="text-xs font-bold text-white">{item.creditorName || "[Missing Creditor]"}</div>
                          <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                            {item.typeOfNegative || "Unknown"} | {item.creditBureau?.join(", ") || "No bureau"} | Round {item.disputeRound}
                          </div>
                        </div>
                        <div className="flex gap-1 flex-wrap justify-end">
                          {item.dataSource === "manual" && <span className="text-[9px] text-[#00ffff] border border-[#00ffff]/30 px-1 rounded font-mono">MANUAL</span>}
                          {lowConfidence && <span className="text-[9px] text-[#ff9900] border border-[#ff9900]/30 px-1 rounded font-mono">LOW CONF</span>}
                          {missingCritical && <span className="text-[9px] text-red-400 border border-red-400/30 px-1 rounded font-mono">MISSING DATA</span>}
                          {item.accuracyConfirmedByUser && <span className="text-[9px] text-[#00ff00] border border-[#00ff00]/30 px-1 rounded font-mono">CONFIRMED</span>}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px] font-mono text-zinc-400 mb-3">
                        <div>Account: <span className="text-zinc-200">{resolvedAccountNumber || "[Missing]"}</span></div>
                        <div>Status: <span className="text-zinc-200">{item.status || "[Missing]"}</span></div>
                        <div>Balance: <span className="text-zinc-200">{typeof item.balance === "number" ? `$${item.balance}` : "[Missing]"}</span></div>
                        <div>Parse Confidence: <span className="text-zinc-200">{typeof item.parseConfidence === "number" ? `${Math.round(item.parseConfidence * 100)}%` : "n/a"}</span></div>
                      </div>

                      <textarea
                        value={validationNotes[item.id] ?? item.accuracyConfirmationNote ?? ""}
                        onChange={(e) => setValidationNotes((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="Validation note (who confirmed this and why it should be trusted)"
                        rows={2}
                        className="w-full bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-3 py-2 rounded resize-none"
                      />

                      <div className="flex gap-2 mt-2 flex-wrap">
                        <button
                          onClick={() => handleConfirmValidationItem(item.id)}
                          className="text-[10px] border border-[#00ff00]/40 text-[#00ff00] px-3 py-1.5 rounded hover:bg-[#00ff00]/10 font-mono"
                        >
                          CONFIRM OVERRIDE
                        </button>
                        <button
                          onClick={() => handleClearValidationItem(item.id)}
                          className="text-[10px] border border-zinc-700 text-zinc-400 px-3 py-1.5 rounded hover:border-zinc-500 font-mono"
                        >
                          RETURN TO REVIEW
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── SIMULATOR TAB ────────────────────────────────────────────────────── */}
      {activeTab === "simulator" && (
        <ScoreSimulator
          negativeItems={negativeItems}
          currentScores={{
            equifax: latestScore?.equifax ?? undefined,
            experian: latestScore?.experian ?? undefined,
            transunion: latestScore?.transunion ?? undefined,
          }}
        />
      )}

      {/* ─── CROSS-BUREAU TAB ─────────────────────────────────────────────────── */}
      {activeTab === "cross-bureau" && (
        <CrossBureauMatrix negativeItems={negativeItems} />
      )}

      {/* ─── RESPONSES TAB ────────────────────────────────────────────────────── */}
      {activeTab === "responses" && (
        <ResponseRecordingPanel
          negativeItems={negativeItems}
          disputeLetters={disputeLetters}
          onUpdateNegativeItem={(id, updates) => updateNegativeItem(id, updates)}
          onUpdateDisputeLetter={(id, updates) => updateDisputeLetter(id, updates)}
          onAddXP={addXP}
          onLogEvent={(e) => logEvent({ type: 'response_logged', title: e.description, detail: e.description })}
        />
      )}

      {/* ─── MODALS ────────────────────────────────────────────────────────────── */}

      {/* Batch Preview */}
      {showPreviewModal && previewData && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-panel p-6 max-w-md w-full border-[#00ffff]/40">
            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Search size={18} className="text-[#00ffff]" /> BATCH PREVIEW</h3>
            <div className="space-y-3 text-xs">
              <div className="flex justify-between"><span className="text-zinc-400">Items in batch</span><span className="text-white font-bold">{previewData.itemCount}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Bureaus targeted</span><span className="text-white">{previewData.bureaus.join(", ")}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Round</span><span className="text-[#ff9900]">Round {previewData.round}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Dual Dispute</span><span className={previewData.dualDispute ? "text-[#ff00ff]" : "text-zinc-500"}>{previewData.dualDispute ? "YES — Bureau + Furnisher" : "Bureau only"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Mail Mode</span><span className={autopilot.certifiedMailDefault ? "text-[#ff9900]" : "text-zinc-300"}>{previewData.mailMode}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Smart Letters</span><span className={autopilot.smartLetterMode ? "text-[#00ffff]" : "text-zinc-500"}>{autopilot.smartLetterMode ? "AI Vulnerability Targeting" : "Standard Templates"}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">Send Date</span><span className="text-white">{previewData.scheduledDate}</span></div>
              <div className="flex justify-between"><span className="text-zinc-400">SOL Guard</span><span className={autopilot.solPauseGuard ? "text-yellow-400" : "text-zinc-500"}>{autopilot.solPauseGuard ? `ON — ${solPausedItems.length} items held` : "OFF"}</span></div>
              <div className="border-t border-zinc-800 pt-2 text-zinc-500 text-[10px] font-mono">
                Est. letters: {previewData.dualDispute ? previewData.bureaus.length * 2 : previewData.bureaus.length} | Uniqueness guard will filter duplicates
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => runBatch(false)} className="flex-1 cyber-button border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 py-2 text-sm font-bold">
                CONFIRM — RUN BATCH
              </button>
              <button onClick={() => setShowPreviewModal(false)} className="cyber-button border-zinc-700 text-zinc-400 px-4 py-2 text-sm">CANCEL</button>
            </div>
          </div>
        </div>
      )}

      {/* CFPB Complaint */}
      {cfpbModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-panel p-6 max-w-2xl w-full border-red-400/40 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-red-400 flex items-center gap-2"><Megaphone size={16} /> CFPB COMPLAINT DRAFT</h3>
              <button onClick={() => setCfpbModal(null)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">✕</button>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono mb-3">Paste at <span className="text-red-400">consumerfinance.gov/complaint</span> → Credit bureau → Describe what happened.</p>
            <div className="flex-1 overflow-y-auto bg-[#050505] border border-zinc-800 rounded p-3 font-mono text-[10px] text-zinc-300 whitespace-pre-wrap mb-4">
              {cfpbModal.content}
            </div>
            <div className="flex gap-2">
              <button onClick={() => { navigator.clipboard.writeText(cfpbModal.content); setCfpbModal((p) => p ? { ...p, copied: true } : null); }}
                className="flex-1 cyber-button border-red-400 text-red-400 hover:bg-red-400/10 py-2 text-xs font-bold flex items-center justify-center gap-2">
                <Copy size={12} /> {cfpbModal.copied ? "✓ COPIED!" : "COPY TO CLIPBOARD"}
              </button>
              <button onClick={() => setCfpbModal(null)} className="cyber-button border-zinc-700 text-zinc-400 px-4 py-2 text-xs">CLOSE</button>
            </div>
          </div>
        </div>
      )}

      {/* Furnisher Bypass */}
      {furnisherBypassModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-panel p-6 max-w-2xl w-full border-red-500/30 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-red-400 flex items-center gap-2"><SkipForward size={16} /> FURNISHER BYPASS — {furnisherBypassModal.itemName}</h3>
              <button onClick={() => setFurnisherBypassModal(null)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">✕</button>
            </div>
            <p className="text-[10px] text-zinc-500 font-mono mb-3">Saved to Mail Queue as certified mail. Send directly to {furnisherBypassModal.itemName} — bypasses bureau entirely.</p>
            <div className="flex-1 overflow-y-auto bg-[#050505] border border-zinc-800 rounded p-3 font-mono text-[10px] text-zinc-300 whitespace-pre-wrap mb-4">
              {furnisherBypassModal.content}
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigator.clipboard.writeText(furnisherBypassModal.content)}
                className="flex-1 cyber-button border-red-400 text-red-400 hover:bg-red-400/10 py-2 text-xs flex items-center justify-center gap-2">
                <Copy size={12} /> COPY LETTER
              </button>
              <button onClick={() => setFurnisherBypassModal(null)} className="cyber-button border-zinc-700 text-zinc-400 px-4 py-2 text-xs">CLOSE</button>
            </div>
          </div>
        </div>
      )}

      {/* Campaign Success Report */}
      {successReportModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="cyber-panel p-6 max-w-2xl w-full border-[#00ff00]/30 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-[#00ff00] flex items-center gap-2"><BarChart2 size={16} /> CAMPAIGN REPORT — {successReportModal.campaignName}</h3>
              <button onClick={() => setSuccessReportModal(null)} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto bg-[#050505] border border-zinc-800 rounded p-4 text-sm text-zinc-300 whitespace-pre-wrap mb-4">
              {successReportModal.content}
            </div>
            <button onClick={() => setSuccessReportModal(null)} className="cyber-button border-zinc-700 text-zinc-400 px-4 py-2 text-xs w-full">CLOSE</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Sub-component for mail queue items (avoids useState in map)
function MailQueueItem({ letter, itemName, itemType, onMarkMailed }: {
  letter: any;
  itemName: string;
  itemType: string;
  onMarkMailed: (id: string, tracking?: string) => void;
}) {
  const [tracking, setTracking] = useState("");
  return (
    <div className={`p-4 bg-[#0a0a0a] border rounded-lg ${letter.certifiedMail ? "border-[#ff9900]/30" : "border-zinc-800"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-bold text-white">{letter.bureau}</span>
            <span className="text-[9px] font-mono text-zinc-500">R{letter.round}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400">{letter.templateType}</span>
            {letter.certifiedMail
              ? <span className="text-[9px] text-[#ff9900] border border-[#ff9900]/30 px-1.5 rounded font-mono">CERTIFIED</span>
              : <span className="text-[9px] text-zinc-400 border border-zinc-700 px-1.5 rounded font-mono">STAMP</span>
            }
            {letter.targetType === "furnisher" && <span className="text-[9px] text-[#ff00ff] border border-[#ff00ff]/30 px-1 rounded">FURNISHER</span>}
            {letter.targetType === "dual" && <span className="text-[9px] text-[#00ffff] border border-[#00ffff]/30 px-1 rounded">DUAL</span>}
          </div>
          {itemName && <div className="text-[10px] text-zinc-500 font-mono mt-1">{itemName} — {itemType}</div>}
          <div className="text-[10px] text-zinc-600 font-mono">{new Date(letter.createdAt).toLocaleString()}</div>
        </div>
        <button onClick={() => onMarkMailed(letter.id, tracking)}
          className="text-[10px] border border-[#00ff00]/30 text-[#00ff00] px-3 py-1.5 rounded hover:bg-[#00ff00]/10 font-mono whitespace-nowrap">
          ✉ MARK MAILED
        </button>
      </div>
      {letter.certifiedMail && (
        <div className="mt-2 flex gap-2 items-center">
          <Hash size={10} className="text-[#ff9900]" />
          <input type="text" placeholder="Enter USPS tracking number (optional)" value={tracking} onChange={(e) => setTracking(e.target.value)}
            className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-300 text-[10px] font-mono px-2 py-1 rounded" />
        </div>
      )}
    </div>
  );
}

function KpiCockpitPanel() {
  const [stats, setStats] = React.useState(() => getBureauCreditorStats());
  const [batchTrend, setBatchTrend] = React.useState<number[]>([]);

  React.useEffect(() => {
    void loadOutcomesFromIdb().then(() => {
      setStats(getBureauCreditorStats());
    });
    try {
      const raw = localStorage.getItem('dylandos_batch_confidence_trend');
      if (raw) setBatchTrend(JSON.parse(raw) as number[]);
    } catch { /* ignore */ }
    const last = AutoPilotEngineV2.getState().lastCycleResult;
    if (last?.batchRationaleStructured) {
      const selected = last.lettersGenerated;
      const eligible = last.batchRationaleStructured.eligibleCount || 1;
      const confidence = Math.round(Math.min(100, (selected / eligible) * 100));
      setBatchTrend((prev) => {
        const next = [...prev, confidence].slice(-12);
        try { localStorage.setItem('dylandos_batch_confidence_trend', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }
  }, []);

  const pass1 = stats.filter((s) => s.passNumber === 1);
  const pass2 = stats.filter((s) => s.passNumber === 2);
  const rate = (rows: typeof stats) => {
    const total = rows.reduce((n, r) => n + r.total, 0);
    const deleted = rows.reduce((n, r) => n + r.deleted, 0);
    return total > 0 ? Math.round((deleted / total) * 100) : 0;
  };

  return (
    <div className="cyber-panel p-5 border-[#00ff00]/20">
      <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
        <TrendingUp size={14} className="text-[#00ff00]" /> KPI COCKPIT — DELETION RATES &amp; BATCH TREND
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono mb-3">
        <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">PASS 1 DELETE %</div><div className="text-[#00ff00] font-bold">{rate(pass1)}%</div></div>
        <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">PASS 2 DELETE %</div><div className="text-[#00ff00] font-bold">{rate(pass2)}%</div></div>
        <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">SAMPLES</div><div className="text-white font-bold">{stats.reduce((n, s) => n + s.total, 0)}</div></div>
        <div className="border border-zinc-800 rounded p-2"><div className="text-zinc-500">BATCH CONF. TREND</div><div className="text-[#00ffff] font-bold">{batchTrend.length ? batchTrend.join('→') : '—'}</div></div>
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {stats.slice(0, 12).map((s) => (
          <div key={`${s.bureau}|${s.creditorName}|${s.passNumber}`} className="flex justify-between text-[10px] font-mono border border-zinc-800/80 rounded px-2 py-1 text-zinc-400">
            <span>{s.bureau} · {s.creditorName} · P{s.passNumber}</span>
            <span className="text-[#00ff00]">{Math.round(s.deletionRate * 100)}% ({s.deleted}/{s.total})</span>
          </div>
        ))}
        {stats.length === 0 && (
          <p className="text-[10px] text-zinc-600 font-mono">No outcome samples yet — log responses or upload a new report after disputes.</p>
        )}
      </div>
    </div>
  );
}

function ToggleSwitch({
  label,
  enabled,
  onClick,
  color,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <div className="flex items-center justify-between bg-[#0a0a0a] border border-zinc-800 rounded px-3 py-2">
      <span className="text-zinc-300">{label}</span>
      <button onClick={onClick} title={label} aria-label={label} className={`relative w-12 h-6 rounded-full transition-all ${enabled ? color : "bg-zinc-700"}`}>
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${enabled ? "left-7" : "left-1"}`} />
      </button>
    </div>
  );
}

// ── WORLD-CLASS RESPONSE RECORDING PANEL ──────────────────────────────────────
// Records bureau responses and auto-advances items to the correct next round
function ResponseRecordingPanel({
  negativeItems,
  disputeLetters,
  onUpdateNegativeItem,
  onUpdateDisputeLetter,
  onAddXP,
  onLogEvent,
}: {
  negativeItems: import('../types').NegativeItem[];
  disputeLetters: import('../types').DisputeLetter[];
  onUpdateNegativeItem: (id: string, updates: Partial<import('../types').NegativeItem>) => void;
  onUpdateDisputeLetter: (id: string, updates: Partial<import('../types').DisputeLetter>) => void;
  onAddXP: (amount: number) => void;
  onLogEvent: (e: { description: string; itemId?: string; metadata?: Record<string, unknown> }) => void;
}) {
  const [selectedItemId, setSelectedItemId] = React.useState<string>('');
  const [selectedBureau, setSelectedBureau] = React.useState<string>('');
  const [response, setResponse] = React.useState<string>('');
  const [showCelebration, setShowCelebration] = React.useState(false);

  const pendingItems = negativeItems.filter(
    i => i.disputeStatus !== 'Undisputed' &&
    i.disputeStatus !== 'Deleted' &&
    i.disputeStatus !== 'Won'
  );

  const handleRecord = () => {
    if (!selectedItemId || !response) {
      alert('Please select an item and response type.');
      return;
    }

    const item = negativeItems.find(i => i.id === selectedItemId);
    if (!item) return;

    const currentRound = item.disputeRound ?? 1;
    let newStatus: string;
    let newRound: number;

    switch (response) {
      case 'DELETED':
        newStatus = 'Deleted';
        newRound = currentRound;
        setShowCelebration(true);
        setTimeout(() => setShowCelebration(false), 5000);
        onAddXP(500);
        break;
      case 'VERIFIED_ACCURATE':
        newStatus = `Round${currentRound}-Verified`;
        newRound = Math.min(6, currentRound + 1);
        break;
      case 'UPDATED':
        newStatus = 'Won';
        newRound = currentRound;
        onAddXP(200);
        break;
      case 'NO_RESPONSE':
        newStatus = `Round${currentRound}-Verified`;
        newRound = Math.min(6, currentRound + 1);
        break;
      case 'FRIVOLOUS':
        newStatus = `Round${currentRound}-Verified`;
        newRound = Math.min(6, currentRound + 1);
        break;
      default:
        newStatus = item.disputeStatus;
        newRound = currentRound;
    }

    onUpdateNegativeItem(selectedItemId, {
      disputeStatus: newStatus as any,
      disputeRound: newRound as any,
      verificationCount: (item.verificationCount ?? 0) + (response === 'VERIFIED_ACCURATE' ? 1 : 0),
      doubleVerified: (item.verificationCount ?? 0) >= 1 && response === 'VERIFIED_ACCURATE',
    });

    const relatedLetters = disputeLetters.filter(
      l => l.negativeItemIds.includes(selectedItemId) && l.status === 'Sent'
    );
    relatedLetters.forEach(l => onUpdateDisputeLetter(l.id, { status: 'Resolved' as any }));

    onLogEvent({
      description: `${item.creditorName} — Bureau: ${selectedBureau || 'Unknown'} — Response: ${response} — Round ${currentRound}`,
      itemId: selectedItemId,
      metadata: { response, bureau: selectedBureau, round: currentRound },
    });

    setSelectedItemId('');
    setSelectedBureau('');
    setResponse('');

    if (response !== 'DELETED' && response !== 'UPDATED') {
      alert(`✅ Recorded! Item advanced to Round ${newRound}. AutoPilot will generate the next letter on the next cycle.`);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '640px' }}>
      {showCelebration && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.85)', zIndex: 9999,
          flexDirection: 'column', gap: '16px',
        }}>
          <div style={{ fontSize: '80px' }}>🎉</div>
          <h1 style={{ fontSize: '36px', fontWeight: 'bold', color: '#22c55e', textAlign: 'center' }}>DELETED!</h1>
          <p style={{ color: '#aaa', fontSize: '18px', textAlign: 'center' }}>
            Negative item removed from your credit report!<br />Your score is on the way up! 📈
          </p>
          <button onClick={() => setShowCelebration(false)} style={{
            padding: '12px 32px', background: '#22c55e', color: '#000',
            border: 'none', borderRadius: '8px', cursor: 'pointer',
            fontSize: '16px', fontWeight: 'bold', marginTop: '8px',
          }}>Awesome! 🚀</button>
        </div>
      )}

      <h2 style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '6px', color: '#fff' }}>
        📬 Record Bureau Response
      </h2>
      <p style={{ color: '#666', fontSize: '13px', marginBottom: '20px' }}>
        When you receive a response from a bureau or creditor, record it here. AutoPilot will automatically advance to the correct next action.
      </p>

      {pendingItems.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '32px',
          background: 'rgba(0,0,0,0.3)', borderRadius: '10px',
          border: '2px dashed rgba(255,255,255,0.08)', color: '#666', fontSize: '14px',
        }}>
          No items are currently in dispute.<br />
          <span style={{ fontSize: '12px', color: '#444' }}>Run AutoPilot to generate dispute letters first.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ fontSize: '13px', color: '#888', display: 'block', marginBottom: '6px' }}>Select Account</label>
            <select value={selectedItemId} onChange={e => setSelectedItemId(e.target.value)} style={{
              width: '100%', padding: '10px 12px',
              background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px', color: '#fff', fontSize: '13px',
            }}>
              <option value="">-- Select Account --</option>
              {pendingItems.map(item => (
                <option key={item.id} value={item.id}>
                  {item.creditorName} — Round {item.disputeRound} — {item.disputeStatus}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '13px', color: '#888', display: 'block', marginBottom: '6px' }}>Which Bureau Responded</label>
            <select value={selectedBureau} onChange={e => setSelectedBureau(e.target.value)} style={{
              width: '100%', padding: '10px 12px',
              background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '8px', color: '#fff', fontSize: '13px',
            }}>
              <option value="">-- Select Bureau --</option>
              <option value="Equifax">Equifax</option>
              <option value="Experian">Experian</option>
              <option value="TransUnion">TransUnion</option>
              <option value="Furnisher">Furnisher / Creditor Directly</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: '13px', color: '#888', display: 'block', marginBottom: '8px' }}>Response Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {([
                { value: 'DELETED', label: '✅ DELETED', desc: 'Item removed!', color: '#22c55e' },
                { value: 'UPDATED', label: '📝 UPDATED', desc: 'Info corrected', color: '#60a5fa' },
                { value: 'VERIFIED_ACCURATE', label: '🔄 VERIFIED', desc: 'Still reporting', color: '#fbbf24' },
                { value: 'NO_RESPONSE', label: '⏰ NO RESPONSE', desc: 'No reply in 30 days', color: '#f87171' },
                { value: 'FRIVOLOUS', label: '❌ FRIVOLOUS', desc: 'Marked frivolous', color: '#c084fc' },
              ] as const).map(r => (
                <div key={r.value} onClick={() => setResponse(r.value)} style={{
                  padding: '10px 12px', cursor: 'pointer',
                  background: response === r.value ? `${r.color}22` : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${response === r.value ? r.color + '66' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '8px', transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 'bold', color: response === r.value ? r.color : '#fff' }}>{r.label}</div>
                  <div style={{ fontSize: '11px', color: '#666' }}>{r.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleRecord}
            disabled={!selectedItemId || !response}
            style={{
              padding: '12px 24px',
              background: selectedItemId && response ? 'linear-gradient(135deg, #3b82f6, #8b5cf6)' : 'rgba(255,255,255,0.1)',
              color: '#fff', border: 'none', borderRadius: '8px',
              cursor: selectedItemId && response ? 'pointer' : 'not-allowed',
              fontSize: '14px', fontWeight: 'bold', transition: 'all 0.2s',
            }}
          >
            📋 Record Response
          </button>
        </div>
      )}
    </div>
  );
}
