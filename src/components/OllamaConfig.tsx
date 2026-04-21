"use client";

import type { RefObject } from "react";
import { RefreshCw } from "lucide-react";
import type { OllamaInstance } from "@/lib/types";

interface OllamaConfigProps {
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  model: string;
  setModel: (model: string) => void;
  availableModels: string[];
  discoveredInstances: OllamaInstance[];
  discovering: boolean;
  onDiscover: (options: { scanLan: boolean; includeCurrent: boolean }) => void;
  onSelectInstance: (instance: OllamaInstance) => void;
  firstInputRef?: RefObject<HTMLInputElement | null>;
}

export function OllamaConfig(props: OllamaConfigProps) {
  const {
    ollamaUrl,
    setOllamaUrl,
    model,
    setModel,
    availableModels,
    discoveredInstances,
    discovering,
    onDiscover,
    onSelectInstance,
    firstInputRef,
  } = props;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          Ollama Configuration
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onDiscover({ scanLan: false, includeCurrent: true })}
            disabled={discovering}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${discovering ? "animate-spin" : ""}`} />
            {discovering ? "Scanning..." : "Rescan Local"}
          </button>
          <button
            onClick={() => onDiscover({ scanLan: true, includeCurrent: true })}
            disabled={discovering}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
            title="Also probe common LAN IPs (slower)"
          >
            Scan LAN
          </button>
        </div>
      </div>

      {discoveredInstances.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Found Ollama instances:</p>
          <div className="flex flex-wrap gap-2">
            {discoveredInstances.map((instance) => (
              <button
                key={instance.url}
                onClick={() => onSelectInstance(instance)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  ollamaUrl === instance.url
                    ? "border-cyan-500 bg-cyan-500/10 text-cyan-300"
                    : "border-slate-600 hover:border-slate-500 text-slate-300"
                }`}
              >
                <span className="font-medium">{instance.label}</span>
                <span className="text-slate-500 ml-1">({instance.url})</span>
                <span className="text-slate-500 ml-1">
                  · {instance.models.length} model{instance.models.length !== 1 ? "s" : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm text-slate-400 mb-1">Ollama URL</label>
          <div className="flex gap-2">
            <input
              ref={firstInputRef}
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="http://your-server:11434"
            />
            <button
              onClick={() => onDiscover({ scanLan: false, includeCurrent: true })}
              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs transition-colors"
              title="Test this URL"
            >
              Test
            </button>
          </div>
        </div>
        <div>
          <label className="block text-sm text-slate-400 mb-1">Model</label>
          {availableModels.length > 0 ? (
            <select
              value={availableModels.includes(model) ? model : availableModels[0]}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              {availableModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="llama3, llama3:70b, etc."
            />
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">
        Tip: Enter your server&apos;s IP/hostname above and click Test, or use Scan LAN to probe common
        local addresses.
      </p>
    </div>
  );
}
