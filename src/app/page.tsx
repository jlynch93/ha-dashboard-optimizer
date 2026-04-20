"use client";

import { useState, useCallback, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import {
  Upload,
  Sparkles,
  Copy,
  Download,
  Settings,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Wifi,
  WifiOff,
  Home as HomeIcon,
  Zap,
  RefreshCw,
} from "lucide-react";

interface OllamaInstance {
  url: string;
  models: string[];
  label: string;
}

interface HaSummary {
  location: string;
  entity_count: number;
  domains: Array<{ domain: string; count: number; entities: unknown[] }>;
  areas: string[];
}

export default function Home() {
  const [mode, setMode] = useState<"optimize" | "generate">("generate");
  const [yamlInput, setYamlInput] = useState("");
  const [optimizedYaml, setOptimizedYaml] = useState("");
  const [explanation, setExplanation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  // Ollama state
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [model, setModel] = useState("llama3");
  const [showSettings, setShowSettings] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredInstances, setDiscoveredInstances] = useState<OllamaInstance[]>([]);
  const [ollamaConnected, setOllamaConnected] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // Home Assistant state
  const [haUrl, setHaUrl] = useState("");
  const [haToken, setHaToken] = useState("");
  const [haConnected, setHaConnected] = useState(false);
  const [haLoading, setHaLoading] = useState(false);
  const [haSummary, setHaSummary] = useState<HaSummary | null>(null);

  // Auto-discover Ollama on mount
  useEffect(() => {
    discoverOllama();
  }, []);

  const discoverOllama = async (additionalUrls?: string[]) => {
    setDiscovering(true);
    try {
      const res = await fetch("/api/discover-ollama", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalUrls }),
      });
      const data = await res.json();
      if (data.instances && data.instances.length > 0) {
        setDiscoveredInstances(data.instances);
        // Auto-select the first found instance
        const first = data.instances[0];
        setOllamaUrl(first.url);
        setAvailableModels(first.models);
        setOllamaConnected(true);
        if (first.models.length > 0) {
          setModel(first.models[0]);
        }
      } else {
        setOllamaConnected(false);
      }
    } catch {
      setOllamaConnected(false);
    } finally {
      setDiscovering(false);
    }
  };

  const selectOllamaInstance = (instance: OllamaInstance) => {
    setOllamaUrl(instance.url);
    setAvailableModels(instance.models);
    setOllamaConnected(true);
    if (instance.models.length > 0) {
      setModel(instance.models[0]);
    }
  };

  const connectToHA = async () => {
    if (!haUrl || !haToken) {
      setError("Please provide both Home Assistant URL and access token.");
      return;
    }
    setHaLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ha-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ haUrl, haToken }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to connect to Home Assistant");
      }
      const data = await res.json();
      setHaSummary(data.summary);
      setHaConnected(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
      setHaConnected(false);
    } finally {
      setHaLoading(false);
    }
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        setYamlInput(text);
      };
      reader.readAsText(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/yaml": [".yaml", ".yml"], "text/plain": [".txt"] },
    multiple: false,
  });

  const handleOptimize = async () => {
    if (!yamlInput.trim()) {
      setError("Please provide your Home Assistant dashboard YAML first.");
      return;
    }

    setLoading(true);
    setError("");
    setOptimizedYaml("");
    setExplanation("");

    try {
      const res = await fetch("/api/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlInput, ollamaUrl, model }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to optimize dashboard");
      }

      const data = await res.json();
      setOptimizedYaml(data.optimizedYaml);
      setExplanation(data.explanation);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!haSummary) {
      setError("Connect to Home Assistant first to fetch your entities.");
      return;
    }

    setLoading(true);
    setError("");
    setOptimizedYaml("");
    setExplanation("");

    try {
      const res = await fetch("/api/generate-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: haSummary, ollamaUrl, model }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to generate dashboard");
      }

      const data = await res.json();
      setOptimizedYaml(data.optimizedYaml);
      setExplanation(data.explanation);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(optimizedYaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([optimizedYaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "optimized-dashboard.yaml";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white font-[family-name:var(--font-geist-sans)]">
      {/* Header */}
      <header className="border-b border-slate-700/50 backdrop-blur-sm sticky top-0 z-10 bg-slate-900/80">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-500 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">
                HA Dashboard Optimizer
              </h1>
              <p className="text-xs text-slate-400">
                Powered by local Llama via Ollama
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Ollama Status Indicator */}
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800/50 border border-slate-700">
              {ollamaConnected ? (
                <Wifi className="w-3.5 h-3.5 text-green-400" />
              ) : (
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
              )}
              <span className="text-xs text-slate-400">
                {discovering ? "Scanning..." : ollamaConnected ? "Ollama" : "Disconnected"}
              </span>
            </div>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
              title="Settings"
            >
              <Settings className="w-5 h-5 text-slate-300" />
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 space-y-4">
          {/* Ollama Configuration */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Ollama Configuration
              </h3>
              <button
                onClick={() => discoverOllama(ollamaUrl !== "http://localhost:11434" ? [ollamaUrl] : undefined)}
                disabled={discovering}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${discovering ? "animate-spin" : ""}`} />
                {discovering ? "Scanning..." : "Auto-Discover"}
              </button>
            </div>

            {/* Discovered Instances */}
            {discoveredInstances.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Found Ollama instances:</p>
                <div className="flex flex-wrap gap-2">
                  {discoveredInstances.map((instance) => (
                    <button
                      key={instance.url}
                      onClick={() => selectOllamaInstance(instance)}
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
                <label className="block text-sm text-slate-400 mb-1">
                  Ollama URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={ollamaUrl}
                    onChange={(e) => setOllamaUrl(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    placeholder="http://your-server:11434"
                  />
                  <button
                    onClick={() => discoverOllama([ollamaUrl])}
                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-xs transition-colors"
                    title="Test this URL"
                  >
                    Test
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Model
                </label>
                {availableModels.length > 0 ? (
                  <select
                    value={model}
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
              Tip: Enter your server&apos;s IP/hostname above and click Test, or use Auto-Discover to scan common addresses.
            </p>
          </div>

          {/* Home Assistant Configuration */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                Home Assistant Connection
              </h3>
              {haConnected && (
                <span className="flex items-center gap-1.5 text-xs text-green-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Connected
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Home Assistant URL
                </label>
                <input
                  type="text"
                  value={haUrl}
                  onChange={(e) => setHaUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="http://homeassistant.local:8123"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">
                  Long-Lived Access Token
                </label>
                <input
                  type="password"
                  value={haToken}
                  onChange={(e) => setHaToken(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  placeholder="eyJ0eXAiOiJKV1Q..."
                />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">
                Generate a token in HA: Profile → Long-Lived Access Tokens → Create Token
              </p>
              <button
                onClick={connectToHA}
                disabled={haLoading || !haUrl || !haToken}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                {haLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <HomeIcon className="w-4 h-4" />
                )}
                {haLoading ? "Connecting..." : "Connect"}
              </button>
            </div>

            {/* HA Summary */}
            {haSummary && (
              <div className="p-3 bg-slate-900/50 border border-slate-700 rounded-lg space-y-2">
                <p className="text-sm font-medium text-slate-200">
                  Connected to: <span className="text-cyan-400">{haSummary.location}</span>
                </p>
                <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                  <span>{haSummary.entity_count} entities</span>
                  <span>{haSummary.domains.length} domains</span>
                  <span>{haSummary.areas.length} areas</span>
                </div>
                {haSummary.areas.length > 0 && (
                  <p className="text-xs text-slate-500">
                    Areas: {haSummary.areas.join(", ")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Mode Tabs */}
        <div className="flex items-center gap-1 mb-6 p-1 bg-slate-800/50 border border-slate-700 rounded-xl w-fit">
          <button
            onClick={() => setMode("generate")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "generate"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Zap className="w-4 h-4" />
            Generate from HA
          </button>
          <button
            onClick={() => setMode("optimize")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "optimize"
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/30"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Optimize Existing
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="space-y-4">
            {mode === "generate" ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Generate Recommended Dashboard</h2>
                </div>

                {!haConnected ? (
                  <div className="border-2 border-dashed border-slate-600 rounded-xl p-8 text-center space-y-4">
                    <HomeIcon className="w-12 h-12 mx-auto text-slate-500" />
                    <div>
                      <p className="text-sm text-slate-300 font-medium">
                        Connect to Home Assistant
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        Open Settings above to enter your HA URL and access token.
                        We&apos;ll fetch all your entities and generate an optimal dashboard.
                      </p>
                    </div>
                    <button
                      onClick={() => setShowSettings(true)}
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
                          Connected to {haSummary?.location}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-2 bg-slate-900/50 rounded-lg text-center">
                          <p className="text-lg font-bold text-white">{haSummary?.entity_count}</p>
                          <p className="text-xs text-slate-400">Entities</p>
                        </div>
                        <div className="p-2 bg-slate-900/50 rounded-lg text-center">
                          <p className="text-lg font-bold text-white">{haSummary?.domains.length}</p>
                          <p className="text-xs text-slate-400">Domains</p>
                        </div>
                        <div className="p-2 bg-slate-900/50 rounded-lg text-center">
                          <p className="text-lg font-bold text-white">{haSummary?.areas.length}</p>
                          <p className="text-xs text-slate-400">Areas</p>
                        </div>
                      </div>
                      {haSummary && haSummary.domains.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {haSummary.domains.slice(0, 12).map((d) => (
                            <span
                              key={d.domain}
                              className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300"
                            >
                              {d.domain} ({d.count})
                            </span>
                          ))}
                          {haSummary.domains.length > 12 && (
                            <span className="px-2 py-0.5 text-xs text-slate-500">
                              +{haSummary.domains.length - 12} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <button
                      onClick={handleGenerate}
                      disabled={loading || !ollamaConnected}
                      className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" />
                          Generating with {model}...
                        </>
                      ) : (
                        <>
                          <Zap className="w-5 h-5" />
                          Generate Recommended Dashboard
                        </>
                      )}
                    </button>
                    {!ollamaConnected && (
                      <p className="text-xs text-amber-400 text-center">
                        Ollama not detected. Open Settings to configure your Ollama server.
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Your Dashboard YAML</h2>
                  <span className="text-xs text-slate-400">
                    Paste or drop your lovelace YAML
                  </span>
                </div>

                {/* Drop Zone */}
                <div
                  {...getRootProps()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    isDragActive
                      ? "border-cyan-400 bg-cyan-400/5"
                      : "border-slate-600 hover:border-slate-500 hover:bg-slate-800/30"
                  }`}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
                  <p className="text-sm text-slate-400">
                    {isDragActive
                      ? "Drop your YAML file here..."
                      : "Drag & drop a .yaml/.yml file, or click to browse"}
                  </p>
                </div>

                {/* Text Area */}
                <textarea
                  value={yamlInput}
                  onChange={(e) => setYamlInput(e.target.value)}
                  placeholder={`views:\n  - title: Home\n    cards:\n      - type: weather-forecast\n        entity: weather.home\n      - type: entities\n        entities:\n          - light.living_room\n          - light.bedroom\n          - switch.fan\n      ...`}
                  className="w-full h-72 px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
                />

                {/* Optimize Button */}
                <button
                  onClick={handleOptimize}
                  disabled={loading || !yamlInput.trim() || !ollamaConnected}
                  className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Optimizing with {model}...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Optimize Dashboard
                    </>
                  )}
                </button>
              </>
            )}

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}
          </div>

          {/* Output Panel */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {mode === "generate" ? "Recommended Dashboard" : "Optimized Dashboard"}
              </h2>
              {optimizedYaml && (
                <div className="flex items-center gap-2">
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
                </div>
              )}
            </div>

            {/* Explanation */}
            {explanation && (
              <div className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl">
                <h3 className="text-sm font-semibold text-cyan-400 mb-2">
                  {mode === "generate" ? "Dashboard Structure:" : "What was improved:"}
                </h3>
                <p className="text-sm text-slate-300 whitespace-pre-wrap">
                  {explanation}
                </p>
              </div>
            )}

            {/* Output YAML */}
            <div className="relative">
              <pre className="w-full h-[28rem] px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-sm font-mono text-slate-200 overflow-auto">
                {optimizedYaml || (
                  <span className="text-slate-600">
                    {loading
                      ? mode === "generate"
                        ? "Analyzing your entities and generating an optimal dashboard..."
                        : "Analyzing your dashboard and generating optimizations..."
                      : mode === "generate"
                        ? "Connect to HA and click Generate to create a recommended dashboard..."
                        : "Optimized YAML will appear here after processing..."}
                  </span>
                )}
              </pre>
            </div>
          </div>
        </div>

        {/* Tips Section */}
        <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              title: "Auto-Discovery",
              desc: "Automatically finds your Ollama server on the network and lists available models.",
            },
            {
              title: "HA Integration",
              desc: "Connects directly to Home Assistant to fetch all entities, areas, and devices.",
            },
            {
              title: "Smart Generation",
              desc: "Creates multi-view dashboards with optimal card types based on your actual entities.",
            },
          ].map((tip) => (
            <div
              key={tip.title}
              className="p-4 bg-slate-800/30 border border-slate-700/50 rounded-xl"
            >
              <h3 className="text-sm font-semibold text-cyan-400 mb-1">
                {tip.title}
              </h3>
              <p className="text-xs text-slate-400">{tip.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
