import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "warn" | "info";

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastCtx {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastCtx | undefined>(undefined);

function ToastIcon({ type }: { type: ToastType }) {
  if (type === "success") return <CheckCircle2 size={14} className="text-[#00ff00] shrink-0" />;
  if (type === "error") return <XCircle size={14} className="text-red-400 shrink-0" />;
  if (type === "warn") return <AlertTriangle size={14} className="text-[#ff9900] shrink-0" />;
  return <Info size={14} className="text-[#00ffff] shrink-0" />;
}

function ToastBorder({ type }: { type: ToastType }) {
  const colors: Record<ToastType, string> = {
    success: "border-[#00ff00]/50",
    error: "border-red-400/50",
    warn: "border-[#ff9900]/50",
    info: "border-[#00ffff]/50",
  };
  return colors[type];
}

function ToastItemComponent({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(item.id), 3500);
    return () => clearTimeout(t);
  }, [item.id, onDismiss]);

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded bg-[#1a1a1a] border ${ToastBorder({ type: item.type })} shadow-xl max-w-sm w-full font-mono text-xs text-zinc-200 animate-in`}
      style={{ animation: "slideInRight 0.2s ease-out" }}
    >
      <ToastIcon type={item.type} />
      <span className="flex-1 leading-snug">{item.message}</span>
      <button onClick={() => onDismiss(item.id)} className="text-zinc-600 hover:text-zinc-300">
        <X size={12} />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
        {toasts.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <ToastItemComponent item={item} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
