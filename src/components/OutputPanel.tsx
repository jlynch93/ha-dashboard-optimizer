"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, Loader2, WrapText } from "lucide-react";
import type { Mode } from "./ModeTabs";
import { useToast } from "./Toaster";
import { highlightYaml } from "@/lib/yaml-highlight";
import type { JobStats } from "@/hooks/useDashboardJob";
import type { YamlValidation } from "@/lib/types";

interface OutputPanelProps {
  mode: Mode;
  output: string;
  explanation: string;
  validation: YamlValidation | null;
  loading: boolean;
  stats: JobStats;
}

export function OutputPanel({
  mode,
  output,
  explanation,
  validation,
  loading,
  stats,
}: OutputPanelProps) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const toast = useToast();

  // Auto-scroll to bottom while streaming so the latest tokens stay visible.
  useEffect(() => {
    if (!loading || !preRef.current) return;
    const el = preRef.current;
    // Only auto-follow if the user is already near the bottom.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [output, loading]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.push({ title: "Copied to clipboard", kind: "success", durationMs: 2000 });
    } catch {
      toast.push({
        title: "Couldn't copy",
        description: "Clipboard access was denied.",
        kind: "error",
      });
    }
  };

  const handleDownload = () => {
    const filename =
      mode === "generate" ? "recommended-dashboard.yaml" : "optimized-dashboard.yaml";
    const blob = new Blob([output], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.push({ title: "Downloaded", description: filename, kind: "success", durationMs: 2200 });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">
          {mode === "generate" ? "Recommended Dashboard" : "Optimized Dashboard"}
        </h2>
        <div className="flex items-center gap-2">
          {loading && <StreamStats stats={stats} />}
          {validation && !loading && <ValidationBadge validation={validation} />}
          {output && (
            <>
              <button
                onClick={() => setWrap((w) => !w)}
                className={`p-2 rounded-lg transition-colors ${wrap ? "bg-slate-700/70 text-cyan-300" : "hover:bg-slate-700/50 text-slate-300"}`}
                title={wrap ? "Disable line wrap" : "Wrap long lines"}
                aria-pressed={wrap}
              >
                <WrapText className="w-4 h-4" />
              </button>
              <button
                onClick={handleCopy}
                className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                title="Copy to clipboard"
              >
                {copied ? (
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-300" />
                )}
              </button>
              <button
                onClick={handleDownload}
                className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
                title="Download YAML"
              >
                <Download className="w-4 h-4 text-slate-300" />
              </button>
            </>
          )}
        </div>
      </div>

      {explanation && (
        <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
          <h3 className="text-sm font-semibold text-cyan-400 mb-2">
            {mode === "generate" ? "Dashboard Structure:" : "What was improved:"}
          </h3>
          <p className="text-sm text-slate-300 whitespace-pre-wrap">{explanation}</p>
        </div>
      )}

      <div className="relative">
        <pre
          ref={preRef}
          className={`w-full h-[28rem] px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-sm font-mono text-slate-200 overflow-auto ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
        >
          {output ? highlightYaml(output) : <Placeholder mode={mode} loading={loading} />}
        </pre>
        {loading && output && (
          <span
            aria-hidden
            className="absolute bottom-3 right-4 inline-block w-2 h-4 bg-cyan-400 animate-pulse rounded-sm"
          />
        )}
      </div>
    </div>
  );
}

function StreamStats({ stats }: { stats: JobStats }) {
  const seconds = (stats.elapsedMs / 1000).toFixed(1);
  return (
    <span className="flex items-center gap-1 text-xs text-slate-400 tabular-nums">
      <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
      {seconds}s · {stats.chars.toLocaleString()} chars
    </span>
  );
}

function ValidationBadge({ validation }: { validation: YamlValidation }) {
  if (validation.valid) {
    return (
      <span className="flex items-center gap-1 text-xs text-green-400" title="Valid Lovelace YAML">
        <CheckCircle2 className="w-3.5 h-3.5" />
        {validation.view_count} view{validation.view_count === 1 ? "" : "s"} ·{" "}
        {validation.card_count} card{validation.card_count === 1 ? "" : "s"}
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1 text-xs text-amber-400"
      title={validation.error ?? "Invalid YAML"}
    >
      <AlertTriangle className="w-3.5 h-3.5" />
      Invalid YAML
    </span>
  );
}

function Placeholder({ mode, loading }: { mode: Mode; loading: boolean }) {
  const text = loading
    ? mode === "generate"
      ? "Analyzing your entities and generating an optimal dashboard..."
      : "Analyzing your dashboard and generating optimizations..."
    : mode === "generate"
      ? "Connect to HA and click Generate to create a recommended dashboard..."
      : "Optimized YAML will appear here after processing...";
  return <span className="text-slate-600">{text}</span>;
}
