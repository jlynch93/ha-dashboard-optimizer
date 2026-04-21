// Helpers for turning a Home Assistant summary into an LLM-friendly prompt.

import type { HaSummary } from "./types";

// Domains that rarely belong on a dashboard; we omit them from the entity list
// sent to the LLM to keep the prompt compact.
const SKIP_DOMAINS = new Set([
  "persistent_notification",
  "update",
  "number",
  "select",
  "input_number",
  "input_select",
  "input_boolean",
  "input_text",
  "input_datetime",
  "zone",
  "tts",
  "stt",
  "conversation",
]);

export function buildEntityPrompt(summary: HaSummary): string {
  const lines: string[] = [];
  for (const group of summary.domains) {
    if (SKIP_DOMAINS.has(group.domain)) continue;
    for (const e of group.entities) {
      const bits = [`  ${e.entity_id} = "${e.friendly_name}" (${e.state})`];
      if (e.device_class) bits.push(`class:${e.device_class}`);
      if (e.unit) bits.push(`unit:${e.unit}`);
      lines.push(bits.join(" "));
    }
  }
  return lines.join("\n");
}

export function buildGenerateUserPrompt(summary: HaSummary): string {
  const areas = summary.areas.length > 0 ? summary.areas.join(", ") : "None configured";
  return `Generate a Home Assistant Lovelace dashboard YAML for this setup.

Location: ${summary.location}
Areas: ${areas}

Available entities:
${buildEntityPrompt(summary)}`;
}
