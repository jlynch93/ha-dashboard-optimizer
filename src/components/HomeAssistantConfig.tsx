"use client";

import { CheckCircle2, Home as HomeIcon, Loader2 } from "lucide-react";
import type { HaSummary } from "@/lib/types";

interface HomeAssistantConfigProps {
  haUrl: string;
  setHaUrl: (url: string) => void;
  haToken: string;
  setHaToken: (token: string) => void;
  connected: boolean;
  loading: boolean;
  summary: HaSummary | null;
  onConnect: () => void;
}

export function HomeAssistantConfig(props: HomeAssistantConfigProps) {
  const { haUrl, setHaUrl, haToken, setHaToken, connected, loading, summary, onConnect } = props;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && haUrl && haToken && !loading) {
      e.preventDefault();
      onConnect();
    }
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Home Assistant Connection
        </h3>
        {connected && (
          <span className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Connected
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Home Assistant URL</label>
          <input
            type="text"
            value={haUrl}
            onChange={(e) => setHaUrl(e.target.value)}
            onKeyDown={onKey}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="http://homeassistant.local:8123"
          />
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Long-Lived Access Token</label>
          <input
            type="password"
            value={haToken}
            onChange={(e) => setHaToken(e.target.value)}
            onKeyDown={onKey}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            placeholder="eyJ0eXAiOiJKV1Q..."
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Generate a token in HA: Profile → Long-Lived Access Tokens → Create Token. The token is
          kept in memory only and never persisted.
        </p>
        <button
          onClick={onConnect}
          disabled={loading || !haUrl || !haToken}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <HomeIcon className="w-4 h-4" />}
          {loading ? "Connecting..." : "Connect"}
        </button>
      </div>

      {summary && (
        <div className="p-3 bg-slate-900/50 border border-slate-700 rounded-lg space-y-2">
          <p className="text-sm font-medium text-slate-200">
            Connected to: <span className="text-cyan-400">{summary.location}</span>
          </p>
          <div className="flex flex-wrap gap-3 text-xs text-slate-400">
            <span>{summary.entity_count} entities</span>
            <span>{summary.domains.length} domains</span>
            <span>{summary.areas.length} areas</span>
          </div>
          {summary.areas.length > 0 && (
            <p className="text-xs text-slate-500">Areas: {summary.areas.join(", ")}</p>
          )}
          {summary.domains.some((d) => d.truncated) && (
            <p className="text-xs text-amber-400">
              Some domains have more than {summary.sample_limit} entities; only the first{" "}
              {summary.sample_limit} per domain will be sent to the model.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
