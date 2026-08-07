import React, { useState, useCallback, useEffect } from "react";
import {
  AlertTriangle, ChevronDown, ChevronUp, Plus, Send, StickyNote,
  Calendar, TrendingDown, ShieldAlert, Filter, Search, Mail,
  CheckCircle2, Clock, RefreshCw, Trash2, Tag, Activity,
  CheckSquare2, Square, Link2, Edit2, X, Save,
} from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { useToast } from "../context/ToastContext";
import { NegativeItem, ItemNote, DisputeItemStatus, DisputeRound } from "../types";
import { v4 as uuidv4 } from "uuid";
import { getDaysRemaining } from "../services/autopilotEngine";
import { estimateScoreImpact } from "../services/geminiService";
import { calculateDeletionProbability } from "../services/deletionProbabilityEngine";
import type { PendingReviewMerge } from "../services/tradelineMerger";
import { stitchAccountNumbers } from "../services/tradelineMerger";

// Dispute progress steps
const DISPUTE_STEPS = [
  { key: "R1", label: "Round 1", statuses: ["Round1-Pending", "Round1-Verified"] },
  { key: "R2", label: "Round 2", statuses: ["Round2-Pending", "Round2-Verified"] },
  { key: "R3", label: "Round 3", statuses: ["Round3-Pending", "Round3-Verified"] },
  { key: "R4", label: "Round 4", statuses: ["Round4-Legal", "Round4-Verified"] },
  { key: "R5", label: "Round 5", statuses: ["Round5-CFPB", "Round5-Verified"] },
  { key: "R6", label: "Round 6", statuses: ["Round6-PreLit"] },
];

function DisputeProgressBar({ status }: { status: string }) {
  if (status === "Undisputed" || status === "Won" || status === "Deleted") return null;
  const activeIdx = DISPUTE_STEPS.findIndex((s) => s.statuses.includes(status));
  const isResolved = status === "Won" || status === "Deleted";
  return (
    <div className="px-4 pb-3 flex items-center gap-1">
      {DISPUTE_STEPS.map((step, i) => {
        const done = activeIdx > i || isResolved;
        const active = activeIdx === i;
        return (
          <React.Fragment key={step.key}>
            <div className={`flex items-center justify-center text-[8px] font-bold font-mono px-2 py-0.5 rounded border transition-all ${
              done ? "border-[#00ff00]/50 bg-[#00ff00]/10 text-[#00ff00]" :
              active ? "border-[#00ffff]/60 bg-[#00ffff]/10 text-[#00ffff]" :
              "border-zinc-800 text-zinc-700"
            }`}>{step.label}</div>
            {i < DISPUTE_STEPS.length - 1 && (
              <div className={`flex-1 h-px max-w-8 ${done ? "bg-[#00ff00]/40" : "bg-zinc-800"}`} />
            )}
          </React.Fragment>
        );
      })}
      <div className={`ml-1 text-[8px] font-mono ${isResolved ? "text-[#00ff00]" : "text-zinc-600"}`}>
        {isResolved ? "✓ RESOLVED" : "→ NEXT"}
      </div>
    </div>
  );
}


const TYPE_COLORS: Record<string, string> = {
  "Collection": "border-l-red-500",
  "Charge-Off": "border-l-red-400",
  "Late Payment": "border-l-[#ff9900]",
  "Bankruptcy": "border-l-red-700",
  "Foreclosure": "border-l-red-600",
  "Repossession": "border-l-red-500",
  "Judgment": "border-l-purple-500",
  "Tax Lien": "border-l-purple-400",
  "Inquiry": "border-l-zinc-500",
} as const;

const PRIORITY_COLOR = (score: number) =>
  score >= 35 ? "text-red-400" : score >= 25 ? "text-[#ff9900]" : score >= 15 ? "text-yellow-500" : "text-zinc-400";

const STATUS_BADGE: Record<string, string> = {
  "Undisputed": "border-zinc-600 text-zinc-500",
  "Round1-Pending": "border-blue-400 text-blue-400",
  "Round1-Verified": "border-[#ff9900] text-[#ff9900]",
  "Round2-Pending": "border-blue-300 text-blue-300",
  "Round2-Verified": "border-[#ff9900] text-[#ff9900]",
  "Round3-Pending": "border-purple-400 text-purple-400",
  "Round3-Verified": "border-[#ff9900] text-[#ff9900]",
  "Round4-Legal": "border-red-500 text-red-500",
  "Round4-Verified": "border-[#ff9900] text-[#ff9900]",
  "Round5-CFPB": "border-red-400 text-red-400",
  "Round5-Verified": "border-[#ff9900] text-[#ff9900]",
  "Round6-PreLit": "border-fuchsia-400 text-fuchsia-400",
  "Deleted": "border-[#00ff00] text-[#00ff00]",
  "Won": "border-[#00ff00] text-[#00ff00]",
};

function getDeletionOdds(item: NegativeItem) {
  const priorOutcomes: Array<"DELETED" | "UPDATED" | "VERIFIED_ACCURATE" | "NO_RESPONSE_30_DAYS" | "FRIVOLOUS"> = [];

  if ((item.disputeStatus ?? "").includes("Verified")) priorOutcomes.push("VERIFIED_ACCURATE");
  if (item.disputeStatus === "Won" || item.disputeStatus === "Deleted") priorOutcomes.push("DELETED");

  const hasMetro2Violations = /metro\s*2|format|code/i.test(item.additionalInfo || "");
  const hasCrossBureauInconsistency = (item.creditBureau || []).length > 1;
  const documentationStrength = (item.notes || []).length >= 3 ? "high" : (item.notes || []).length >= 1 ? "medium" : "low";

  return calculateDeletionProbability({
    item,
    round: item.disputeRound,
    priorOutcomes,
    hasMetro2Violations,
    hasCrossBureauInconsistency,
    documentationStrength,
  });
}

// ── NEGATIVE ITEM TYPES ───────────────────────────────────────────────────
const NEGATIVE_TYPES = [
  "Collection", "Charge-Off", "Late Payment", "Bankruptcy",
  "Foreclosure", "Repossession", "Judgment", "Tax Lien",
  "Other Derogatory", "Inquiry",
];

const BUREAUS_ALL = ["Equifax", "TransUnion", "Experian"] as const;

// ── MANUAL ADD / EDIT MODAL ───────────────────────────────────────────────
interface ManualItemModalProps {
  existing?: NegativeItem | null;
  onSave: (item: NegativeItem) => void;
  onClose: () => void;
}

function ManualItemModal({ existing, onSave, onClose }: ManualItemModalProps) {
  const isEdit = !!existing;

  const [form, setForm] = useState<{
    creditorName: string;
    accountNumber: string;
    balance: string;
    typeOfNegative: string;
    creditBureau: string[];
    status: string;
    dateOpened: string;
    dateClosed: string;
    dateOfFirstDelinquency: string;
    originalCreditor: string;
    accountType: string;
    additionalInfo: string;
    originalBalance: string;
    creditLimit: string;
    confirmAccuracy: boolean;
    confirmationNote: string;
  }>({
    creditorName: existing?.creditorName ?? "",
    accountNumber: existing?.fullAccountNumber ?? existing?.accountNumber ?? "",
    balance: existing?.balance != null ? String(existing.balance) : "",
    typeOfNegative: existing?.typeOfNegative ?? "Collection",
    creditBureau: existing?.creditBureau ?? ["Equifax"],
    status: existing?.status ?? "Collection",
    dateOpened: existing?.dateOpened ?? "",
    dateClosed: existing?.dateClosed ?? "",
    dateOfFirstDelinquency: existing?.dateOfFirstDelinquency ?? existing?.originalDateOfDelinquency ?? "",
    originalCreditor: existing?.originalCreditor ?? "",
    accountType: existing?.accountType ?? "",
    additionalInfo: existing?.additionalInfo ?? "",
    originalBalance: existing?.originalBalance != null ? String(existing.originalBalance) : "",
    creditLimit: existing?.creditLimit != null ? String(existing.creditLimit) : "",
    confirmAccuracy: existing?.accuracyConfirmedByUser ?? true,
    confirmationNote: existing?.accuracyConfirmationNote ?? "",
  });

  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const toggleBureau = (b: string) =>
    setForm((f) => ({
      ...f,
      creditBureau: f.creditBureau.includes(b)
        ? f.creditBureau.filter((x) => x !== b)
        : [...f.creditBureau, b],
    }));

  function computeAutoRemoval(dofd: string): string | null {
    const m = dofd.match(/^(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = new Date(Number(m[2]), Number(m[1]) - 1, 1);
      d.setFullYear(d.getFullYear() + 7);
      return d.toISOString().slice(0, 10);
    }
    const m2 = dofd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m2) {
      const d = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
      d.setFullYear(d.getFullYear() + 7);
      return d.toISOString().slice(0, 10);
    }
    return null;
  }

  const handleSave = () => {
    if (!form.creditorName.trim()) {
      setError("Creditor name is required.");
      return;
    }
    if (form.creditBureau.length === 0) {
      setError("Select at least one bureau.");
      return;
    }
    setError(null);

    const dofd = form.dateOfFirstDelinquency.trim() || null;
    const confirmTimestamp = form.confirmAccuracy
      ? (existing?.accuracyConfirmedAt ?? new Date().toISOString())
      : null;
    const item: NegativeItem = {
      ...(existing ?? {}),
      id: existing?.id ?? uuidv4(),
      creditorName: form.creditorName.trim(),
      accountNumber: form.accountNumber.trim(),
      fullAccountNumber: form.accountNumber.trim() || null,
      balance: form.balance !== "" ? parseFloat(form.balance) || null : null,
      typeOfNegative: form.typeOfNegative,
      creditBureau: form.creditBureau,
      status: form.status.trim() || form.typeOfNegative,
      dateOpened: form.dateOpened.trim() || null,
      dateClosed: form.dateClosed.trim() || null,
      dateOfFirstDelinquency: dofd,
      originalDateOfDelinquency: dofd,
      autoRemovalDate: dofd ? computeAutoRemoval(dofd) : null,
      originalCreditor: form.originalCreditor.trim() || null,
      accountType: form.accountType.trim() || null,
      additionalInfo: form.additionalInfo.trim(),
      originalBalance: form.originalBalance !== "" ? parseFloat(form.originalBalance) || null : null,
      creditLimit: form.creditLimit !== "" ? parseFloat(form.creditLimit) || null : null,
      // Preserve or set defaults for required fields not in form
      disputeRound: existing?.disputeRound ?? 1,
      disputeStatus: existing?.disputeStatus ?? "Undisputed",
      lastDisputeDate: existing?.lastDisputeDate ?? null,
      disputeDeadline: existing?.disputeDeadline ?? null,
      priorityScore: existing?.priorityScore ?? 0,
      estimatedScoreImpact: existing?.estimatedScoreImpact ?? null,
      notes: existing?.notes ?? [],
      solDropDate: existing?.solDropDate ?? null,
      dateOfLastReporting: existing?.dateOfLastReporting ?? null,
      originalOpeningDate: (form.dateOpened.trim() || existing?.originalOpeningDate) ?? null,
      parseConfidence: existing?.parseConfidence ?? 1.0,
      dateLastActive: existing?.dateLastActive ?? null,
      furnisher: existing?.furnisher ?? form.creditorName.trim(),
      paymentHistory: existing?.paymentHistory ?? null,
      crossBureauGroupId: existing?.crossBureauGroupId ?? null,
      disputeContactPhone: existing?.disputeContactPhone ?? null,
      disputeContactAddress: existing?.disputeContactAddress ?? null,
      dataSource: existing?.dataSource ?? "manual",
      accuracyConfirmedByUser: form.confirmAccuracy,
      accuracyConfirmedAt: confirmTimestamp,
      accuracyConfirmationNote: form.confirmationNote.trim() || null,
    };
    onSave(item);
  };

  const inputCls = "w-full bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none";
  const labelCls = "block text-[10px] font-mono text-zinc-500 mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#0d0d0d] border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto custom-scrollbar"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800 sticky top-0 bg-[#0d0d0d] z-10">
          <h3 className="text-sm font-bold font-mono text-[#00ffff] flex items-center gap-2">
            {isEdit ? <Edit2 size={14} /> : <Plus size={14} />}
            {isEdit ? "EDIT NEGATIVE ITEM" : "ADD NEGATIVE ITEM MANUALLY"}
          </h3>
          <button onClick={onClose} title="Close" aria-label="Close modal" className="text-zinc-500 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">{error}</div>
          )}

          {/* Row 1: Creditor + Account # */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>CREDITOR NAME *</label>
              <input
                className={inputCls}
                value={form.creditorName}
                onChange={(e) => set("creditorName", e.target.value)}
                placeholder="e.g. MIDLAND CREDIT MANAGEMENT"
              />
            </div>
            <div>
              <label className={labelCls}>ACCOUNT NUMBER</label>
              <input
                className={inputCls}
                value={form.accountNumber}
                onChange={(e) => set("accountNumber", e.target.value)}
                placeholder="Full or partial (e.g. ****2923)"
              />
            </div>
          </div>

          {/* Row 2: Type + Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>NEGATIVE TYPE *</label>
              <select
                className={inputCls + " cursor-pointer"}
                value={form.typeOfNegative}
                onChange={(e) => set("typeOfNegative", e.target.value)}
                title="Negative type"
                aria-label="Negative type"
              >
                {NEGATIVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>STATUS</label>
              <input
                className={inputCls}
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
                placeholder="e.g. Collection, Charge-Off, Late 90"
              />
            </div>
          </div>

          {/* Row 3: Bureaus */}
          <div>
            <label className={labelCls}>BUREAUS *</label>
            <div className="flex gap-3">
              {BUREAUS_ALL.map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => toggleBureau(b)}
                  className={`text-xs px-3 py-1.5 rounded border font-mono transition-all ${
                    form.creditBureau.includes(b)
                      ? "border-[#00ffff] text-[#00ffff] bg-[#00ffff]/10"
                      : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
                  }`}
                >
                  {b.slice(0, 2).toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Row 4: Balance fields */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>CURRENT BALANCE ($)</label>
              <input
                className={inputCls}
                type="number"
                min="0"
                value={form.balance}
                onChange={(e) => set("balance", e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelCls}>ORIGINAL BALANCE ($)</label>
              <input
                className={inputCls}
                type="number"
                min="0"
                value={form.originalBalance}
                onChange={(e) => set("originalBalance", e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className={labelCls}>CREDIT LIMIT ($)</label>
              <input
                className={inputCls}
                type="number"
                min="0"
                value={form.creditLimit}
                onChange={(e) => set("creditLimit", e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Row 5: Dates */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>DATE OPENED</label>
              <input
                className={inputCls}
                value={form.dateOpened}
                onChange={(e) => set("dateOpened", e.target.value)}
                placeholder="MM/YYYY or YYYY-MM-DD"
              />
            </div>
            <div>
              <label className={labelCls}>DATE CLOSED</label>
              <input
                className={inputCls}
                value={form.dateClosed}
                onChange={(e) => set("dateClosed", e.target.value)}
                placeholder="MM/YYYY or YYYY-MM-DD"
              />
            </div>
            <div>
              <label className={labelCls}>DATE OF FIRST DELINQUENCY (DOFD)</label>
              <input
                className={inputCls}
                value={form.dateOfFirstDelinquency}
                onChange={(e) => set("dateOfFirstDelinquency", e.target.value)}
                placeholder="MM/YYYY — triggers 7-yr FCRA clock"
              />
            </div>
          </div>

          {/* Row 6: Original creditor + account type */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>ORIGINAL CREDITOR</label>
              <input
                className={inputCls}
                value={form.originalCreditor}
                onChange={(e) => set("originalCreditor", e.target.value)}
                placeholder="If sold to collection agency"
              />
            </div>
            <div>
              <label className={labelCls}>ACCOUNT TYPE</label>
              <input
                className={inputCls}
                value={form.accountType}
                onChange={(e) => set("accountType", e.target.value)}
                placeholder="e.g. Credit Card, Auto Loan, Medical"
              />
            </div>
          </div>

          {/* Row 7: Remarks */}
          <div>
            <label className={labelCls}>REMARKS / ADDITIONAL INFO</label>
            <textarea
              className={inputCls + " h-16 resize-none"}
              value={form.additionalInfo}
              onChange={(e) => set("additionalInfo", e.target.value)}
              placeholder="Any notes about this account from the report..."
            />
          </div>

          <div className="rounded border border-[#00ffff]/20 bg-[#00ffff]/5 p-3 space-y-2">
            <label className="flex items-center gap-2 text-xs text-zinc-200 cursor-pointer">
              <input
                type="checkbox"
                checked={form.confirmAccuracy}
                onChange={(e) => set("confirmAccuracy", e.target.checked)}
                className="w-4 h-4 rounded border-zinc-600"
              />
              Confirm negative item accuracy (manual override trusted by AutoPilot)
            </label>
            <input
              className={inputCls}
              value={form.confirmationNote}
              onChange={(e) => set("confirmationNote", e.target.value)}
              placeholder="Optional: how you verified this item (report page, statement, etc.)"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-zinc-800 sticky bottom-0 bg-[#0d0d0d]">
          <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 px-4 py-2 border border-zinc-700 rounded transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="cyber-button text-xs border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-5 py-2 flex items-center gap-2"
          >
            <Save size={13} />
            {isEdit ? "SAVE CHANGES" : "ADD ITEM"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function NegativeItems() {
  const {
    negativeItems, updateNegativeItem, removeNegativeItem, updateDisputeItemStatus, smartMergeAccounts,
    addNegativeItems,
  } = useAppContext();
  const { toast } = useToast();

  const handleSmartMerge = useCallback(() => {
    const result = smartMergeAccounts();
    const parts = [
      result.mergedAccounts ? `${result.mergedAccounts} duplicate row${result.mergedAccounts === 1 ? "" : "s"} linked` : "No new automatic links",
      result.reviewCandidates ? `${result.reviewCandidates} close match${result.reviewCandidates === 1 ? "" : "es"} ready for review` : "",
    ].filter(Boolean);
    toast(`${parts.join(" · ")}. Account digits were reconstructed only from non-conflicting report data.`, "success");
  }, [smartMergeAccounts, toast]);

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [sortBy, setSortBy] = useState<"priority" | "date" | "status">("priority");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [certTracking, setCertTracking] = useState("");
  const [impactLoading, setImpactLoading] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Manual add/edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<NegativeItem | null>(null);
  const [matchReview, setMatchReview] = useState<PendingReviewMerge[]>([]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<PendingReviewMerge[] | {
        pendingReviewMerges?: PendingReviewMerge[];
        linkOnlyPairs?: PendingReviewMerge[];
      }>).detail;
      const candidates = Array.isArray(detail)
        ? detail
        : (detail?.pendingReviewMerges ?? []);
      const rejected: string[] = JSON.parse(localStorage.getItem('dylandos_rejected_account_matches') || '[]');
      const rejectedSet = new Set(rejected);
      setMatchReview(candidates.filter(candidate => !rejectedSet.has([candidate.leftId, candidate.rightId].sort().join(':'))));
    };
    window.addEventListener('account-match-review', listener);
    return () => window.removeEventListener('account-match-review', listener);
  }, []);

  const resolveMatch = useCallback((same: boolean) => {
    const candidate = matchReview[0];
    if (!candidate) return;
    const left = negativeItems.find(item => item.id === candidate.leftId) ?? candidate.left;
    const right = negativeItems.find(item => item.id === candidate.rightId) ?? candidate.right;
    if (same && left && right) {
      const groupId = left.crossBureauGroupId || right.crossBureauGroupId || uuidv4();
      const { accountNumber } = stitchAccountNumbers([left, right]);
      updateNegativeItem(left.id, { crossBureauGroupId: groupId, fullAccountNumber: accountNumber || left.fullAccountNumber || null });
      updateNegativeItem(right.id, { crossBureauGroupId: groupId, fullAccountNumber: accountNumber || right.fullAccountNumber || null });
      toast('Merge confirmed. Suffix-stitched account digits applied.', 'success');
    } else {
      const key = [candidate.leftId, candidate.rightId].sort().join(':');
      const rejected: string[] = JSON.parse(localStorage.getItem('dylandos_rejected_account_matches') || '[]');
      localStorage.setItem('dylandos_rejected_account_matches', JSON.stringify([...new Set([...rejected, key])]));
      toast('Accounts will remain separate.', 'info');
    }
    setMatchReview(current => current.slice(1));
  }, [matchReview, negativeItems, updateNegativeItem, toast]);

  const openAddModal = useCallback(() => {
    setEditingItem(null);
    setModalOpen(true);
  }, []);

  const openEditModal = useCallback((item: NegativeItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingItem(item);
    setModalOpen(true);
  }, []);

  const handleModalSave = useCallback((item: NegativeItem) => {
    if (editingItem) {
      updateNegativeItem(item.id, item);
      toast("Item updated successfully.", "success");
    } else {
      addNegativeItems([item]);
      toast("Item added successfully.", "success");
    }
    setModalOpen(false);
    setEditingItem(null);
  }, [editingItem, updateNegativeItem, addNegativeItems, toast]);

  const uniqueTypes = Array.from(new Set(negativeItems.map((i) => i.typeOfNegative ?? "Unknown"))).filter(Boolean);

  const sorted = [...negativeItems]
    .filter((i) => {
      const matchSearch =
        (i.creditorName ?? "").toLowerCase().includes(search.toLowerCase()) ||
        (i.accountNumber?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
        (i.fullAccountNumber?.toLowerCase().includes(search.toLowerCase()) ?? false);
      const matchType = filterType === "All" || (i.typeOfNegative ?? "") === filterType;
      const matchStatus = filterStatus === "All" || (i.disputeStatus ?? "") === filterStatus;
      return matchSearch && matchType && matchStatus;
    })
    .sort((a, b) => {
      if (sortBy === "priority") return (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
      if (sortBy === "date") return new Date(b.dateOpened ?? 0).getTime() - new Date(a.dateOpened ?? 0).getTime();
      return (a.disputeStatus ?? "").localeCompare(b.disputeStatus ?? "");
    });

  const addNote = useCallback((item: NegativeItem) => {
    if (!noteText.trim()) return;
    const note: ItemNote = {
      id: uuidv4(),
      date: new Date().toISOString(),
      text: noteText.trim(),
      certifiedMailTracking: certTracking.trim() || undefined,
    };
    updateNegativeItem(item.id, { notes: [...(item.notes || []), note] });
    setNoteText(""); setCertTracking("");
  }, [noteText, certTracking, updateNegativeItem]);

  const estimateImpact = useCallback(async (item: NegativeItem) => {
    setImpactLoading(item.id);
    try {
      const result = await estimateScoreImpact(item);
      updateNegativeItem(item.id, { estimatedScoreImpact: result });
    } catch {}
    setImpactLoading(null);
  }, [updateNegativeItem]);

  // Multi-select helpers
  const getDaysUntilRemoval = (autoRemovalDate?: string | null): number | null => {
    if (!autoRemovalDate) return null;
    const removal = new Date(autoRemovalDate);
    if (isNaN(removal.getTime())) return null;
    return Math.ceil((removal.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  };

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === sorted.length ? new Set() : new Set(sorted.map((i) => i.id))
    );
  }, [sorted]);

  const deleteSelected = useCallback(() => {
    selectedIds.forEach((id) => removeNegativeItem(id));
    setSelectedIds(new Set());
  }, [selectedIds, removeNegativeItem]);

  const markSelectedStatus = useCallback((status: DisputeItemStatus) => {
    selectedIds.forEach((id) => {
      const item = negativeItems.find((i) => i.id === id);
      if (!item) return;
      const nextRound: DisputeRound = status === "Undisputed" ? 1 : item.disputeRound;
      updateDisputeItemStatus(id, status, nextRound);
    });
    setSelectedIds(new Set());
  }, [selectedIds, negativeItems, updateDisputeItemStatus]);

  return (
    <div className="space-y-6">
      {/* Modal */}
      {modalOpen && (
        <ManualItemModal
          existing={editingItem}
          onSave={handleModalSave}
          onClose={() => { setModalOpen(false); setEditingItem(null); }}
        />
      )}

      {matchReview[0] && (() => {
        const candidate = matchReview[0];
        const left = negativeItems.find(item => item.id === candidate.leftId) ?? candidate.left;
        const right = negativeItems.find(item => item.id === candidate.rightId) ?? candidate.right;
        if (!left || !right) return null;
        const sideCards = [
          { item: left, label: 'Bureau A' },
          { item: right, label: 'Bureau B' },
        ];
        return (
          <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-3xl rounded-2xl border border-cyan-700 bg-zinc-950 p-5 shadow-2xl">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-bold text-cyan-300">Potential Cross-Bureau Match</h3>
                  <p className="text-xs text-zinc-500">
                    Match confidence {Math.round(candidate.confidence * 100)}% · {matchReview.length} candidate(s) remaining
                  </p>
                </div>
                <button onClick={() => setMatchReview([])} aria-label="Close account match review" className="text-zinc-500 hover:text-white"><X size={18} /></button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {sideCards.map(({ item, label }) => (
                  <div key={item.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-xs space-y-2">
                    <p className="text-[10px] font-mono uppercase tracking-wide text-cyan-500/80">{label}</p>
                    <div>
                      <span className="text-zinc-600 block">Creditor</span>
                      <span className="text-zinc-100 font-medium">{item.creditorName}</span>
                    </div>
                    <div>
                      <span className="text-zinc-600 block">Bureau</span>
                      <span className="text-zinc-300">{(item.creditBureau ?? []).join(', ') || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-zinc-600 block">Masked Account</span>
                      <span className="font-mono text-cyan-300">{item.fullAccountNumber || item.accountNumber || 'Unknown'}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-zinc-600 block">Balance</span>
                        <span className="text-zinc-200">${item.balance ?? item.originalBalance ?? 'Unknown'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-600 block">Opened / DOFD</span>
                        <span className="text-zinc-200">
                          {item.dateOpened || item.originalOpeningDate || item.dateOfFirstDelinquency || item.originalDateOfDelinquency || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="my-3 rounded-lg bg-cyan-950/30 border border-cyan-900 p-3 text-xs text-cyan-200 leading-relaxed">
                We found a potential cross-bureau match with lower certainty. Do you want to merge these accounts to maximize your account number recovery?
                {candidate.reasons.length > 0 && (
                  <p className="mt-2 text-cyan-300/70">{candidate.reasons.join(' ')}</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  onClick={() => resolveMatch(false)}
                  className="px-4 py-2 text-xs border border-red-800 rounded text-red-300 hover:bg-red-950/40"
                >
                  Keep Separate
                </button>
                <button
                  onClick={() => resolveMatch(true)}
                  className="px-4 py-2 text-xs border border-cyan-600 bg-cyan-900/40 rounded text-cyan-200 hover:bg-cyan-900/60"
                >
                  Confirm Merge
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <AlertTriangle className="text-red-400" /> NEGATIVE ITEMS
          </h2>
          <p className="text-zinc-400 font-mono text-xs mt-1">
            {negativeItems.length} DEROGATORY MARK(S) — SORTED BY PRIORITY
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={openAddModal}
            className="cyber-button text-xs border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 px-3 py-2 flex items-center gap-1.5"
          >
            <Plus size={13} /> ADD ITEM
          </button>
          <button
            onClick={handleSmartMerge}
            className="cyber-button text-xs border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-3 py-2 flex items-center gap-1.5"
          >
            <Link2 size={13} /> SMART MERGE ACCOUNTS
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search creditor..."
            className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs pl-7 pr-3 py-2 rounded w-44 focus:border-[#00ffff] outline-none" />
        </div>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
          title="Filter by negative item type"
          aria-label="Filter by type"
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
          <option value="All">All Types</option>
          {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
          title="Filter by dispute status"
          aria-label="Filter by status"
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
          <option value="All">All Statuses</option>
          {["Undisputed","Round1-Pending","Round1-Verified","Round2-Pending","Round2-Verified","Round3-Pending","Round3-Verified","Round4-Legal","Round4-Verified","Round5-CFPB","Round5-Verified","Round6-PreLit","Deleted","Won"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
          title="Sort negative items"
          aria-label="Sort by"
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-2 rounded focus:border-[#00ffff] outline-none cursor-pointer">
          <option value="priority">Sort: Priority</option>
          <option value="date">Sort: Date</option>
          <option value="status">Sort: Status</option>
        </select>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={toggleAll}
            className="flex items-center gap-1.5 text-[10px] font-mono text-zinc-500 hover:text-[#00ffff] transition-colors border border-zinc-800 px-2 py-1.5 rounded">
            {selectedIds.size === sorted.length && sorted.length > 0
              ? <CheckSquare2 size={13} className="text-[#00ffff]" />
              : <Square size={13} />}
            SELECT ALL
          </button>
          <span className="text-zinc-600 text-xs font-mono">{sorted.length} SHOWN</span>
        </div>
      </div>

      {/* Batch action bar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-[#00ffff]/5 border border-[#00ffff]/30 rounded-lg">
          <span className="text-xs font-bold font-mono text-[#00ffff]">{selectedIds.size} ITEM{selectedIds.size !== 1 ? "S" : ""} SELECTED</span>
          <div className="flex-1" />
          <button onClick={() => markSelectedStatus("Won")}
            className="cyber-button text-[10px] border-[#00ff00] text-[#00ff00] hover:bg-[#00ff00]/10 px-3 py-1.5 flex items-center gap-1">
            <CheckCircle2 size={11} /> MARK WON
          </button>
          <button onClick={() => markSelectedStatus("Deleted")}
            className="cyber-button text-[10px] border-[#00ff00]/50 text-[#00ff00]/70 hover:bg-[#00ff00]/10 px-3 py-1.5 flex items-center gap-1">
            <CheckCircle2 size={11} /> MARK DELETED
          </button>
          <button onClick={() => markSelectedStatus("Undisputed")}
            className="cyber-button text-[10px] border-zinc-600 text-zinc-400 hover:bg-zinc-800 px-3 py-1.5">
            RESET STATUS
          </button>
          <button onClick={deleteSelected}
            className="cyber-button text-[10px] border-red-500/50 text-red-400 hover:bg-red-500/10 px-3 py-1.5 flex items-center gap-1">
            <Trash2 size={11} /> DELETE ALL
          </button>
          <button onClick={() => setSelectedIds(new Set())} className="text-[10px] text-zinc-600 hover:text-zinc-400 px-2">✕ clear</button>
        </div>
      )}

      {/* Item list */}
      <div className="space-y-3">
        {sorted.length === 0 && (
          <div className="text-center py-16 text-zinc-700 text-sm">
            No negative items found. Upload a credit report to begin.
          </div>
        )}
        {sorted.map((item) => {
          const borderColor = TYPE_COLORS[item.typeOfNegative] || "border-l-zinc-600";
          const isExpanded = expandedId === item.id;
          const daysLeft = getDaysRemaining(item.disputeDeadline);
          const isOverdue = daysLeft !== null && daysLeft < 0;
          const daysUntilRemoval = getDaysUntilRemoval(item.autoRemovalDate);
          const removalOverdue = daysUntilRemoval !== null && daysUntilRemoval < 0;
          const deletionOdds = getDeletionOdds(item);

          return (
            <div key={item.id}
              className={`cyber-panel border-l-4 ${borderColor} p-0 overflow-hidden transition-all`}>
              {/* Main row */}
              <div className="p-4 flex items-center gap-3 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : item.id)}>
                {/* Checkbox */}
                <div onClick={(e) => toggleSelect(item.id, e)} className="shrink-0 text-zinc-600 hover:text-[#00ffff] transition-colors cursor-pointer">
                  {selectedIds.has(item.id)
                    ? <CheckSquare2 size={15} className="text-[#00ffff]" />
                    : <Square size={15} />}
                </div>
                {/* Priority badge */}
                <div className={`text-[10px] font-bold font-mono w-8 text-center ${PRIORITY_COLOR(item.priorityScore ?? 0)}`}>
                  {item.priorityScore ?? 0}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-white">{item.creditorName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${STATUS_BADGE[item.disputeStatus ?? ""] || "border-zinc-700 text-zinc-500"}`}>
                      {item.disputeStatus ?? "Undisputed"}
                    </span>
                    {item.crossBureauGroupId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#00ffff]/40 text-[#00ffff] font-mono">LINKED</span>
                    )}
                    {typeof item.parseConfidence === "number" && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${item.parseConfidence >= 0.8 ? "border-[#00ff00]/40 text-[#00ff00]" : item.parseConfidence >= 0.6 ? "border-[#ff9900]/40 text-[#ff9900]" : "border-red-500/40 text-red-400"}`}>
                        AI {Math.round(item.parseConfidence * 100)}%
                      </span>
                    )}
                    {item.accuracyConfirmedByUser && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-[#00ffff]/40 text-[#00ffff] font-mono">
                        CONFIRMED
                      </span>
                    )}
                    {(item.disputeStatus ?? "Undisputed") !== "Undisputed" && (
                      <span className="text-[10px] font-mono text-zinc-500">R{item.disputeRound ?? 1}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-1 text-[10px] font-mono text-zinc-500">
                    <span>{item.typeOfNegative ?? "Unknown"}</span>
                    {item.balance != null && <span>Balance: ${item.balance.toLocaleString()}</span>}
                    {item.dateOpened && <span>Opened: {item.dateOpened}</span>}
                    {daysLeft !== null && (
                      <span className={isOverdue ? "text-red-400" : daysLeft < 7 ? "text-[#ff9900]" : "text-zinc-500"}>
                        {isOverdue ? `⚡ OVERDUE ${Math.abs(daysLeft)}d` : `⏰ ${daysLeft}d left`}
                      </span>
                    )}
                  </div>
                </div>
                {/* Score impact */}
                <div className="text-right">
                  <div className={`text-[10px] font-mono ${deletionOdds.score >= 70 ? "text-[#00ff00]" : deletionOdds.score >= 45 ? "text-[#ff9900]" : "text-red-400"}`}>
                    DEL ODDS {deletionOdds.score}%
                  </div>
                  {item.estimatedScoreImpact ? (
                    <span className="text-[10px] text-[#00ff00] font-mono">{item.estimatedScoreImpact}</span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); estimateImpact(item); }}
                      disabled={impactLoading === item.id}
                      className="text-[10px] text-zinc-600 hover:text-[#00ff00] font-mono border border-zinc-800 px-2 py-1 rounded">
                      {impactLoading === item.id ? <RefreshCw size={10} className="animate-spin" /> : "~IMPACT"}
                    </button>
                  )}
                </div>
                {/* Bureaus */}
                <div className="flex gap-1">
                  {(item.creditBureau || []).map((b) => (
                    <span key={b} className="text-[9px] bg-zinc-900 border border-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">{b.slice(0, 2).toUpperCase()}</span>
                  ))}
                </div>
                {isExpanded ? <ChevronUp size={14} className="text-zinc-600" /> : <ChevronDown size={14} className="text-zinc-600" />}
              </div>

              {/* Dispute Progress Bar */}
              <DisputeProgressBar status={item.disputeStatus ?? "Undisputed"} />

              {/* Expanded panel */}
              {isExpanded && (
                <div className="border-t border-zinc-800 p-4 bg-[#0a0a0a] space-y-4">
                  {/* Account details */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="col-span-2 md:col-span-4 bg-[#00ffff]/5 border border-[#00ffff]/20 rounded p-2">
                      <div className="text-zinc-600">Deletion Probability Engine</div>
                      <div className="flex flex-wrap items-center gap-3 mt-0.5">
                        <span className={`font-bold font-mono ${deletionOdds.score >= 70 ? "text-[#00ff00]" : deletionOdds.score >= 45 ? "text-[#ff9900]" : "text-red-400"}`}>
                          {deletionOdds.score}% ({deletionOdds.confidenceBand})
                        </span>
                        {deletionOdds.actionHints.slice(0, 2).map((hint, idx) => (
                          <span key={`${item.id}-hint-${idx}`} className="text-[10px] text-zinc-400">
                            {hint}
                          </span>
                        ))}
                      </div>
                    </div>
                    {item.accountNumber && <div><span className="text-zinc-600">Account #</span><div className="text-white font-mono mt-0.5">****{item.accountNumber.slice(-4)}</div></div>}
                    {item.fullAccountNumber && <div><span className="text-zinc-600">Full Account # (AI)</span><div className="text-[#00ffff] font-mono mt-0.5 break-all">{item.fullAccountNumber}</div></div>}
                    {item.crossBureauGroupId && <div><span className="text-zinc-600">Cross-Bureau Group</span><div className="text-[#00ffff] font-mono mt-0.5">{item.crossBureauGroupId.slice(0, 8)}...</div></div>}
                    {item.originalCreditor && <div><span className="text-zinc-600">Original Creditor</span><div className="text-white mt-0.5">{item.originalCreditor}</div></div>}
                    {item.furnisher && item.furnisher !== item.creditorName && <div><span className="text-zinc-600">Furnisher</span><div className="text-white mt-0.5">{item.furnisher}</div></div>}
                    {item.accountType && <div><span className="text-zinc-600">Account Type</span><div className="text-white mt-0.5">{item.accountType}</div></div>}
                    {item.disputeContactPhone && <div><span className="text-zinc-600">Dispute Phone</span><div className="text-white font-mono mt-0.5">{item.disputeContactPhone}</div></div>}
                    {item.disputeContactAddress && <div className="col-span-2"><span className="text-zinc-600">Dispute Address</span><div className="text-white mt-0.5">{item.disputeContactAddress}</div></div>}
                    {item.balance != null && <div><span className="text-zinc-600">Current Balance</span><div className="text-white mt-0.5">${item.balance.toLocaleString()}</div></div>}
                    {item.originalBalance != null && <div><span className="text-zinc-600">Original Balance</span><div className="text-white mt-0.5">${item.originalBalance.toLocaleString()}</div></div>}
                    {item.creditLimit != null && <div><span className="text-zinc-600">Credit Limit</span><div className="text-white mt-0.5">${item.creditLimit.toLocaleString()}</div></div>}
                    {item.dateOpened && <div><span className="text-zinc-600">Date Opened</span><div className="text-white mt-0.5">{item.dateOpened}</div></div>}
                    {item.dateClosed && <div><span className="text-zinc-600">Date Closed</span><div className="text-white mt-0.5">{item.dateClosed}</div></div>}
                    {item.dateLastActive && <div><span className="text-zinc-600">Last Active</span><div className="text-white mt-0.5">{item.dateLastActive}</div></div>}
                    {item.originalDateOfDelinquency && <div><span className="text-zinc-600">First Delinquency (DOFD)</span><div className="text-[#ff9900] font-mono mt-0.5">{item.originalDateOfDelinquency}</div></div>}
                    {item.dateOfLastReporting && <div><span className="text-zinc-600">Last Reported</span><div className="text-white mt-0.5">{item.dateOfLastReporting}</div></div>}
                    {item.autoRemovalDate && (
                      <div className="col-span-2 bg-[#ff9900]/5 border border-[#ff9900]/20 rounded p-2">
                        <span className="text-zinc-600">Auto Removal Date (FCRA 7-yr rule)</span>
                        <div className={`font-bold font-mono mt-0.5 flex flex-wrap items-center gap-3 ${removalOverdue ? "text-[#00ff00]" : "text-[#ff9900]"}`}>
                          {item.autoRemovalDate}
                          {daysUntilRemoval !== null && (
                            <span className="text-[9px] font-normal opacity-80">
                              {removalOverdue
                                ? `⚡ ${Math.abs(daysUntilRemoval)} DAYS OVERDUE — bureau must delete, dispute immediately!`
                                : `${daysUntilRemoval} days remaining on report`}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="col-span-2 md:col-span-4 bg-[#00ffff]/5 border border-[#00ffff]/20 rounded p-2">
                      <span className="text-zinc-600">Manual Accuracy Confirmation</span>
                      <div className="text-white mt-0.5">
                        {item.accuracyConfirmedByUser ? "Confirmed by user" : "Not confirmed"}
                        {item.accuracyConfirmedAt && (
                          <span className="text-zinc-500 text-[10px] ml-2">({new Date(item.accuracyConfirmedAt).toLocaleString()})</span>
                        )}
                      </div>
                      {item.accuracyConfirmationNote && (
                        <div className="text-[10px] text-zinc-400 mt-1">{item.accuracyConfirmationNote}</div>
                      )}
                    </div>
                    {item.paymentHistory && (
                      <div className="col-span-2 md:col-span-4">
                        <span className="text-zinc-600">Payment History</span>
                        <div className="text-[#ff9900] font-mono mt-0.5">{item.paymentHistory}</div>
                      </div>
                    )}
                  </div>

                  {/* Notes thread */}
                  <div>
                    <div className="text-xs font-bold text-zinc-400 mb-2 flex items-center gap-1"><StickyNote size={12} /> NOTES</div>
                    <div className="space-y-2 mb-3 max-h-40 overflow-y-auto custom-scrollbar">
                      {(!item.notes || item.notes.length === 0) && (
                        <div className="text-[10px] text-zinc-700 italic">No notes yet.</div>
                      )}
                      {(item.notes || []).map((n) => (
                        <div key={n.id} className="bg-zinc-900 border border-zinc-800 rounded p-2">
                          <div className="text-[10px] text-zinc-300">{n.text}</div>
                          {n.certifiedMailTracking && (
                            <div className="text-[10px] text-[#ff9900] font-mono mt-1 flex items-center gap-1">
                              <Mail size={10} /> CERT TRACKING: {n.certifiedMailTracking}
                            </div>
                          )}
                          <div className="text-[9px] text-zinc-600 mt-1">{new Date(n.date).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                    {/* Add note */}
                    <div className="space-y-2">
                      <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)}
                        placeholder="Add a note about this item..."
                        className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs p-2 rounded h-16 resize-none focus:border-[#00ffff] outline-none" />
                      <div className="flex gap-2">
                        <input value={certTracking} onChange={(e) => setCertTracking(e.target.value)}
                          placeholder="USPS Cert. Tracking # (optional)"
                          className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-3 py-1.5 rounded focus:border-[#ff9900] outline-none" />
                        <button onClick={() => addNote(item)}
                          className="cyber-button text-xs border-[#00ffff] text-[#00ffff] hover:bg-[#00ffff]/10 px-3 py-1.5 flex items-center gap-1">
                          <Plus size={12} /> ADD
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800">
                    <button
                      onClick={() => updateNegativeItem(item.id, {
                        accuracyConfirmedByUser: !item.accuracyConfirmedByUser,
                        accuracyConfirmedAt: !item.accuracyConfirmedByUser ? new Date().toISOString() : null,
                        dataSource: item.dataSource || "manual",
                      })}
                      className={`text-xs border px-3 py-1.5 rounded flex items-center gap-1 ${
                        item.accuracyConfirmedByUser
                          ? "border-[#00ffff]/40 text-[#00ffff] hover:bg-[#00ffff]/10"
                          : "border-zinc-600 text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      <CheckCircle2 size={12} />
                      {item.accuracyConfirmedByUser ? "Confirmed" : "Confirm Accuracy"}
                    </button>
                    <button onClick={(e) => openEditModal(item, e)}
                      className="text-xs border border-[#00ffff]/30 text-[#00ffff] hover:bg-[#00ffff]/10 px-3 py-1.5 rounded flex items-center gap-1">
                      <Edit2 size={12} />Edit Item
                    </button>
                    <button onClick={() => removeNegativeItem(item.id)}
                      className="text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 px-3 py-1.5 rounded">
                      <Trash2 size={12} className="inline mr-1" />Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
