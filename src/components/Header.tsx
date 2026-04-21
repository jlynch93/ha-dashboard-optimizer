"use client";

import { Cpu, Home as HomeIcon, Loader2, Settings, Sparkles } from "lucide-react";

interface HeaderProps {
  ollamaConnected: boolean;
  haConnected: boolean;
  discovering: boolean;
  onOpenSettings: () => void;
}

export function Header({
  ollamaConnected,
  haConnected,
  discovering,
  onOpenSettings,
}: HeaderProps) {
  // Show a notification dot on the settings gear if Ollama isn't reachable.
  const needsAttention = !ollamaConnected && !discovering;
  return (
    <header className="border-b border-slate-700/50 backdrop-blur-sm sticky top-0 z-10 bg-slate-900/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">HA Dashboard Optimizer</h1>
            <p className="text-xs text-slate-400">Powered by local Llama via Ollama</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill
            label="Ollama"
            icon={
              discovering ? (
                <Loader2 className="w-3.5 h-3.5 text-slate-300 animate-spin" />
              ) : (
                <Cpu className="w-3.5 h-3.5 text-slate-300" />
              )
            }
            tone={discovering ? "pending" : ollamaConnected ? "ok" : "err"}
            hint={discovering ? "Scanning..." : ollamaConnected ? "Connected" : "Not detected"}
          />
          <StatusPill
            label="Home Assistant"
            icon={<HomeIcon className="w-3.5 h-3.5 text-slate-300" />}
            tone={haConnected ? "ok" : "warn"}
            hint={haConnected ? "Connected" : "Not connected"}
          />
          <button
            onClick={onOpenSettings}
            className="relative p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            title="Settings"
            aria-label="Open settings"
          >
            <Settings className="w-5 h-5 text-slate-300" />
            {needsAttention && (
              <span
                aria-hidden
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-slate-900 animate-pulse"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}

type Tone = "ok" | "warn" | "err" | "pending";

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-emerald-400",
  warn: "bg-amber-400",
  err: "bg-rose-400",
  pending: "bg-slate-400 animate-pulse",
};

function StatusPill({
  label,
  icon,
  tone,
  hint,
}: {
  label: string;
  icon: React.ReactNode;
  tone: Tone;
  hint: string;
}) {
  return (
    <div
      className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/50 border border-slate-700"
      title={`${label}: ${hint}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {icon}
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}
