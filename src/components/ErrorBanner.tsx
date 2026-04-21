"use client";

import { useState } from "react";
import { AlertCircle, Check, Copy, X } from "lucide-react";

interface ErrorBannerProps {
  message: string;
  /** The model the user was targeting when the error happened. Used to build
   * a `ollama pull <model>` suggestion when we detect a missing-model error. */
  model?: string;
  onDismiss?: () => void;
}

export function ErrorBanner({ message, model, onDismiss }: ErrorBannerProps) {
  const pullCommand = detectPullSuggestion(message, model);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!pullCommand) return;
    try {
      await navigator.clipboard.writeText(pullCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore — clipboard unavailable.
    }
  };

  return (
    <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
      <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm text-red-300 break-words">{message}</p>
        {pullCommand && (
          <div className="flex items-center gap-2">
            <code className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-200 truncate">
              {pullCommand}
            </code>
            <button
              onClick={copy}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-slate-200 transition-colors shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" /> Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy
                </>
              )}
            </button>
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 text-red-300 hover:text-red-100 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function detectPullSuggestion(message: string, model?: string): string | null {
  // The server sends messages like:
  //   `Model not found on http://... Pull it first: ollama pull <model>`
  //   `Model "llama3" not found. Run: ollama pull llama3`
  // If either matches, surface a copyable command. Otherwise return null.
  if (!/not found/i.test(message)) return null;
  const explicit = message.match(/ollama pull\s+([^\s"']+)/i);
  if (explicit) return `ollama pull ${explicit[1]}`;
  if (model) return `ollama pull ${model}`;
  return null;
}
