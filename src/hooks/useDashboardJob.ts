"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSse } from "@/lib/sse";
import type {
  ParallelPlan,
  ViewProgress,
  ViewStatus,
} from "@/lib/parallel-types";
import type { ExtractedYaml, HaSummary, YamlValidation } from "@/lib/types";

type Mode = "generate" | "generate-fast" | "optimize";

interface StartOptions {
  mode: Mode;
  ollamaUrl: string;
  model: string;
  yaml?: string;
  summary?: HaSummary | null;
  /** Additional Ollama endpoints to round-robin per-view calls across (Fast mode only). */
  extraEndpoints?: string[];
  /** Override planner model; defaults to `model` (Fast mode only). */
  plannerModel?: string;
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
  /** Per-view progress (Fast mode only). Empty for single-pass jobs. */
  views: ViewProgress[];
  /** The planner's view assignment (Fast mode only). */
  plan: ParallelPlan | null;
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
  const [views, setViews] = useState<ViewProgress[]>([]);
  const [plan, setPlan] = useState<ParallelPlan | null>(null);
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
    setViews([]);
    setPlan(null);
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

      const { endpoint, body } = buildRequest(options);

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
        let totalChars = 0;
        for await (const event of parseSse(res.body)) {
          switch (event.event) {
            case "chunk": {
              const { content } = JSON.parse(event.data) as { content: string };
              streamed += content;
              totalChars += content.length;
              setOutput(streamed);
              setStats((s) => ({ ...s, chars: totalChars }));
              break;
            }
            case "planner_start": {
              // No-op — UI shows the "planning" state via empty views list.
              break;
            }
            case "planner_progress": {
              // Live liveness indicator — total planner chars so far.
              const payload = JSON.parse(event.data) as { chars: number };
              setStats((s) => ({ ...s, chars: payload.chars }));
              break;
            }
            case "planner_timeout": {
              // Planner hit its deadline; the orchestrator will follow up with
              // a `planner_done` carrying a heuristic plan. Surface a toast-ish
              // explanation through `explanation` so the UI can show it.
              const payload = JSON.parse(event.data) as { reason: string };
              setExplanation(payload.reason);
              break;
            }
            case "planner_done": {
              const payload = JSON.parse(event.data) as {
                plan: ParallelPlan;
                fallback?: boolean;
              };
              setPlan(payload.plan);
              setViews(
                payload.plan.views.map((v, i) => ({
                  index: i,
                  title: v.title,
                  icon: v.icon,
                  status: "pending" as ViewStatus,
                  chars: 0,
                })),
              );
              if (payload.fallback) {
                setExplanation(
                  (prev) =>
                    prev ||
                    "Used heuristic plan (AI planner was too slow). View assignments are grouped by domain.",
                );
              }
              break;
            }
            case "view_start": {
              const payload = JSON.parse(event.data) as {
                index: number;
                title: string;
                icon: string;
                endpoint: string;
              };
              setViews((vs) =>
                vs.map((v) =>
                  v.index === payload.index
                    ? { ...v, status: "running", endpoint: payload.endpoint }
                    : v,
                ),
              );
              break;
            }
            case "view_chunk": {
              const payload = JSON.parse(event.data) as { index: number; content: string };
              totalChars += payload.content.length;
              setStats((s) => ({ ...s, chars: totalChars }));
              setViews((vs) =>
                vs.map((v) =>
                  v.index === payload.index
                    ? { ...v, chars: v.chars + payload.content.length }
                    : v,
                ),
              );
              break;
            }
            case "view_done": {
              const payload = JSON.parse(event.data) as {
                index: number;
                yaml: string;
                elapsedMs: number;
              };
              setViews((vs) =>
                vs.map((v) =>
                  v.index === payload.index
                    ? { ...v, status: "done", yaml: payload.yaml, elapsedMs: payload.elapsedMs }
                    : v,
                ),
              );
              break;
            }
            case "view_error": {
              const payload = JSON.parse(event.data) as { index: number; message: string };
              setViews((vs) =>
                vs.map((v) =>
                  v.index === payload.index
                    ? { ...v, status: "error", error: payload.message }
                    : v,
                ),
              );
              break;
            }
            case "done": {
              const payload = JSON.parse(event.data) as ExtractedYaml;
              setOutput(payload.optimizedYaml);
              setExplanation(payload.explanation);
              setValidation(payload.validation);
              setHasResult(true);
              setStats({
                elapsedMs: Date.now() - startedAtRef.current,
                chars: payload.optimizedYaml.length,
              });
              break;
            }
            case "error": {
              const payload = JSON.parse(event.data) as { message: string };
              throw new Error(payload.message);
            }
            default:
              // Ignore unknown events so future server-side additions don't crash the client.
              break;
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
    views,
    plan,
    start,
    cancel,
    reset,
  };
}

function buildRequest(
  options: StartOptions,
): { endpoint: string; body: Record<string, unknown> } {
  switch (options.mode) {
    case "generate":
      return {
        endpoint: "/api/generate-dashboard",
        body: {
          summary: options.summary,
          ollamaUrl: options.ollamaUrl,
          model: options.model,
        },
      };
    case "generate-fast":
      return {
        endpoint: "/api/generate-fast",
        body: {
          summary: options.summary,
          ollamaUrl: options.ollamaUrl,
          model: options.model,
          extraEndpoints: options.extraEndpoints,
          plannerModel: options.plannerModel,
        },
      };
    case "optimize":
      return {
        endpoint: "/api/optimize",
        body: {
          yaml: options.yaml,
          ollamaUrl: options.ollamaUrl,
          model: options.model,
        },
      };
  }
}
