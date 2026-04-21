"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";

export type ToastKind = "success" | "error" | "info";

export interface ToastOptions {
  title: string;
  description?: string;
  kind?: ToastKind;
  /** Milliseconds before auto-dismiss. `0` disables auto-dismiss. Default 4000. */
  durationMs?: number;
}

interface Toast extends Required<Omit<ToastOptions, "description">> {
  id: number;
  description?: string;
}

interface ToastContextValue {
  push: (options: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (options: ToastOptions) => {
      const id = ++idRef.current;
      const toast: Toast = {
        id,
        title: options.title,
        description: options.description,
        kind: options.kind ?? "info",
        durationMs: options.durationMs ?? 4000,
      };
      setToasts((ts) => [...ts, toast]);
      return id;
    },
    [],
  );

  const value = useMemo<ToastContextValue>(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[calc(100vw-2rem)] max-w-sm"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

const KIND_STYLES: Record<ToastKind, { bg: string; border: string; icon: React.ReactNode }> = {
  success: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/40",
    icon: <CheckCircle2 className="w-5 h-5 text-emerald-400" />,
  },
  error: {
    bg: "bg-red-500/10",
    border: "border-red-500/40",
    icon: <AlertCircle className="w-5 h-5 text-red-400" />,
  },
  info: {
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/40",
    icon: <Info className="w-5 h-5 text-cyan-400" />,
  },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { id, title, description, kind, durationMs } = toast;
  const [leaving, setLeaving] = useState(false);
  const styles = KIND_STYLES[kind];

  useEffect(() => {
    if (durationMs <= 0) return;
    const timer = setTimeout(() => setLeaving(true), durationMs);
    return () => clearTimeout(timer);
  }, [durationMs]);

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => onDismiss(id), 180);
    return () => clearTimeout(timer);
  }, [leaving, id, onDismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-3 p-3 rounded-xl border backdrop-blur-sm shadow-lg transition-all duration-200 ${styles.bg} ${styles.border} ${leaving ? "opacity-0 translate-x-2" : "opacity-100 translate-x-0"}`}
    >
      <div className="shrink-0 mt-0.5">{styles.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white break-words">{title}</p>
        {description && (
          <p className="text-xs text-slate-300 mt-0.5 break-words">{description}</p>
        )}
      </div>
      <button
        onClick={() => setLeaving(true)}
        className="shrink-0 text-slate-400 hover:text-white transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
