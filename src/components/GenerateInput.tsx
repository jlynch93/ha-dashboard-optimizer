"use client";

import { useEffect } from "react";
import {
  CheckCircle2,
  Home as HomeIcon,
  Loader2,
  Rocket,
  ShieldCheck,
  Square,
  Zap,
} from "lucide-react";
import type { HaSummary } from "@/lib/types";

export type GenerateStrategy = "instant" | "fast" | "quality";

interface GenerateInputProps {
  haConnected: boolean;
  summary: HaSummary | null;
  ollamaConnected: boolean;
  loading: boolean;
  model: string;
  strategy: GenerateStrategy;
  onStrategyChange: (strategy: GenerateStrategy) => void;
  /** How many Ollama hosts the Fast pipeline will fan out across. `1` means no fan-out. */
  hostCount: number;
  onGenerate: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
}

/** Installs a window-level Ctrl/Cmd+Enter shortcut that triggers generation. */
function useGenerateShortcut(active: boolean, fire: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        // Skip if the user is typing in a textarea/contenteditable.
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") return;
        e.preventDefault();
        fire();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, fire]);
}

export function GenerateInput(props: GenerateInputProps) {
  const {
    haConnected,
    summary,
    ollamaConnected,
    loading,
    model,
    strategy,
    onStrategyChange,
    hostCount,
    onGenerate,
    onCancel,
    onOpenSettings,
  } = props;

  const canGenerate = strategy === "instant"
    ? haConnected && !loading
    : haConnected && ollamaConnected && !loading;
  useGenerateShortcut(canGenerate, onGenerate);

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Generate Recommended Dashboard</h2>
      </div>

      {!haConnected ? (
        <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center space-y-4">
          <HomeIcon className="w-12 h-12 mx-auto text-slate-500" />
          <div>
            <p className="text-sm text-slate-300 font-medium">Connect to Home Assistant</p>
            <p className="text-xs text-slate-500 mt-1">
              Open Settings above to enter your HA URL and access token. We&apos;ll fetch all your
              entities and generate an optimal dashboard.
            </p>
          </div>
          <button
            onClick={onOpenSettings}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm transition-colors"
          >
            Open Settings
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-slate-800/50 border border-green-500/30 rounded-xl space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <span className="text-sm font-medium text-green-300">
                Connected to {summary?.location}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Entities" value={summary?.entity_count ?? 0} />
              <Stat label="Domains" value={summary?.domains.length ?? 0} />
              <Stat label="Areas" value={summary?.areas.length ?? 0} />
            </div>
            {summary && summary.domains.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {summary.domains.slice(0, 12).map((d) => (
                  <span
                    key={d.domain}
                    className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300"
                  >
                    {d.domain} ({d.count})
                  </span>
                ))}
                {summary.domains.length > 12 && (
                  <span className="px-2 py-0.5 text-xs text-slate-500">
                    +{summary.domains.length - 12} more
                  </span>
                )}
              </div>
            )}
          </div>

          <StrategyToggle
            strategy={strategy}
            onChange={onStrategyChange}
            disabled={loading}
            hostCount={hostCount}
          />

          {loading ? (
            <button
              onClick={onCancel}
              className="w-full py-3 px-6 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20"
            >
              <Square className="w-5 h-5 fill-current" />
              Cancel generation
            </button>
          ) : (
            <button
              onClick={onGenerate}
              disabled={!canGenerate}
              className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
            >
              {STRATEGY_META[strategy].btnIcon}
              {STRATEGY_META[strategy].btnLabel}
            </button>
          )}
          {loading && (
            <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              {strategy === "instant"
                ? "Generating from templates..."
                : strategy === "fast"
                  ? `Planning + streaming (${model})...`
                  : `Streaming from ${model}...`}
            </p>
          )}
          {!ollamaConnected && strategy !== "instant" && !loading && (
            <p className="text-xs text-amber-400 text-center">
              Ollama not detected. Open Settings to configure your Ollama server.
            </p>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-2 bg-slate-900/50 rounded-lg text-center">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

const STRATEGY_META: Record<
  GenerateStrategy,
  { icon: React.ReactNode; label: string; subtitle: string; btnIcon: React.ReactNode; btnLabel: string }
> = {
  instant: {
    icon: <Zap className="w-4 h-4" />,
    label: "Instant",
    subtitle: "Templates, no LLM",
    btnIcon: <Zap className="w-5 h-5" />,
    btnLabel: "Generate (Instant)",
  },
  fast: {
    icon: <Rocket className="w-4 h-4" />,
    label: "Fast",
    subtitle: "Plan + single stream",
    btnIcon: <Rocket className="w-5 h-5" />,
    btnLabel: "Generate (Fast)",
  },
  quality: {
    icon: <ShieldCheck className="w-4 h-4" />,
    label: "Quality",
    subtitle: "Full single-pass LLM",
    btnIcon: <ShieldCheck className="w-5 h-5" />,
    btnLabel: "Generate (Quality)",
  },
};

const STRATEGY_ORDER: GenerateStrategy[] = ["instant", "fast", "quality"];

function StrategyToggle({
  strategy,
  onChange,
  disabled,
}: {
  strategy: GenerateStrategy;
  onChange: (s: GenerateStrategy) => void;
  disabled: boolean;
  hostCount: number;
}) {
  return (
    <div className="p-1 bg-slate-900/60 border border-slate-700 rounded-xl">
      <div className="flex items-center gap-1">
        {STRATEGY_ORDER.map((s) => (
          <StrategyButton
            key={s}
            active={strategy === s}
            onClick={() => onChange(s)}
            disabled={disabled}
            icon={STRATEGY_META[s].icon}
            label={STRATEGY_META[s].label}
            subtitle={STRATEGY_META[s].subtitle}
          />
        ))}
      </div>
    </div>
  );
}

function StrategyButton({
  active,
  onClick,
  disabled,
  icon,
  label,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? "bg-cyan-500/15 text-cyan-100 border border-cyan-500/40"
          : "text-slate-400 hover:text-slate-200 border border-transparent"
      } disabled:opacity-60 disabled:cursor-not-allowed`}
      aria-pressed={active}
    >
      <span className={active ? "text-cyan-300" : "text-slate-400"}>{icon}</span>
      <span className="flex flex-col items-start leading-tight text-left">
        <span className="font-medium">{label}</span>
        <span className="text-[11px] text-slate-500">{subtitle}</span>
      </span>
    </button>
  );
}
