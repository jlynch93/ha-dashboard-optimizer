"use client";

import {
  CheckCircle2,
  ClipboardCheck,
  Home as HomeIcon,
  Loader2,
} from "lucide-react";
import type { HaSummary } from "@/lib/types";

interface AuditInputProps {
  haConnected: boolean;
  summary: HaSummary | null;
  loading: boolean;
  onAudit: () => void;
  onOpenSettings: () => void;
}

export function AuditInput(props: AuditInputProps) {
  const { haConnected, summary, loading, onAudit, onOpenSettings } = props;

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Audit Home Assistant</h2>
      </div>

      {!haConnected ? (
        <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center space-y-4">
          <HomeIcon className="w-12 h-12 mx-auto text-slate-500" />
          <div>
            <p className="text-sm text-slate-300 font-medium">Connect to Home Assistant</p>
            <p className="text-xs text-slate-500 mt-1">
              Open Settings to enter your HA URL and access token. The auditor
              will analyse every entity for naming issues, stale devices,
              duplicates, and clutter.
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
          </div>

          <p className="text-xs text-slate-400">
            The auditor checks for naming issues, stale/unavailable entities,
            duplicated names, missing area assignments, and dashboard clutter.
            No LLM required — runs instantly.
          </p>

          <button
            onClick={onAudit}
            disabled={loading}
            className="w-full py-3 px-6 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-400 hover:to-purple-500 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Auditing...
              </>
            ) : (
              <>
                <ClipboardCheck className="w-5 h-5" />
                Run Audit
              </>
            )}
          </button>
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
