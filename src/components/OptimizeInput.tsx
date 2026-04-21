"use client";

import { useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { FileText, Loader2, Sparkles, Square, Upload } from "lucide-react";
import { EXAMPLE_DASHBOARD_YAML } from "@/lib/example-yaml";

interface OptimizeInputProps {
  yamlInput: string;
  setYamlInput: (value: string) => void;
  loading: boolean;
  model: string;
  ollamaConnected: boolean;
  onOptimize: () => void;
  onCancel: () => void;
  onFileError: (message: string) => void;
}

export function OptimizeInput(props: OptimizeInputProps) {
  const {
    yamlInput,
    setYamlInput,
    loading,
    model,
    ollamaConnected,
    onOptimize,
    onCancel,
    onFileError,
  } = props;

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result;
        if (typeof text === "string") setYamlInput(text);
      };
      reader.onerror = () => onFileError("Could not read file");
      reader.readAsText(file);
    },
    [setYamlInput, onFileError],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!loading && yamlInput.trim() && ollamaConnected) onOptimize();
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/yaml": [".yaml", ".yml"], "text/plain": [".txt"] },
    multiple: false,
  });

  return (
    <>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">Your Dashboard YAML</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setYamlInput(EXAMPLE_DASHBOARD_YAML)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-300 transition-colors"
            title="Populate the textarea with a sample dashboard"
          >
            <FileText className="w-3.5 h-3.5" />
            Load example
          </button>
          <span className="text-xs text-slate-400 hidden sm:inline">Paste, drop, or try a sample</span>
        </div>
      </div>

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

      <textarea
        value={yamlInput}
        onChange={(e) => setYamlInput(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        placeholder={`views:\n  - title: Home\n    cards:\n      - type: weather-forecast\n        entity: weather.home\n      - type: entities\n        entities:\n          - light.living_room\n          - light.bedroom\n          - switch.fan\n      ...`}
        className="w-full h-72 px-4 py-3 bg-slate-900/50 border border-slate-700 rounded-xl text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none"
      />

      {loading ? (
        <button
          onClick={onCancel}
          className="w-full py-3 px-6 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20"
        >
          <Square className="w-5 h-5 fill-current" />
          Cancel optimization
        </button>
      ) : (
        <button
          onClick={onOptimize}
          disabled={!yamlInput.trim() || !ollamaConnected}
          className="w-full py-3 px-6 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:from-slate-600 disabled:to-slate-700 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/20"
        >
          <Sparkles className="w-5 h-5" />
          Optimize Dashboard
        </button>
      )}
      {loading && (
        <p className="text-xs text-slate-400 text-center flex items-center justify-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          Streaming from {model}...
        </p>
      )}
    </>
  );
}
