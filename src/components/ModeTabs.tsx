"use client";

import { Sparkles, Zap } from "lucide-react";

export type Mode = "generate" | "optimize";

interface ModeTabsProps {
  mode: Mode;
  onChange: (mode: Mode) => void;
}

export function ModeTabs({ mode, onChange }: ModeTabsProps) {
  return (
    <div className="flex items-center gap-1 mb-6 p-1 bg-slate-800/50 border border-slate-700 rounded-xl w-fit">
      <TabButton active={mode === "generate"} onClick={() => onChange("generate")}>
        <Zap className="w-4 h-4" />
        Generate from HA
      </TabButton>
      <TabButton active={mode === "optimize"} onClick={() => onChange("optimize")}>
        <Sparkles className="w-4 h-4" />
        Optimize Existing
      </TabButton>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}
