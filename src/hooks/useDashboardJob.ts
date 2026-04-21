"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSse } from "@/lib/sse";
import type { ExtractedYaml, HaSummary, YamlValidation } from "@/lib/types";

type Mode = "generate" | "optimize";

interface StartOptions {
  mode: Mode;
  ollamaUrl: string;
  model: string;
  yaml?: string;
  summary?: HaSummary | null;
}

export interface JobStats {
  /** Milliseconds since the request was initiated. Live-updated every 250ms. */
  elapsedMs: number;
  /** Total characters received from the model. */
  chars: number;
}

interface UseDashboardJobResult {
  loading: boolean;
  error: string;
  /** Text streamed so far (while running) or final extracted YAML (when done). */
  output: string;
  explanation: string;
  validation: YamlValidation | null;
  stats: JobStats;
  /** True when the most recent job produced useful output. */
  hasResult: boolean;
  start: (options: StartOptions) => Promise<{ ok: boolean; aborted: boolean; error?: string }>;
  cancel: () => void;
  reset: () => void;
}

export function useDashboardJob(): UseDashboardJobResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");
  const [explanation, setExplanation] = useState("");
  const [validation, setValidation] = useState<YamlValidation | null>(null);
  const [stats, setStats] = useState<JobStats>({ elapsedMs: 0, chars: 0 });
  const [hasResult, setHasResult] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef<number>(0);

  // Tick elapsed time while a job is running.
  useEffect(() => {
    if (!loading) return;
    const interval = setInterval(() => {
      setStats((s) => ({ ...s, elapsedMs: Date.now() - startedAtRef.current }));
    }, 250);
    return () => clearInterval(interval);
  }, [loading]);

  const reset = useCallback(() => {
    setOutput("");
    setExplanation("");
    setValidation(null);
    setError("");
    setStats({ elapsedMs: 0, chars: 0 });
    setHasResult(false);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const start = useCallback(
    async (options: StartOptions) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      reset();
      setLoading(true);
      startedAtRef.current = Date.now();

      const endpoint =
        options.mode === "generate" ? "/api/generate-dashboard" : "/api/optimize";
      const body =
        options.mode === "generate"
          ? { summary: options.summary, ollamaUrl: options.ollamaUrl, model: options.model }
          : { yaml: options.yaml, ollamaUrl: options.ollamaUrl, model: options.model };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (!res.body) throw new Error("Empty response from server");

        let streamed = "";
        for await (const event of parseSse(res.body)) {
          if (event.event === "chunk") {
            const { content } = JSON.parse(event.data) as { content: string };
            streamed += content;
            setOutput(streamed);
            setStats((s) => ({ ...s, chars: streamed.length }));
          } else if (event.event === "done") {
            const payload = JSON.parse(event.data) as ExtractedYaml;
            setOutput(payload.optimizedYaml);
            setExplanation(payload.explanation);
            setValidation(payload.validation);
            setHasResult(true);
            setStats({
              elapsedMs: Date.now() - startedAtRef.current,
              chars: payload.optimizedYaml.length,
            });
          } else if (event.event === "error") {
            const payload = JSON.parse(event.data) as { message: string };
            throw new Error(payload.message);
          }
        }
        return { ok: true, aborted: false };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { ok: false, aborted: true };
        }
        const message = err instanceof Error ? err.message : "An unexpected error occurred";
        setError(message);
        return { ok: false, aborted: false, error: message };
      } finally {
        setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [reset],
  );

  return {
    loading,
    error,
    output,
    explanation,
    validation,
    stats,
    hasResult,
    start,
    cancel,
    reset,
  };
}
