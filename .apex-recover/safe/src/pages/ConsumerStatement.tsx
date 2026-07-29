import React, { useMemo, useState } from "react";
import { FilePenLine, Copy, Check } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import {
  CONSUMER_STATEMENT_WORD_LIMIT,
  countWords,
  draftConsumerStatement,
  isStatementEligible,
  validateConsumerStatement,
} from "../services/consumerStatementEngine";
import { PlatformService } from "../services/platformService";

export function ConsumerStatement() {
  const { negativeItems } = useAppContext();
  const [selectedId, setSelectedId] = useState<string>("");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);

  const candidates = useMemo(() => {
    return negativeItems.filter((item) => isStatementEligible(item).eligible);
  }, [negativeItems]);

  const selected = candidates.find((i) => i.id === selectedId) ?? candidates[0] ?? null;

  const loadDraft = (itemId: string) => {
    const item = negativeItems.find((i) => i.id === itemId);
    if (!item) return;
    setSelectedId(itemId);
    setDraft(draftConsumerStatement(item).draft);
    setCopied(false);
  };

  const validation = validateConsumerStatement(draft);
  const words = countWords(draft);

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      await PlatformService.saveFile("consumer-statement.txt", draft, "text/plain");
    }
  };

  const shareDraft = async () => {
    await PlatformService.shareText("Consumer Statement", draft);
  };

  return (
    <div className="space-y-6" role="main" aria-labelledby="statement-title">
      <div>
        <h2 id="statement-title" className="text-2xl font-bold text-white flex items-center gap-2">
          <FilePenLine className="text-[#ff9900]" aria-hidden /> CONSUMER STATEMENT
        </h2>
        <p className="text-zinc-400 font-mono text-xs mt-1">
          FCRA ≤{CONSUMER_STATEMENT_WORD_LIMIT}-WORD STATEMENT FOR VERIFIED / LATE-PASS ITEMS
        </p>
      </div>

      {candidates.length === 0 ? (
        <div className="cyber-panel p-8 text-center text-zinc-500 text-sm" role="status">
          No statement-eligible items yet. Eligibility typically opens after bureau verification or
          late Autopilot passes.
        </div>
      ) : (
        <>
          <div>
            <label htmlFor="statement-item" className="text-[10px] font-mono text-zinc-600 block mb-1">
              SELECT ITEM
            </label>
            <select
              id="statement-item"
              value={selected?.id ?? ""}
              onChange={(e) => loadDraft(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm px-3 py-2 rounded focus:border-[#00ffff] outline-none"
              aria-describedby="statement-help"
            >
              {candidates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.creditorName} — {item.disputeStatus || "Verified"}
                </option>
              ))}
            </select>
            <p id="statement-help" className="text-[10px] text-zinc-600 mt-1">
              {selected ? isStatementEligible(selected).reason : ""}
            </p>
          </div>

          {!draft && selected && (
            <button
              type="button"
              onClick={() => loadDraft(selected.id)}
              className="px-4 py-2 text-xs font-mono bg-zinc-800 border border-zinc-700 rounded text-white hover:border-[#ff9900]"
            >
              Generate draft
            </button>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="statement-draft" className="text-[10px] font-mono text-zinc-600">
                STATEMENT DRAFT
              </label>
              <span
                className={`text-[10px] font-mono ${words > CONSUMER_STATEMENT_WORD_LIMIT ? "text-red-400" : "text-zinc-500"}`}
                aria-live="polite"
              >
                {words}/{CONSUMER_STATEMENT_WORD_LIMIT} words
              </span>
            </div>
            <textarea
              id="statement-draft"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 text-sm px-3 py-2 rounded focus:border-[#ff9900] outline-none font-mono"
              aria-invalid={!validation.ok}
              aria-describedby="statement-issues"
            />
            <div id="statement-issues" className="mt-2 space-y-1" role="status">
              {validation.issues.map((issue) => (
                <p key={issue} className="text-xs text-red-400">
                  {issue}
                </p>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyDraft}
              disabled={!draft.trim()}
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-mono border border-zinc-700 rounded text-white hover:border-[#00ffff] disabled:opacity-40"
              aria-label="Copy consumer statement"
            >
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={shareDraft}
              disabled={!draft.trim() || !validation.ok}
              className="px-3 py-2 text-xs font-mono border border-zinc-700 rounded text-white hover:border-[#ff9900] disabled:opacity-40"
              aria-label="Share consumer statement"
            >
              Share
            </button>
          </div>

          <ul className="text-xs text-zinc-500 space-y-1 list-disc pl-5">
            {(selected ? draftConsumerStatement(selected).guidance : []).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
