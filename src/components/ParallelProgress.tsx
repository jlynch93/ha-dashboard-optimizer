"use client";

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
} from "lucide-react";
import type { ParallelPlan, ViewProgress } from "@/lib/parallel-types";

interface ParallelProgressProps {
  views: ViewProgress[];
  plan: ParallelPlan | null;
  /** Overall job elapsed time in ms, used before any view starts. */
  elapsedMs: number;
  /** True while the SSE connection is still open. */
  loading: boolean;
}

/**
 * Visualizes the Fast (parallel) pipeline. Shown instead of the raw output
 * pane while a Fast job is in flight — the final stitched YAML still appears
 * in the existing output pane once `done` fires.
 */
export function ParallelProgress({
  views,
  plan,
  elapsedMs,
  loading,
}: ParallelProgressProps) {
  // Planner phase — no views yet.
  if (!plan || views.length === 0) {
    if (!loading) return null;
    return (
      <div className="p-6 bg-slate-900/50 border border-slate-700 rounded-xl flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-100">Planning views…</p>
          <p className="text-xs text-slate-400">
            Asking the model to group your entities. {(elapsedMs / 1000).toFixed(1)}s elapsed.
          </p>
        </div>
      </div>
    );
  }

  const done = views.filter((v) => v.status === "done").length;
  const errored = views.filter((v) => v.status === "error").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          {done}/{views.length} views complete{errored > 0 ? ` · ${errored} error${errored === 1 ? "" : "s"}` : ""}
        </span>
        <span className="tabular-nums">{(elapsedMs / 1000).toFixed(1)}s</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {views.map((view) => (
          <ViewCard key={view.index} view={view} />
        ))}
      </div>
    </div>
  );
}

function ViewCard({ view }: { view: ViewProgress }) {
  const { title, status, chars, elapsedMs, endpoint, error } = view;

  const colors = STATUS_STYLES[status];

  return (
    <div className={`p-3 rounded-xl border ${colors.bg} ${colors.border} transition-colors`}>
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 ${colors.icon}`}>{STATUS_ICON[status]}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-100 truncate">{title}</p>
            {status === "running" && (
              <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                {chars.toLocaleString()} chars
              </span>
            )}
            {status === "done" && typeof elapsedMs === "number" && (
              <span className="flex items-center gap-1 text-[11px] text-emerald-400 tabular-nums shrink-0">
                <Clock className="w-3 h-3" />
                {(elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          {endpoint && (
            <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={endpoint}>
              {prettyEndpoint(endpoint)}
            </p>
          )}
          {status === "error" && error && (
            <p className="text-[11px] text-rose-300 mt-1 break-words">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_ICON: Record<ViewProgress["status"], React.ReactNode> = {
  pending: <Clock className="w-4 h-4" />,
  running: <Loader2 className="w-4 h-4 animate-spin" />,
  done: <CheckCircle2 className="w-4 h-4" />,
  error: <AlertCircle className="w-4 h-4" />,
};

const STATUS_STYLES: Record<
  ViewProgress["status"],
  { bg: string; border: string; icon: string }
> = {
  pending: {
    bg: "bg-slate-900/40",
    border: "border-slate-700/70",
    icon: "text-slate-500",
  },
  running: {
    bg: "bg-cyan-500/5",
    border: "border-cyan-500/40",
    icon: "text-cyan-300",
  },
  done: {
    bg: "bg-emerald-500/5",
    border: "border-emerald-500/30",
    icon: "text-emerald-400",
  },
  error: {
    bg: "bg-rose-500/5",
    border: "border-rose-500/30",
    icon: "text-rose-400",
  },
};

function prettyEndpoint(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}
