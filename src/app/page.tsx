"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorBanner } from "@/components/ErrorBanner";
import { GenerateInput } from "@/components/GenerateInput";
import { Header } from "@/components/Header";
import { ModeTabs, type Mode } from "@/components/ModeTabs";
import { OptimizeInput } from "@/components/OptimizeInput";
import { OutputPanel } from "@/components/OutputPanel";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { TipsSection } from "@/components/TipsSection";
import { useToast } from "@/components/Toaster";
import { useDashboardJob } from "@/hooks/useDashboardJob";
import { useHomeAssistant } from "@/hooks/useHomeAssistant";
import { useOllama } from "@/hooks/useOllama";

export default function Home() {
  const [mode, setMode] = useState<Mode>("generate");
  const [showSettings, setShowSettings] = useState(false);
  const [yamlInput, setYamlInput] = useState("");
  const [clientError, setClientError] = useState("");

  const ollama = useOllama();
  const ha = useHomeAssistant();
  const job = useDashboardJob();
  const toast = useToast();

  // Fire a one-time toast when Ollama discovery finishes and finds something.
  const discoveryNotified = useRef(false);
  useEffect(() => {
    if (!discoveryNotified.current && ollama.connected && !ollama.discovering) {
      discoveryNotified.current = true;
      toast.push({
        title: "Ollama detected",
        description: `${ollama.ollamaUrl} · ${ollama.availableModels.length} model${ollama.availableModels.length === 1 ? "" : "s"} available`,
        kind: "success",
        durationMs: 2500,
      });
    }
  }, [ollama.connected, ollama.discovering, ollama.ollamaUrl, ollama.availableModels.length, toast]);

  // Surface HA connection results as toasts.
  const lastHaStatus = useRef<"idle" | "connected">("idle");
  useEffect(() => {
    if (ha.connected && lastHaStatus.current !== "connected") {
      lastHaStatus.current = "connected";
      toast.push({
        title: "Connected to Home Assistant",
        description: `${ha.summary?.location} · ${ha.summary?.entity_count} entities`,
        kind: "success",
      });
    } else if (!ha.connected) {
      lastHaStatus.current = "idle";
    }
  }, [ha.connected, ha.summary, toast]);

  const handleGenerate = useCallback(async () => {
    if (!ha.summary) {
      setClientError("Connect to Home Assistant first to fetch your entities.");
      setShowSettings(true);
      return;
    }
    setClientError("");
    const result = await job.start({
      mode: "generate",
      ollamaUrl: ollama.ollamaUrl,
      model: ollama.model,
      summary: ha.summary,
    });
    if (result.ok) {
      toast.push({
        title: "Dashboard generated",
        description: `Finished in ${(job.stats.elapsedMs / 1000).toFixed(1)}s`,
        kind: "success",
      });
    } else if (result.aborted) {
      toast.push({ title: "Generation cancelled", kind: "info", durationMs: 2000 });
    }
  }, [ha.summary, ollama.ollamaUrl, ollama.model, job, toast]);

  const handleOptimize = useCallback(async () => {
    if (!yamlInput.trim()) {
      setClientError("Please provide your Home Assistant dashboard YAML first.");
      return;
    }
    setClientError("");
    const result = await job.start({
      mode: "optimize",
      ollamaUrl: ollama.ollamaUrl,
      model: ollama.model,
      yaml: yamlInput,
    });
    if (result.ok) {
      toast.push({
        title: "Dashboard optimized",
        description: `Finished in ${(job.stats.elapsedMs / 1000).toFixed(1)}s`,
        kind: "success",
      });
    } else if (result.aborted) {
      toast.push({ title: "Optimization cancelled", kind: "info", durationMs: 2000 });
    }
  }, [yamlInput, ollama.ollamaUrl, ollama.model, job, toast]);

  const cancelWithToast = useCallback(() => {
    job.cancel();
  }, [job]);

  const displayError = clientError || ha.error || job.error;
  const dismissError = () => {
    setClientError("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white font-[family-name:var(--font-geist-sans)]">
      <Header
        ollamaConnected={ollama.connected}
        haConnected={ha.connected}
        discovering={ollama.discovering}
        onOpenSettings={() => setShowSettings(true)}
      />

      <SettingsDrawer
        open={showSettings}
        onClose={() => setShowSettings(false)}
        ollamaUrl={ollama.ollamaUrl}
        setOllamaUrl={ollama.setOllamaUrl}
        model={ollama.model}
        setModel={ollama.setModel}
        availableModels={ollama.availableModels}
        discoveredInstances={ollama.discoveredInstances}
        discovering={ollama.discovering}
        onDiscover={(opts) => void ollama.discover(opts)}
        onSelectInstance={ollama.selectInstance}
        haUrl={ha.haUrl}
        setHaUrl={ha.setHaUrl}
        haToken={ha.haToken}
        setHaToken={ha.setHaToken}
        haConnected={ha.connected}
        haLoading={ha.loading}
        haSummary={ha.summary}
        onHaConnect={() => void ha.connect()}
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <ModeTabs mode={mode} onChange={setMode} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            {mode === "generate" ? (
              <GenerateInput
                haConnected={ha.connected}
                summary={ha.summary}
                ollamaConnected={ollama.connected}
                loading={job.loading}
                model={ollama.model}
                onGenerate={handleGenerate}
                onCancel={cancelWithToast}
                onOpenSettings={() => setShowSettings(true)}
              />
            ) : (
              <OptimizeInput
                yamlInput={yamlInput}
                setYamlInput={setYamlInput}
                loading={job.loading}
                model={ollama.model}
                ollamaConnected={ollama.connected}
                onOptimize={handleOptimize}
                onCancel={cancelWithToast}
                onFileError={setClientError}
              />
            )}

            {displayError && (
              <ErrorBanner
                message={displayError}
                model={ollama.model}
                onDismiss={dismissError}
              />
            )}

            <p className="text-xs text-slate-500 text-center">
              Tip: Press <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">Ctrl</kbd>+
              <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">Enter</kbd>{" "}
              to run · <kbd className="px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono">Esc</kbd>{" "}
              closes settings
            </p>
          </div>

          <OutputPanel
            mode={mode}
            output={job.output}
            explanation={job.explanation}
            validation={job.validation}
            loading={job.loading}
            stats={job.stats}
          />
        </div>

        <TipsSection />
      </main>
    </div>
  );
}
