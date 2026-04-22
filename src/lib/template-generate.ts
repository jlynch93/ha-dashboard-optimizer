// Deterministic template-based dashboard generator. Maps HA entity domains to
// appropriate Lovelace card types, groups related entities, and produces valid
// dashboard YAML with zero LLM calls.
//
// Used by:
//   - Instant mode (standalone, sub-second)
//   - Fast mode fallback (when planner times out)

import yaml from "js-yaml";
import type { HaEntity, HaSummary } from "./types";
import type { ParallelPlan } from "./parallel-types";

// Re-export so callers don't need to import from parallel-generate.
export { buildFallbackPlan, indexEntitiesById } from "./parallel-generate";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TemplateResult {
  yaml: string;
  viewCount: number;
  cardCount: number;
}

/**
 * Generate a complete Lovelace `views:` YAML from a plan and entity data.
 * If no plan is provided, uses the heuristic fallback plan.
 */
export function generateFromTemplate(
  summary: HaSummary,
  plan: ParallelPlan,
): TemplateResult {
  const entitiesById = new Map<string, HaEntity>();
  for (const group of summary.domains) {
    for (const e of group.entities) entitiesById.set(e.entity_id, e);
  }

  let totalCards = 0;
  const views = plan.views.map((view) => {
    const entities = view.entity_ids
      .map((id) => entitiesById.get(id))
      .filter((e): e is HaEntity => Boolean(e));
    const cards = buildCardsForView(entities);
    totalCards += cards.length;
    return {
      title: view.title,
      path: view.path,
      icon: view.icon,
      cards,
    };
  });

  const out = yaml.dump({ views }, { lineWidth: -1, noRefs: true, quotingType: '"' });

  return { yaml: out, viewCount: views.length, cardCount: totalCards };
}

// ---------------------------------------------------------------------------
// Card generation
// ---------------------------------------------------------------------------

interface Card {
  type: string;
  [key: string]: unknown;
}

/**
 * Build an ordered list of Lovelace cards for a set of entities.
 * Strategy: standalone cards first (weather, climate, media, camera),
 * then gauges in horizontal stacks, then remaining entities grouped.
 */
function buildCardsForView(entities: HaEntity[]): Card[] {
  const cards: Card[] = [];

  const standalone: HaEntity[] = [];
  const gauges: HaEntity[] = [];
  const lights: HaEntity[] = [];
  const remaining: HaEntity[] = [];

  for (const e of entities) {
    const domain = e.entity_id.split(".")[0];
    if (STANDALONE_DOMAINS.has(domain)) {
      standalone.push(e);
    } else if (domain === "sensor" && isNumericState(e.state)) {
      gauges.push(e);
    } else if (domain === "light") {
      lights.push(e);
    } else {
      remaining.push(e);
    }
  }

  // 1. Standalone hero cards (weather, climate, media, camera, alarm)
  for (const e of standalone) {
    const card = standaloneCard(e);
    if (card) cards.push(card);
  }

  // 2. Gauges in horizontal stacks of 2-3
  if (gauges.length > 0) {
    const gaugeCards = gauges.map(gaugeCard);
    for (let i = 0; i < gaugeCards.length; i += 3) {
      const batch = gaugeCards.slice(i, i + 3);
      if (batch.length === 1) {
        cards.push(batch[0]);
      } else {
        cards.push({ type: "horizontal-stack", cards: batch });
      }
    }
  }

  // 3. Lights — individual light cards if ≤ 3, otherwise entities card
  if (lights.length > 0) {
    if (lights.length <= 3) {
      for (const e of lights) {
        cards.push({ type: "light", entity: e.entity_id });
      }
    } else {
      cards.push(entitiesCard(lights));
    }
  }

  // 4. Everything else grouped into entities cards by area, then by domain
  if (remaining.length > 0) {
    const groups = groupByAreaThenDomain(remaining);
    for (const group of groups) {
      cards.push(entitiesCard(group));
    }
  }

  // Safety: if nothing produced cards, emit at least one empty-state card.
  if (cards.length === 0) {
    cards.push({
      type: "markdown",
      content: "No entities assigned to this view.",
    });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Standalone card builders
// ---------------------------------------------------------------------------

const STANDALONE_DOMAINS = new Set([
  "weather",
  "climate",
  "media_player",
  "camera",
  "alarm_control_panel",
]);

function standaloneCard(e: HaEntity): Card | null {
  const domain = e.entity_id.split(".")[0];
  switch (domain) {
    case "weather":
      return { type: "weather-forecast", entity: e.entity_id, show_forecast: true };
    case "climate":
      return { type: "thermostat", entity: e.entity_id };
    case "media_player":
      return { type: "media-control", entity: e.entity_id };
    case "camera":
      return {
        type: "picture-entity",
        entity: e.entity_id,
        camera_image: e.entity_id,
      };
    case "alarm_control_panel":
      return { type: "alarm-panel", entity: e.entity_id };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Gauge card builder
// ---------------------------------------------------------------------------

function gaugeCard(e: HaEntity): Card {
  const { min, max } = gaugeRange(e);
  const card: Card = {
    type: "gauge",
    entity: e.entity_id,
    name: e.friendly_name,
    min,
    max,
  };
  if (e.unit) card.unit = e.unit;
  return card;
}

function gaugeRange(e: HaEntity): { min: number; max: number } {
  const dc = e.device_class ?? "";
  const unit = (e.unit ?? "").toLowerCase();

  if (dc === "temperature" || unit.includes("°")) {
    return unit.includes("f") ? { min: 0, max: 120 } : { min: -10, max: 50 };
  }
  if (dc === "humidity" || unit === "%") return { min: 0, max: 100 };
  if (dc === "battery") return { min: 0, max: 100 };
  if (dc === "power" || unit === "w") return { min: 0, max: 5000 };
  if (dc === "energy" || unit === "kwh") return { min: 0, max: 100 };
  if (dc === "voltage" || unit === "v") return { min: 0, max: 250 };
  if (dc === "illuminance" || unit === "lx") return { min: 0, max: 10000 };
  if (dc === "pressure" || unit === "hpa") return { min: 900, max: 1100 };

  // Attempt to infer from the current value.
  const val = parseFloat(e.state);
  if (!isNaN(val)) {
    if (val >= 0 && val <= 1) return { min: 0, max: 1 };
    if (val >= 0 && val <= 100) return { min: 0, max: 100 };
    if (val > 100) return { min: 0, max: Math.ceil(val * 1.5 / 100) * 100 };
  }

  return { min: 0, max: 100 };
}

// ---------------------------------------------------------------------------
// Entities card builder
// ---------------------------------------------------------------------------

function entitiesCard(entities: HaEntity[]): Card {
  return {
    type: "entities",
    title: cardTitleForGroup(entities),
    entities: entities.map((e) => e.entity_id),
  };
}

function cardTitleForGroup(entities: HaEntity[]): string {
  // If all entities share the same area, use the area name.
  const areas = new Set(entities.map((e) => e.area).filter(Boolean));
  if (areas.size === 1) return [...areas][0]!;

  // Otherwise use the most common domain.
  const domainCounts = new Map<string, number>();
  for (const e of entities) {
    const d = e.entity_id.split(".")[0];
    domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }
  let topDomain = "";
  let topCount = 0;
  for (const [d, c] of domainCounts) {
    if (c > topCount) {
      topDomain = d;
      topCount = c;
    }
  }
  return DOMAIN_LABEL[topDomain] ?? capitalize(topDomain.replace(/_/g, " "));
}

const DOMAIN_LABEL: Record<string, string> = {
  light: "Lights",
  switch: "Switches",
  binary_sensor: "Sensors",
  sensor: "Sensors",
  lock: "Locks",
  cover: "Covers",
  fan: "Fans",
  input_boolean: "Toggles",
  input_number: "Controls",
  input_select: "Selectors",
  input_text: "Inputs",
  automation: "Automations",
  script: "Scripts",
  scene: "Scenes",
  person: "People",
  device_tracker: "Trackers",
  vacuum: "Vacuums",
};

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

/**
 * Group entities first by area, then by domain within each area.
 * Produces reasonably-sized chunks for entities cards (max ~8 per card).
 */
function groupByAreaThenDomain(entities: HaEntity[]): HaEntity[][] {
  const MAX_PER_CARD = 8;

  // First pass: group by area (or "Other" if no area).
  const byArea = new Map<string, HaEntity[]>();
  for (const e of entities) {
    const key = e.area || "_other";
    let arr = byArea.get(key);
    if (!arr) {
      arr = [];
      byArea.set(key, arr);
    }
    arr.push(e);
  }

  const result: HaEntity[][] = [];
  for (const group of byArea.values()) {
    if (group.length <= MAX_PER_CARD) {
      result.push(group);
    } else {
      // Split large area groups by domain.
      const byDomain = new Map<string, HaEntity[]>();
      for (const e of group) {
        const d = e.entity_id.split(".")[0];
        let arr = byDomain.get(d);
        if (!arr) {
          arr = [];
          byDomain.set(d, arr);
        }
        arr.push(e);
      }
      for (const sub of byDomain.values()) {
        // Further split if still too large.
        for (let i = 0; i < sub.length; i += MAX_PER_CARD) {
          result.push(sub.slice(i, i + MAX_PER_CARD));
        }
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

function isNumericState(state: string): boolean {
  if (state === "unknown" || state === "unavailable") return false;
  return !isNaN(parseFloat(state)) && isFinite(Number(state));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
