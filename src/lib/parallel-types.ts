// Types specific to the parallel ("Fast") generation pipeline.
//
// The Fast pipeline decomposes dashboard generation into:
//   1. a small Planner LLM call that produces a view assignment
//   2. N parallel per-view LLM calls, optionally round-robined across
//      multiple discovered Ollama hosts
//   3. a deterministic stitcher that concatenates the view YAMLs into a
//      single `views:` document.

export interface PlanView {
  title: string;
  icon: string;
  path: string;
  /** Entity IDs the card-generation call is allowed to use. */
  entity_ids: string[];
}

export interface ParallelPlan {
  views: PlanView[];
}

export type ViewStatus = "pending" | "running" | "done" | "error";

export interface ViewProgress {
  index: number;
  title: string;
  icon: string;
  status: ViewStatus;
  chars: number;
  /** Final YAML for this view once `status === "done"`. */
  yaml?: string;
  error?: string;
  elapsedMs?: number;
  /** URL of the Ollama host that handled this view (for the progress UI). */
  endpoint?: string;
}

/** Events emitted by the orchestrator over SSE. Mirrors useDashboardJob. */
export type FastJobEvent =
  | { event: "planner_start"; data: Record<string, never> }
  | { event: "planner_done"; data: { plan: ParallelPlan; elapsedMs: number } }
  | { event: "view_start"; data: { index: number; title: string; icon: string; endpoint: string } }
  | { event: "view_chunk"; data: { index: number; content: string } }
  | {
      event: "view_done";
      data: { index: number; yaml: string; elapsedMs: number };
    }
  | {
      event: "view_error";
      data: { index: number; message: string };
    };
