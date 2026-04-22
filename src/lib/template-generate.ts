// Premium deterministic dashboard generator. Maps HA entity domains to the
// best Lovelace card types, uses section headers for visual grouping,
// severity-colored gauges, picture-glance for cameras, glance for binary
// sensors, button cards for scenes/scripts, and responsive horizontal-stack
// layouts — all with zero LLM calls.
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
// Card generation — the core layout engine
// ---------------------------------------------------------------------------

interface Card {
  type: string;
  [key: string]: unknown;
}

/**
 * Build an ordered, premium list of Lovelace cards for a set of entities.
 *
 * Layout hierarchy:
 *   1. Hero cards (weather, thermostat, camera, alarm) — big, visual, top
 *   2. Section: "Climate" — gauges in horizontal-stacks (severity colors)
 *   3. Section: "Controls" — lights, switches, fans, covers, locks, vacuums
 *   4. Section: "Media" — media-control cards
 *   5. Section: "Scenes & Scripts" — button cards in horizontal-stacks
 *   6. Section: "Status" — glance card for binary_sensors / persons
 *   7. Section: remaining entities in smart grouped entities cards
 */
function buildCardsForView(allEntities: HaEntity[]): Card[] {
  const cards: Card[] = [];
  // Track binary_sensors consumed by picture-glance overlays so we don't
  // duplicate them in the Status glance card.
  const cameraConsumed = new Set<string>();

  // Classify every entity into exactly one bucket.
  const buckets = classify(allEntities);

  // ── 1. Hero cards ────────────────────────────────────────────────────
  for (const e of buckets.weather) {
    cards.push({ type: "weather-forecast", entity: e.entity_id, show_forecast: true });
  }
  for (const e of buckets.climate) {
    cards.push({ type: "thermostat", entity: e.entity_id });
  }
  for (const e of buckets.camera) {
    cards.push(pictureGlanceCard(e, buckets.binarySensor, cameraConsumed));
  }
  for (const e of buckets.alarm) {
    cards.push({ type: "alarm-panel", entity: e.entity_id });
  }

  // ── 2. Gauges (with section header) ──────────────────────────────────
  if (buckets.gauge.length > 0) {
    cards.push(sectionHeader("Climate"));
    const gaugeCards = buckets.gauge.map(severityGauge);
    for (let i = 0; i < gaugeCards.length; i += 3) {
      const batch = gaugeCards.slice(i, i + 3);
      cards.push(batch.length === 1 ? batch[0] : { type: "horizontal-stack", cards: batch });
    }
  }

  // ── 3. Controls ──────────────────────────────────────────────────────
  const controlEntities = [
    ...buckets.light,
    ...buckets.switchEnt,
    ...buckets.fan,
    ...buckets.cover,
    ...buckets.lock,
    ...buckets.vacuum,
  ];
  if (controlEntities.length > 0) {
    cards.push(sectionHeader("Controls"));

    // Lights: individual cards if ≤ 3, entities card if more.
    if (buckets.light.length > 0 && buckets.light.length <= 3) {
      for (const e of buckets.light) {
        cards.push({ type: "light", entity: e.entity_id });
      }
    } else if (buckets.light.length > 0) {
      cards.push(stateColorEntities("Lights", buckets.light));
    }

    // Everything else as state-color entities cards, grouped by domain.
    const controlGroups: [string, HaEntity[]][] = [
      ["Switches", buckets.switchEnt],
      ["Fans", buckets.fan],
      ["Covers", buckets.cover],
      ["Locks", buckets.lock],
      ["Vacuums", buckets.vacuum],
    ];
    for (const [title, group] of controlGroups) {
      if (group.length > 0) {
        cards.push(stateColorEntities(title, group));
      }
    }
  }

  // ── 4. Media ─────────────────────────────────────────────────────────
  if (buckets.media.length > 0) {
    cards.push(sectionHeader("Media"));
    for (const e of buckets.media) {
      cards.push({ type: "media-control", entity: e.entity_id });
    }
  }

  // ── 5. Scenes, scripts & automations → button cards ──────────────────
  const actionEntities = [...buckets.scene, ...buckets.script, ...buckets.automation];
  if (actionEntities.length > 0) {
    cards.push(sectionHeader("Quick Actions"));
    const buttons = actionEntities.map(buttonCard);
    for (let i = 0; i < buttons.length; i += 4) {
      const batch = buttons.slice(i, i + 4);
      cards.push(batch.length === 1 ? batch[0] : { type: "horizontal-stack", cards: batch });
    }
  }

  // ── 6. Binary sensors & persons → glance card ────────────────────────
  const glanceEntities = [...buckets.binarySensor, ...buckets.person];
  // Only show binary_sensors not already consumed by a picture-glance camera.
  const unusedGlance = glanceEntities.filter((e) => !cameraConsumed.has(e.entity_id));
  if (unusedGlance.length > 0) {
    cards.push(sectionHeader("Status"));
    cards.push(glanceCard(unusedGlance));
  }

  // ── 7. Everything else → smart grouped entities cards ────────────────
  if (buckets.other.length > 0) {
    const groups = groupByAreaThenDomain(buckets.other);
    for (const group of groups) {
      cards.push(stateColorEntities(cardTitleForGroup(group), group));
    }
  }

  // Safety fallback.
  if (cards.length === 0) {
    cards.push({ type: "markdown", content: "No entities assigned to this view." });
  }

  return cards;
}

// ---------------------------------------------------------------------------
// Entity classification
// ---------------------------------------------------------------------------

interface EntityBuckets {
  weather: HaEntity[];
  climate: HaEntity[];
  camera: HaEntity[];
  alarm: HaEntity[];
  gauge: HaEntity[];
  light: HaEntity[];
  switchEnt: HaEntity[];
  fan: HaEntity[];
  cover: HaEntity[];
  lock: HaEntity[];
  vacuum: HaEntity[];
  media: HaEntity[];
  scene: HaEntity[];
  script: HaEntity[];
  automation: HaEntity[];
  binarySensor: HaEntity[];
  person: HaEntity[];
  other: HaEntity[];
}

function classify(entities: HaEntity[]): EntityBuckets {
  const b: EntityBuckets = {
    weather: [], climate: [], camera: [], alarm: [],
    gauge: [], light: [], switchEnt: [], fan: [], cover: [],
    lock: [], vacuum: [], media: [], scene: [], script: [],
    automation: [], binarySensor: [], person: [], other: [],
  };
  for (const e of entities) {
    const domain = e.entity_id.split(".")[0];
    switch (domain) {
      case "weather":        b.weather.push(e); break;
      case "climate":        b.climate.push(e); break;
      case "camera":         b.camera.push(e); break;
      case "alarm_control_panel": b.alarm.push(e); break;
      case "media_player":   b.media.push(e); break;
      case "light":          b.light.push(e); break;
      case "switch":         b.switchEnt.push(e); break;
      case "fan":            b.fan.push(e); break;
      case "cover":          b.cover.push(e); break;
      case "lock":           b.lock.push(e); break;
      case "vacuum":         b.vacuum.push(e); break;
      case "scene":          b.scene.push(e); break;
      case "script":         b.script.push(e); break;
      case "automation":     b.automation.push(e); break;
      case "binary_sensor":  b.binarySensor.push(e); break;
      case "person":
      case "device_tracker": b.person.push(e); break;
      case "sensor":
        if (isNumericState(e.state)) { b.gauge.push(e); }
        else { b.other.push(e); }
        break;
      default: b.other.push(e); break;
    }
  }
  return b;
}

// ---------------------------------------------------------------------------
// Card builders
// ---------------------------------------------------------------------------

/**
 * picture-glance for cameras. If any binary_sensors in the same view share
 * a name fragment with the camera (e.g. "front_door"), attach them as
 * overlay entities for a richer card.
 */
function pictureGlanceCard(camera: HaEntity, binarySensors: HaEntity[], consumed: Set<string>): Card {
  const camKey = camera.entity_id.split(".")[1];
  const overlays = binarySensors.filter((bs) => {
    const bsKey = bs.entity_id.split(".")[1];
    // Match if they share a significant name fragment (> 3 chars).
    return camKey.split("_").some((frag) => frag.length > 3 && bsKey.includes(frag));
  });
  for (const o of overlays) consumed.add(o.entity_id);

  const card: Card = {
    type: "picture-glance",
    camera_image: camera.entity_id,
    entities: overlays.length > 0
      ? overlays.map((o) => ({ entity: o.entity_id }))
      : [{ entity: camera.entity_id }],
  };
  return card;
}

/** Gauge with severity color thresholds based on device_class. */
function severityGauge(e: HaEntity): Card {
  const { min, max, severity } = gaugeMeta(e);
  const name = shortName(e);
  const card: Card = { type: "gauge", entity: e.entity_id, name, min, max };
  if (e.unit) card.unit = e.unit;
  if (severity) card.severity = severity;
  return card;
}

interface GaugeMeta {
  min: number;
  max: number;
  severity?: { green: number; yellow: number; red: number };
}

function gaugeMeta(e: HaEntity): GaugeMeta {
  const dc = e.device_class ?? "";
  const unit = (e.unit ?? "").toLowerCase();

  if (dc === "temperature" || unit.includes("°")) {
    const isF = unit.includes("f");
    return isF
      ? { min: 0, max: 120, severity: { green: 0, yellow: 72, red: 82 } }
      : { min: -10, max: 50, severity: { green: 0, yellow: 22, red: 28 } };
  }
  if (dc === "humidity") return { min: 0, max: 100, severity: { green: 0, yellow: 50, red: 70 } };
  if (dc === "battery") return { min: 0, max: 100, severity: { red: 0, yellow: 20, green: 50 } };
  if (dc === "power" || unit === "w") return { min: 0, max: 5000 };
  if (dc === "energy" || unit === "kwh") return { min: 0, max: 100 };
  if (dc === "voltage" || unit === "v") return { min: 0, max: 250 };
  if (dc === "illuminance" || unit === "lx") return { min: 0, max: 10000 };
  if (dc === "pressure" || unit === "hpa") return { min: 900, max: 1100 };

  // Generic percentage
  if (unit === "%") return { min: 0, max: 100, severity: { green: 0, yellow: 60, red: 85 } };

  // Infer from current value.
  const val = parseFloat(e.state);
  if (!isNaN(val)) {
    if (val >= 0 && val <= 1) return { min: 0, max: 1 };
    if (val >= 0 && val <= 100) return { min: 0, max: 100 };
    if (val > 100) return { min: 0, max: Math.ceil(val * 1.5 / 100) * 100 };
  }
  return { min: 0, max: 100 };
}

/** Button card for scenes, scripts, automations. */
function buttonCard(e: HaEntity): Card {
  const domain = e.entity_id.split(".")[0];
  const iconMap: Record<string, string> = {
    scene: "mdi:palette",
    script: "mdi:play",
    automation: "mdi:robot",
  };
  return {
    type: "button",
    entity: e.entity_id,
    name: shortName(e),
    icon: iconMap[domain] ?? "mdi:gesture-tap-button",
    tap_action: { action: "toggle" },
  };
}

/** Glance card for a compact row of binary_sensors / persons. */
function glanceCard(entities: HaEntity[]): Card {
  return {
    type: "glance",
    show_name: true,
    show_state: true,
    entities: entities.map((e) => ({
      entity: e.entity_id,
      name: shortName(e),
    })),
  };
}

/** Entities card with state_color: true for visual feedback. */
function stateColorEntities(title: string, entities: HaEntity[]): Card {
  return {
    type: "entities",
    title,
    state_color: true,
    entities: entities.map((e) => e.entity_id),
  };
}

/** Markdown section header card. */
function sectionHeader(title: string): Card {
  return { type: "markdown", content: `## ${title}` };
}

// ---------------------------------------------------------------------------
// Grouping & naming helpers
// ---------------------------------------------------------------------------

function cardTitleForGroup(entities: HaEntity[]): string {
  const areas = new Set(entities.map((e) => e.area).filter(Boolean));
  if (areas.size === 1) return [...areas][0]!;

  const domainCounts = new Map<string, number>();
  for (const e of entities) {
    const d = e.entity_id.split(".")[0];
    domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
  }
  let topDomain = "";
  let topCount = 0;
  for (const [d, c] of domainCounts) {
    if (c > topCount) { topDomain = d; topCount = c; }
  }
  return DOMAIN_LABEL[topDomain] ?? capitalize(topDomain.replace(/_/g, " "));
}

const DOMAIN_LABEL: Record<string, string> = {
  light: "Lights", switch: "Switches", binary_sensor: "Sensors",
  sensor: "Sensors", lock: "Locks", cover: "Covers", fan: "Fans",
  input_boolean: "Toggles", input_number: "Controls",
  input_select: "Selectors", input_text: "Inputs",
  automation: "Automations", script: "Scripts", scene: "Scenes",
  person: "People", device_tracker: "Trackers", vacuum: "Vacuums",
};

/**
 * Group entities by area, then by domain within large areas.
 * Max ~8 entities per card for readability.
 */
function groupByAreaThenDomain(entities: HaEntity[]): HaEntity[][] {
  const MAX = 8;
  const byArea = new Map<string, HaEntity[]>();
  for (const e of entities) {
    const key = e.area || "_other";
    let arr = byArea.get(key);
    if (!arr) { arr = []; byArea.set(key, arr); }
    arr.push(e);
  }
  const result: HaEntity[][] = [];
  for (const group of byArea.values()) {
    if (group.length <= MAX) {
      result.push(group);
    } else {
      const byDomain = new Map<string, HaEntity[]>();
      for (const e of group) {
        const d = e.entity_id.split(".")[0];
        let arr = byDomain.get(d);
        if (!arr) { arr = []; byDomain.set(d, arr); }
        arr.push(e);
      }
      for (const sub of byDomain.values()) {
        for (let i = 0; i < sub.length; i += MAX) result.push(sub.slice(i, i + MAX));
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

/** Produce a short, friendly display name from the entity. */
function shortName(e: HaEntity): string {
  // Use area-stripped friendly name if available, otherwise humanise the id.
  if (e.friendly_name) {
    // Strip area prefix if present (e.g. "Living Room Temperature" → "Temperature"
    // when area is "Living Room").
    if (e.area && e.friendly_name.startsWith(e.area)) {
      const stripped = e.friendly_name.slice(e.area.length).replace(/^[\s-]+/, "");
      if (stripped.length > 0) return stripped;
    }
    return e.friendly_name;
  }
  return capitalize(e.entity_id.split(".")[1].replace(/_/g, " "));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
