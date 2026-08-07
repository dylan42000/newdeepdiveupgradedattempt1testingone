import React, { useEffect, useRef } from "react";
import { X, Bug, Copy } from "lucide-react";

interface DebugParsePanelProps {
  log: string[];
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Debug overlay (Ctrl+Shift+D) that displays the parser debug log from the
 * most recent credit report parse. Useful for diagnosing why accounts were
 * accepted, rejected, or skipped.
 */
export function DebugParsePanel({ log, isOpen, onClose }: DebugParsePanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [isOpen, log]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(log.join("\n")).catch(() => {});
  };

  const getLineColor = (line: string): string => {
    if (/\[ACR\]\s+Accepted|Accepted NEGATIVE/i.test(line)) return "text-green-400";
    if (/\[EQ\]\s+Accepted|EQ2\]\s+Accepted|EX\]\s+Accepted|TU\]\s+Accepted|TU-ACR\]\s+Accepted|LAB\]\s+Accepted|GEN\]\s+Accepted/i.test(line)) return "text-green-400";
    if (/Skipped|Rejected|Removed|FILTER/i.test(line)) return "text-red-400";
    if (/SECTION/i.test(line)) return "text-cyan-400";
    if (/DEDUP|Merged/i.test(line)) return "text-yellow-400";
    if (/Error|Failed|fail/i.test(line)) return "text-orange-400";
    if (/Starting|Complete|Found/i.test(line)) return "text-blue-300";
    return "text-zinc-400";
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-center pointer-events-none">
      <div
        className="pointer-events-auto w-full max-w-4xl mx-4 mb-4 rounded-xl border border-cyan-500/40 bg-zinc-950/98 shadow-2xl"
        style={{ maxHeight: "55vh" } as React.CSSProperties}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-700/60">
          <div className="flex items-center gap-2 text-cyan-400 font-mono text-xs font-bold">
            <Bug size={13} />
            PARSER DEBUG LOG — {log.length} entries — Ctrl+Shift+D to close
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded border border-zinc-700 hover:border-zinc-500 transition-colors"
            >
              <Copy size={10} /> Copy
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 transition-colors"
              aria-label="Close debug panel"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Log output */}
        <div ref={scrollRef} className="overflow-y-auto p-3 font-mono text-[10px] leading-relaxed space-y-0.5" style={{ maxHeight: "calc(55vh - 40px)" } as React.CSSProperties}>
          {log.length === 0 ? (
            <p className="text-zinc-600">No parse log available. Upload or paste a credit report to generate one.</p>
          ) : (
            log.map((line, i) => (
              <div key={i} className={`whitespace-pre-wrap break-all ${getLineColor(line)}`}>
                <span className="text-zinc-700 mr-2 select-none">{(i + 1).toString().padStart(4, "0")}</span>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
