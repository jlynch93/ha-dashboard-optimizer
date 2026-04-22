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
  PLANNER_EXAMPLE_ASSISTANT,
  PLANNER_EXAMPLE_USER,
  PLANNER_SYSTEM_PROMPT,
  SINGLE_STREAM_SYSTEM_PROMPT,
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
  /**
   * Milliseconds to wait for the planner before giving up and using the
   * deterministic fallback plan. Defaults to 60s — slightly under Cloudflare's
   * 100s edge-timeout so the whole request doesn't 524.
   */
  plannerTimeoutMs?: number;
  /**
   * Ollama `keep_alive` value. Defaults to "30m". Keeping the model resident
   * drastically improves first-token latency on subsequent calls, which is
   * what otherwise causes Cloudflare-proxied Ollama hosts to 524.
   */
  keepAlive?: string;
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
const DEFAULT_PLANNER_TIMEOUT_MS = 60_000;
const DEFAULT_KEEP_ALIVE = "30m";

/**
 * Main entry point. Returns an async generator of events. Consumers forward
 * them over SSE.
 */
export async function* runParallelGeneration(
  opts: ParallelGenerateOptions,
): AsyncGenerator<OrchestratorEvent> {
  const endpoints = opts.endpoints.length > 0 ? opts.endpoints : ["http://localhost:11434"];
  const plannerOptions = { ...DEFAULT_PLANNER_OPTIONS, ...opts.plannerOptions };
  const plannerTimeoutMs = opts.plannerTimeoutMs ?? DEFAULT_PLANNER_TIMEOUT_MS;
  const keepAlive = opts.keepAlive ?? DEFAULT_KEEP_ALIVE;

  // ------- Phase 1: Planner -------------------------------------------------
  // The planner is the single biggest cause of Cloudflare 524s: if the model
  // is cold-loading from disk or just slow on the first token, no bytes reach
  // our edge for tens of seconds. Three defenses, in order:
  //
  //   a) Stream the planner and forward progress events, so the outer SSE
  //      pipe has steady activity the moment Ollama starts producing tokens.
  //   b) Race it against a `plannerTimeoutMs` (default 60s, below CF's 100s
  //      edge timeout). If it misses the deadline, abort the planner call and
  //      fall back to the deterministic domain-based plan so the run still
  //      completes.
  //   c) Pass `keep_alive: "30m"` so once the model is loaded, subsequent runs
  //      start emitting tokens in seconds instead of minutes.
  yield { event: "planner_start", data: {} };
  const plannerStartedAt = Date.now();

  const plannerController = new AbortController();
  const plannerSignal = AbortSignal.any([opts.signal, plannerController.signal]);
  let plannerTimedOut = false;
  const timeoutHandle = setTimeout(() => {
    plannerTimedOut = true;
    plannerController.abort();
  }, plannerTimeoutMs);

  let plan: ParallelPlan;
  let fallbackUsed = false;

  try {
    let raw = "";
    for await (const chunk of ollamaChatStream({
      endpoint: endpoints[0],
      model: opts.plannerModel,
      format: "json",
      options: plannerOptions,
      keepAlive,
      signal: plannerSignal,
      messages: [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        { role: "user", content: PLANNER_EXAMPLE_USER },
        { role: "assistant", content: PLANNER_EXAMPLE_ASSISTANT },
        { role: "user", content: buildPlannerUserPrompt(opts.summary) },
      ],
    })) {
      raw += chunk;
      // Surface liveness so the UI can show the planner is actually working.
      yield { event: "planner_progress", data: { chars: raw.length } };
    }
    plan = parsePlanOrFallback(raw, opts.summary);
  } catch (err) {
    clearTimeout(timeoutHandle);

    // If the outer caller cancelled, surface that immediately.
    if (opts.signal.aborted) {
      yield { event: "error", data: { message: "Cancelled", status: 499 } };
      return;
    }

    // Planner timed out — fall through to the deterministic fallback plan.
    if (plannerTimedOut) {
      yield {
        event: "planner_timeout",
        data: {
          elapsedMs: Date.now() - plannerStartedAt,
          reason: `Planner did not respond within ${(plannerTimeoutMs / 1000).toFixed(0)}s. Using heuristic plan instead.`,
        },
      };
      plan = buildFallbackPlan(opts.summary);
      fallbackUsed = true;
    } else if (err instanceof OllamaError) {
      // Genuine Ollama-side failure (not a timeout): abort — we can't reach it.
      yield { event: "error", data: { message: err.message, status: err.status } };
      return;
    } else {
      // Unknown failure parsing/reading planner — degrade gracefully.
      plan = buildFallbackPlan(opts.summary);
      fallbackUsed = true;
    }
  }
  clearTimeout(timeoutHandle);

  yield {
    event: "planner_done",
    data: {
      plan,
      elapsedMs: Date.now() - plannerStartedAt,
      ...(fallbackUsed ? { fallback: true } : {}),
    },
  };

  // ------- Phase 2: Single-stream generation --------------------------------
  // Send ONE streaming request to Ollama containing all view assignments from
  // the plan. This avoids multiple connections (which queue in Ollama and get
  // killed by Cloudflare's 100s timeout). Tokens flow from the first second,
  // the SSE pipe stays alive, and the model's KV cache stays warm across all
  // views within the same request.
  const entitiesById = indexEntitiesById(opts.summary);
  const endpoint = endpoints[0];
  const userPrompt = buildSingleStreamPrompt(plan, entitiesById);
  const genStartedAt = Date.now();

  // Mark all views as running — they'll complete as we detect boundaries.
  for (let i = 0; i < plan.views.length; i += 1) {
    yield {
      event: "view_start",
      data: {
        index: i,
        title: plan.views[i].title,
        icon: plan.views[i].icon,
        endpoint,
      },
    };
  }

  let fullOutput = "";
  try {
    for await (const chunk of ollamaChatStream({
      endpoint,
      model: opts.cardModel,
      options: { ...DEFAULT_CARD_OPTIONS, ...opts.cardOptions, num_predict: 4096 },
      keepAlive,
      signal: opts.signal,
      messages: [
        { role: "system", content: SINGLE_STREAM_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    })) {
      const prevViews = countViewBoundaries(fullOutput);
      fullOutput += chunk;
      const currViews = countViewBoundaries(fullOutput);

      // Emit chunk event for overall char tracking.
      yield { event: "view_chunk", data: { index: prevViews, content: chunk } };

      // Detect new `  - title:` boundaries → mark previous views as done.
      if (currViews > prevViews) {
        for (let v = prevViews; v < currViews && v < plan.views.length; v += 1) {
          if (v > 0) {
            yield {
              event: "view_done",
              data: { index: v - 1, yaml: "", elapsedMs: Date.now() - genStartedAt },
            };
          }
        }
      }
    }
  } catch (err) {
    if (opts.signal.aborted) {
      yield { event: "error", data: { message: "Cancelled", status: 499 } };
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    yield { event: "error", data: { message, status: 502 } };
    return;
  }

  // Mark last view as done.
  if (plan.views.length > 0) {
    yield {
      event: "view_done",
      data: {
        index: plan.views.length - 1,
        yaml: "",
        elapsedMs: Date.now() - genStartedAt,
      },
    };
  }

  // ------- Phase 3: Clean + validate ----------------------------------------
  const finalYaml = cleanSingleStreamOutput(fullOutput);

  if (!finalYaml) {
    yield {
      event: "error",
      data: { message: "Model produced no usable YAML.", status: 502 },
    };
    return;
  }

  const validation = validateLovelaceYaml(finalYaml);
  yield {
    event: "done",
    data: {
      optimizedYaml: finalYaml,
      explanation: `Fast: generated ${plan.views.length} views in a single streaming request (${((Date.now() - genStartedAt) / 1000).toFixed(1)}s).`,
      validation,
    },
  };
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
export function buildFallbackPlan(summary: HaSummary): ParallelPlan {
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

export function indexEntitiesById(summary: HaSummary): Map<string, HaEntity> {
  const map = new Map<string, HaEntity>();
  for (const group of summary.domains) {
    for (const e of group.entities) map.set(e.entity_id, e);
  }
  return map;
}

/**
 * Build a single user prompt that lists all views and their entities so the
 * model can generate the entire dashboard in one streaming response.
 */
function buildSingleStreamPrompt(
  plan: ParallelPlan,
  entitiesById: Map<string, HaEntity>,
): string {
  const sections = plan.views.map((view, i) => {
    const entityLines = view.entity_ids
      .map((id) => entitiesById.get(id))
      .filter((e): e is HaEntity => Boolean(e))
      .map((e) => {
        const bits = [`    ${e.entity_id} = "${e.friendly_name}" (${e.state})`];
        if (e.device_class) bits.push(`class:${e.device_class}`);
        if (e.unit) bits.push(`unit:${e.unit}`);
        return bits.join(" ");
      })
      .join("\n");
    return `View ${i + 1}: "${view.title}" (icon: ${view.icon}, path: ${view.path})\n  Entities:\n${entityLines || "    (none)"}`;
  });
  return `Generate a dashboard with these ${plan.views.length} views:\n\n${sections.join("\n\n")}`;
}

/**
 * Count how many `- title:` lines (at ≤4 spaces indent) appear in the
 * streamed output so far. Used to detect view boundaries on the fly.
 */
function countViewBoundaries(text: string): number {
  const matches = text.match(/^ {0,4}- title:/gm);
  return matches ? matches.length : 0;
}

/**
 * Clean the full single-stream model output into valid Lovelace YAML.
 * Strips code fences, leading prose, and ensures it starts with `views:`.
 */
function cleanSingleStreamOutput(raw: string): string | null {
  // Drop code fences.
  let text = raw.replace(/```(?:yaml|yml|YAML)?\s*\n?/g, "").replace(/```/g, "").trim();

  // If model wrapped output in prose, find the first `views:` line.
  const viewsIdx = text.indexOf("views:");
  if (viewsIdx > 0) {
    text = text.slice(viewsIdx);
  }

  // Truncate at trailing prose (lines starting with # or **).
  const lines = text.split("\n");
  const cleaned: string[] = [];
  let started = false;
  for (const line of lines) {
    if (!started && line.trim().startsWith("views:")) started = true;
    if (!started) continue;
    if (/^#{1,6}\s/.test(line) || /^\*\*/.test(line)) break;
    cleaned.push(line);
  }

  const result = cleaned.join("\n").trimEnd();
  if (!result || !result.startsWith("views:")) return null;
  return result + "\n";
}
