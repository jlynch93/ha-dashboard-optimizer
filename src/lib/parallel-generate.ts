// Orchestrates a "Fast" (parallel) dashboard generation run:
//
//   1. Planner call: one small LLM call with `format: "json"` returning a
//      view assignment. We validate the JSON against the user's entities and
//      fall back to a deterministic domain-based plan if the model fails.
//
//   2. Fan-out: one streaming LLM call per view, round-robined across all
//      supplied endpoints. Partial token chunks are forwarded as events so
//      the UI can show live progress per view.
//
//   3. Stitch: concatenate all view YAMLs under a single `views:` key and
//      run it through the shared validator. The final event carries the
//      complete document plus validation.

import { buildEntityPrompt } from "./ha";
import { ollamaChatStream, OllamaError } from "./ollama";
import {
  CARD_EXAMPLE_ASSISTANT,
  CARD_EXAMPLE_USER,
  CARD_SYSTEM_PROMPT,
  PLANNER_EXAMPLE_ASSISTANT,
  PLANNER_EXAMPLE_USER,
  PLANNER_SYSTEM_PROMPT,
} from "./parallel-prompts";
import type {
  FastJobEvent,
  ParallelPlan,
  PlanView,
} from "./parallel-types";
import type { ExtractedYaml, HaEntity, HaSummary } from "./types";
import { validateLovelaceYaml } from "./yaml-validate";

export interface ParallelGenerateOptions {
  summary: HaSummary;
  /** One or more Ollama endpoints. Round-robined across per-view tasks. */
  endpoints: string[];
  /** Model used for the small JSON planner call. */
  plannerModel: string;
  /** Model used for per-view card generation. */
  cardModel: string;
  /** Cancellation signal, passed through to every LLM call. */
  signal: AbortSignal;
  /** Ollama `options` passed to per-view calls (temperature, num_predict, ...). */
  cardOptions?: Record<string, unknown>;
  /** Ollama `options` passed to the planner call. */
  plannerOptions?: Record<string, unknown>;
}

// Intermediate event shape emitted by the orchestrator — a subset of
// FastJobEvent plus the final terminal events shared with the non-parallel
// pipeline (chunk/done/error are handled by the route wrapper).
export type OrchestratorEvent =
  | FastJobEvent
  | { event: "done"; data: ExtractedYaml }
  | { event: "error"; data: { message: string; status: number } };

const DEFAULT_PLANNER_OPTIONS = { temperature: 0.1, num_predict: 2048 };
const DEFAULT_CARD_OPTIONS = { temperature: 0.2, num_predict: 2048 };

/**
 * Main entry point. Returns an async generator of events. Consumers forward
 * them over SSE.
 */
export async function* runParallelGeneration(
  opts: ParallelGenerateOptions,
): AsyncGenerator<OrchestratorEvent> {
  const endpoints = opts.endpoints.length > 0 ? opts.endpoints : ["http://localhost:11434"];
  const plannerOptions = { ...DEFAULT_PLANNER_OPTIONS, ...opts.plannerOptions };
  const cardOptions = { ...DEFAULT_CARD_OPTIONS, ...opts.cardOptions };

  // ------- Phase 1: Planner -------------------------------------------------
  yield { event: "planner_start", data: {} };
  const plannerStartedAt = Date.now();

  let plan: ParallelPlan;
  try {
    // Stream the planner call even though we only use the final text. This
    // keeps bytes flowing to Cloudflare (and any other reverse proxy) from
    // the first token onward — otherwise a slow planner response can exceed
    // the 100s edge read timeout and 524 before we ever see its output.
    let raw = "";
    for await (const chunk of ollamaChatStream({
      endpoint: endpoints[0],
      model: opts.plannerModel,
      format: "json",
      options: plannerOptions,
      signal: opts.signal,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: PLANNER_EXAMPLE_USER },
        { role: "assistant", content: PLANNER_EXAMPLE_ASSISTANT },
        { role: "user", content: buildPlannerUserPrompt(opts.summary) },
      ],
    })) {
      raw += chunk;
    }
    plan = parsePlanOrFallback(raw, opts.summary);
  } catch (err) {
    // Planner call failed entirely — use the fallback plan and keep going.
    if (err instanceof OllamaError) {
      // Fatal: without a reachable Ollama there's no way to generate cards.
      yield { event: "error", data: { message: err.message, status: err.status } };
      return;
    }
    plan = buildFallbackPlan(opts.summary);
  }

  yield {
    event: "planner_done",
    data: { plan, elapsedMs: Date.now() - plannerStartedAt },
  };

  // ------- Phase 2: Fan-out -------------------------------------------------
  const queue = createAsyncQueue<OrchestratorEvent>();
  const entitiesById = indexEntitiesById(opts.summary);

  const tasks = plan.views.map((view, index) => {
    const endpoint = endpoints[index % endpoints.length];
    return runViewTask({
      index,
      view,
      endpoint,
      entitiesById,
      model: opts.cardModel,
      cardOptions,
      signal: opts.signal,
      emit: (e) => queue.push(e),
    });
  });

  const allSettled = Promise.allSettled(tasks).finally(() => queue.close());

  // Drain events as they arrive.
  for await (const event of queue) {
    yield event;
  }
  const results = await allSettled;

  // ------- Phase 3: Stitch --------------------------------------------------
  const viewYamls: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < plan.views.length; i += 1) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      viewYamls.push(indentViewBlock(result.value));
    } else if (result.status === "fulfilled") {
      errors.push(`View "${plan.views[i].title}" produced no YAML.`);
    } else {
      errors.push(`View "${plan.views[i].title}" failed: ${describe(result.reason)}`);
    }
  }

  if (viewYamls.length === 0) {
    yield {
      event: "error",
      data: {
        message: `All per-view generations failed. ${errors.join(" ")}`.trim(),
        status: 502,
      },
    };
    return;
  }

  const finalYaml = `views:\n${viewYamls.join("\n")}\n`;
  const validation = validateLovelaceYaml(finalYaml);
  const summaryLine =
    errors.length > 0
      ? `${viewYamls.length} of ${plan.views.length} views generated. ${errors.join(" ")}`
      : `Generated ${plan.views.length} views in parallel.`;

  yield {
    event: "done",
    data: {
      optimizedYaml: finalYaml,
      explanation: summaryLine,
      validation,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-view task: streams tokens from Ollama, forwards chunks, returns the
// final collected YAML (or null on failure).
// ---------------------------------------------------------------------------

interface ViewTaskArgs {
  index: number;
  view: PlanView;
  endpoint: string;
  entitiesById: Map<string, HaEntity>;
  model: string;
  cardOptions: Record<string, unknown>;
  signal: AbortSignal;
  emit: (e: OrchestratorEvent) => void;
}

async function runViewTask(args: ViewTaskArgs): Promise<string | null> {
  const { index, view, endpoint, entitiesById, model, cardOptions, signal, emit } = args;
  const startedAt = Date.now();

  emit({
    event: "view_start",
    data: { index, title: view.title, icon: view.icon, endpoint },
  });

  const entityLines = view.entity_ids
    .map((id) => entitiesById.get(id))
    .filter((e): e is HaEntity => Boolean(e))
    .map((e) => {
      const bits = [`  ${e.entity_id} = "${e.friendly_name}" (${e.state})`];
      if (e.device_class) bits.push(`class:${e.device_class}`);
      if (e.unit) bits.push(`unit:${e.unit}`);
      return bits.join(" ");
    })
    .join("\n");

  const userPrompt = `View:
  title: ${view.title}
  path: ${view.path}
  icon: ${view.icon}

Entities:
${entityLines || "  (none — output a single entities card with a friendly empty state)"}`;

  try {
    let full = "";
    for await (const chunk of ollamaChatStream({
      endpoint,
      model,
      options: cardOptions,
      signal,
      messages: [
        { role: "system", content: CARD_SYSTEM_PROMPT },
        { role: "user", content: CARD_EXAMPLE_USER },
        { role: "assistant", content: CARD_EXAMPLE_ASSISTANT },
        { role: "user", content: userPrompt },
      ],
    })) {
      full += chunk;
      emit({ event: "view_chunk", data: { index, content: chunk } });
    }

    const cleaned = cleanViewYaml(full, view);
    emit({
      event: "view_done",
      data: { index, yaml: cleaned, elapsedMs: Date.now() - startedAt },
    });
    return cleaned;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      emit({ event: "view_error", data: { index, message: "Cancelled" } });
      return null;
    }
    const message = err instanceof Error ? err.message : String(err);
    emit({ event: "view_error", data: { index, message } });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Plan parsing + fallback
// ---------------------------------------------------------------------------

function parsePlanOrFallback(raw: string, summary: HaSummary): ParallelPlan {
  const entityIds = new Set(
    summary.domains.flatMap((d) => d.entities.map((e) => e.entity_id)),
  );

  // Try direct JSON parse first; then fall back to extracting the first {...}.
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        // Ignore — handled by fallback below.
      }
    }
  }

  if (parsed && typeof parsed === "object" && Array.isArray((parsed as ParallelPlan).views)) {
    const views = (parsed as ParallelPlan).views
      .map((v) => sanitizeView(v, entityIds))
      .filter((v): v is PlanView => v !== null);
    if (views.length > 0) return { views };
  }

  return buildFallbackPlan(summary);
}

function sanitizeView(v: Partial<PlanView>, entityIds: Set<string>): PlanView | null {
  if (!v || typeof v !== "object") return null;
  const title = typeof v.title === "string" && v.title.trim() ? v.title.trim() : null;
  if (!title) return null;
  const path =
    typeof v.path === "string" && v.path.trim()
      ? v.path.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-")
      : title.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const icon = typeof v.icon === "string" && v.icon.trim() ? v.icon.trim() : "mdi:view-dashboard";
  const ids = Array.isArray(v.entity_ids)
    ? v.entity_ids.filter((id): id is string => typeof id === "string" && entityIds.has(id))
    : [];
  if (ids.length === 0) return null;
  return { title, path, icon, entity_ids: ids };
}

/**
 * Deterministic plan based on entity domains. Used when the planner LLM fails
 * or produces an unparseable response.
 */
function buildFallbackPlan(summary: HaSummary): ParallelPlan {
  const byDomain = new Map<string, string[]>();
  for (const group of summary.domains) {
    byDomain.set(
      group.domain,
      group.entities.map((e) => e.entity_id),
    );
  }
  const take = (domains: string[]): string[] => {
    const out: string[] = [];
    for (const d of domains) {
      const ids = byDomain.get(d);
      if (ids) out.push(...ids);
    }
    return out;
  };

  const overview = take(["weather", "sensor", "climate", "media_player"]).slice(0, 10);
  const lights = take(["light", "switch"]);
  const security = take(["binary_sensor", "camera", "lock", "alarm_control_panel"]);
  const media = take(["media_player"]);

  const views: PlanView[] = [];
  if (overview.length > 0)
    views.push({ title: "Overview", path: "overview", icon: "mdi:home", entity_ids: overview });
  if (lights.length > 0)
    views.push({
      title: "Lights",
      path: "lights",
      icon: "mdi:lightbulb-group",
      entity_ids: lights,
    });
  if (security.length >= 2)
    views.push({
      title: "Security",
      path: "security",
      icon: "mdi:shield-home",
      entity_ids: security,
    });
  if (media.length > 0 && overview.length >= 10)
    views.push({ title: "Media", path: "media", icon: "mdi:play-circle", entity_ids: media });

  if (views.length === 0) {
    // Absolute last resort — one catch-all view.
    const all = summary.domains.flatMap((d) => d.entities.map((e) => e.entity_id)).slice(0, 30);
    views.push({ title: "Home", path: "home", icon: "mdi:home", entity_ids: all });
  }
  return { views };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildPlannerUserPrompt(summary: HaSummary): string {
  const areas = summary.areas.length > 0 ? summary.areas.join(", ") : "None configured";
  return `Location: ${summary.location}
Areas: ${areas}

Entities:
${buildEntityPrompt(summary)}`;
}

function indexEntitiesById(summary: HaSummary): Map<string, HaEntity> {
  const map = new Map<string, HaEntity>();
  for (const group of summary.domains) {
    for (const e of group.entities) map.set(e.entity_id, e);
  }
  return map;
}

/**
 * Clean a per-view response. The model sometimes wraps output in code fences
 * or adds prose around the YAML. Extract the first `- title:` block and strip
 * accordingly.
 */
function cleanViewYaml(raw: string, view: PlanView): string {
  // Drop code fences.
  const fenceStripped = raw.replace(/```(?:yaml|yml|YAML)?\s*\n?/g, "").replace(/```/g, "");
  // Find the first `- title:` line to slice from.
  const match = fenceStripped.match(/(^|\n)(\s*)- title:/);
  let sliced = match ? fenceStripped.slice(match.index! + (match[1] ? 1 : 0)) : fenceStripped;

  // Dedent so `- title:` sits at column 0. The stitcher re-indents.
  const leading = sliced.match(/^(\s*)-/);
  if (leading && leading[1].length > 0) {
    const dedent = new RegExp(`^${" ".repeat(leading[1].length)}`, "gm");
    sliced = sliced.replace(dedent, "");
  }

  // Stop at the first line that looks like prose (starts with # or *).
  const lines = sliced.split("\n");
  const cleaned: string[] = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) || /^\*\*/.test(line)) break;
    cleaned.push(line);
  }
  const out = cleaned.join("\n").trimEnd();

  // If the model completely failed to produce a `- title:` line, synthesize a
  // tiny stub so stitching doesn't explode.
  if (!out.startsWith("- title:")) {
    return `- title: ${view.title}\n  path: ${view.path}\n  icon: ${view.icon}\n  cards: []`;
  }
  return out;
}

/** Indent a dedented view block by 2 spaces so it nests under `views:`. */
function indentViewBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}

function describe(err: unknown): string {
  if (err instanceof OllamaError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Async event queue. Used to fan events from N parallel tasks into a single
// ordered consumer.
// ---------------------------------------------------------------------------

interface AsyncQueue<T> extends AsyncIterable<T> {
  push(value: T): void;
  close(): void;
}

function createAsyncQueue<T>(): AsyncQueue<T> {
  const buffer: T[] = [];
  let pending: ((result: IteratorResult<T>) => void) | null = null;
  let closed = false;

  return {
    push(value: T) {
      if (closed) return;
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ value, done: false });
      } else {
        buffer.push(value);
      }
    },
    close() {
      closed = true;
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ value: undefined as T, done: true });
      }
    },
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          if (buffer.length > 0) {
            return Promise.resolve({ value: buffer.shift()!, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined as T, done: true });
          }
          return new Promise<IteratorResult<T>>((resolve) => {
            pending = resolve;
          });
        },
      };
    },
  };
}
