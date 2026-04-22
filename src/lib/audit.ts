// Deterministic HA entity auditor. Analyses entity data and produces a
// structured report of naming issues, stale entities, duplicates,
// organization gaps, and dashboard clutter — all without LLM calls.

import type { HaEntity, HaSummary } from "./types";
import type { AuditFinding, AuditReport, AuditSeverity } from "./audit-types";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runAudit(summary: HaSummary): AuditReport {
  const start = Date.now();
  const entities = summary.domains.flatMap((d) => d.entities);
  const findings: AuditFinding[] = [];
  let nextId = 0;
  const emit = (
    f: Omit<AuditFinding, "id">,
  ) => findings.push({ ...f, id: `f${nextId++}` });

  // Run every check.
  checkStale(entities, emit);
  checkNaming(entities, emit);
  checkDuplicates(entities, emit);
  checkOrganization(entities, summary.areas, emit);
  checkClutter(entities, emit);

  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const infos = findings.filter((f) => f.severity === "info").length;

  return {
    entityCount: entities.length,
    errors,
    warnings,
    infos,
    findings,
    elapsedMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Emit = (f: Omit<AuditFinding, "id">) => void;

// ---------------------------------------------------------------------------
// 1. Stale entities — unavailable, unknown, or look like removed devices
// ---------------------------------------------------------------------------

function checkStale(entities: HaEntity[], emit: Emit) {
  for (const e of entities) {
    if (e.state === "unavailable") {
      emit({
        category: "stale",
        severity: "warning",
        entityId: e.entity_id,
        title: "Entity is unavailable",
        detail:
          `"${e.friendly_name}" (${e.entity_id}) has state "unavailable". ` +
          "This usually means the device is offline or the integration was removed.",
        suggestion: "Disable this entity",
        fix: { type: "disable" },
      });
    } else if (e.state === "unknown") {
      emit({
        category: "stale",
        severity: "info",
        entityId: e.entity_id,
        title: "Entity state is unknown",
        detail:
          `"${e.friendly_name}" (${e.entity_id}) has state "unknown". ` +
          "It may be initialising or the integration may have lost contact.",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Naming issues
// ---------------------------------------------------------------------------

const GENERIC_NAME_PATTERNS = [
  /^(binary )?sensor \d+$/i,
  /^switch \d+$/i,
  /^light \d+$/i,
  /^automation \d+$/i,
  /^input boolean \d+$/i,
];

function checkNaming(entities: HaEntity[], emit: Emit) {
  for (const e of entities) {
    const name = e.friendly_name ?? "";
    const id = e.entity_id;

    // No friendly name — using raw entity_id as display name.
    if (!name || name === id) {
      const suggested = humanize(id.split(".")[1]);
      emit({
        category: "naming",
        severity: "warning",
        entityId: id,
        title: "Missing friendly name",
        detail: `${id} has no friendly name set. It will display as the raw entity ID in the dashboard.`,
        suggestion: suggested,
        fix: { type: "rename", newName: suggested },
      });
      continue;
    }

    // Area prefix duplication: "Living Room Living Room Light"
    if (e.area && name.startsWith(e.area)) {
      const rest = name.slice(e.area.length).trimStart();
      if (rest.toLowerCase().startsWith(e.area.toLowerCase())) {
        const suggested = (`${e.area} ${rest.slice(e.area.length).trimStart()}`.trim()) || rest;
        emit({
          category: "naming",
          severity: "info",
          entityId: id,
          title: "Duplicated area prefix in name",
          detail: `"${name}" repeats the area "${e.area}" in the friendly name.`,
          suggestion: suggested,
          fix: { type: "rename", newName: suggested },
        });
      }
    }

    // Generic default name ("Sensor 1", "Switch 2").
    if (GENERIC_NAME_PATTERNS.some((p) => p.test(name))) {
      const suggested = humanize(id.split(".")[1]);
      emit({
        category: "naming",
        severity: "warning",
        entityId: id,
        title: "Generic default name",
        detail: `"${name}" looks like an auto-generated default. A descriptive name helps identify it on your dashboard.`,
        suggestion: suggested,
        fix: { type: "rename", newName: suggested },
      });
    }

    // Very long name.
    if (name.length > 40) {
      const suggested = shortenName(name, e.area);
      emit({
        category: "naming",
        severity: "info",
        entityId: id,
        title: "Very long friendly name",
        detail: `"${name}" is ${name.length} characters. Names over 40 chars get truncated on cards and cause layout issues.`,
        suggestion: suggested,
        fix: { type: "rename", newName: suggested },
      });
    }

    // Name contains underscores (probably auto-generated from entity_id).
    if (name.includes("_") && !name.includes("°")) {
      const suggested = name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      emit({
        category: "naming",
        severity: "info",
        entityId: id,
        title: "Name contains underscores",
        detail: `"${name}" has underscores, suggesting it was auto-derived from the entity_id rather than intentionally named.`,
        suggestion: suggested,
        fix: { type: "rename", newName: suggested },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Duplicates — entities with identical friendly names
// ---------------------------------------------------------------------------

function checkDuplicates(entities: HaEntity[], emit: Emit) {
  const byName = new Map<string, HaEntity[]>();
  for (const e of entities) {
    const key = (e.friendly_name ?? e.entity_id).toLowerCase().trim();
    let arr = byName.get(key);
    if (!arr) {
      arr = [];
      byName.set(key, arr);
    }
    arr.push(e);
  }

  for (const [, group] of byName) {
    if (group.length < 2) continue;
    // Skip groups where all entities are in different domains (common: sensor + binary_sensor for same device).
    const domains = new Set(group.map((e) => e.entity_id.split(".")[0]));
    const severity: AuditSeverity = domains.size < group.length ? "warning" : "info";
    const ids = group.map((e) => e.entity_id);
    emit({
      category: "duplicate",
      severity,
      entityId: ids[0],
      title: `${group.length} entities named "${group[0].friendly_name}"`,
      detail:
        `These entities share the same friendly name: ${ids.join(", ")}. ` +
        "This makes them hard to tell apart on dashboards and in automations.",
      suggestion:
        "Add a qualifier to each name (e.g. area, device, or measurement type) to make them unique.",
    });
  }
}

// ---------------------------------------------------------------------------
// 4. Organization — entities without areas
// ---------------------------------------------------------------------------

function checkOrganization(entities: HaEntity[], areas: string[], emit: Emit) {
  const noArea = entities.filter((e) => !e.area);
  // Only flag if the user HAS areas configured (otherwise it's intentional).
  if (areas.length === 0 || noArea.length === 0) return;

  // Don't flag domains that typically don't get areas.
  const SKIP_DOMAINS = new Set([
    "weather", "sun", "zone", "persistent_notification", "update",
    "person", "device_tracker", "input_boolean", "input_number",
    "input_select", "input_text", "automation", "script", "scene",
  ]);

  const flaggable = noArea.filter(
    (e) => !SKIP_DOMAINS.has(e.entity_id.split(".")[0]),
  );

  if (flaggable.length === 0) return;

  // Batch into one finding if > 10, otherwise individual.
  if (flaggable.length > 10) {
    const sample = flaggable.slice(0, 5).map((e) => e.entity_id).join(", ");
    emit({
      category: "organization",
      severity: "info",
      title: `${flaggable.length} entities have no area assigned`,
      detail:
        `You have ${areas.length} areas configured, but ${flaggable.length} entities aren't assigned to any. ` +
        `Examples: ${sample}${flaggable.length > 5 ? ", ..." : ""}.`,
      suggestion:
        "Assign devices to areas in HA → Settings → Devices. Entities inherit the area from their device.",
    });
  } else {
    for (const e of flaggable) {
      emit({
        category: "organization",
        severity: "info",
        entityId: e.entity_id,
        title: "No area assigned",
        detail: `"${e.friendly_name}" (${e.entity_id}) isn't in any area. Area assignments help auto-group entities on dashboards.`,
        suggestion: `Assign it via HA → Settings → Devices → find the device → set Area.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Clutter — entities that add noise to dashboards
// ---------------------------------------------------------------------------

const CLUTTER_DOMAINS = new Set(["update", "button", "number", "tts", "stt"]);
const DIAGNOSTIC_PATTERNS = [
  /^sensor\..+_uptime$/,
  /^sensor\..+_last_restart$/,
  /^sensor\..+_ip_address$/,
  /^sensor\..+_mac_address$/,
  /^sensor\..+_firmware$/,
  /^sensor\..+_hardware$/,
  /^sensor\..+_memory/,
  /^sensor\..+_cpu/,
  /^sensor\..+_disk/,
  /^sensor\..+_ssid$/,
  /^sensor\..+_bssid$/,
  /^sensor\..+_connection_type$/,
  /^binary_sensor\..+_update$/,
];

function checkClutter(entities: HaEntity[], emit: Emit) {
  for (const e of entities) {
    const domain = e.entity_id.split(".")[0];
    if (CLUTTER_DOMAINS.has(domain)) {
      emit({
        category: "clutter",
        severity: "info",
        entityId: e.entity_id,
        title: `Low-value ${domain} entity`,
        detail:
          `"${e.friendly_name}" (${e.entity_id}) is a ${domain} entity, which is rarely useful on dashboards.`,
        suggestion: "Disable this entity",
        fix: { type: "disable" },
      });
    } else if (DIAGNOSTIC_PATTERNS.some((p) => p.test(e.entity_id))) {
      emit({
        category: "clutter",
        severity: "info",
        entityId: e.entity_id,
        title: "Diagnostic sensor",
        detail:
          `"${e.friendly_name}" (${e.entity_id}) looks like an internal diagnostic (uptime, IP, firmware, etc.).`,
        suggestion: "Disable this entity",
        fix: { type: "disable" },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// String helpers
// ---------------------------------------------------------------------------

function humanize(idSuffix: string): string {
  return idSuffix
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function shortenName(name: string, area?: string): string {
  // Try stripping the area prefix first.
  if (area && name.startsWith(area)) {
    const stripped = name.slice(area.length).replace(/^[\s-]+/, "");
    if (stripped.length > 0 && stripped.length <= 40) return stripped;
  }
  // Truncate.
  return name.slice(0, 37) + "...";
}
