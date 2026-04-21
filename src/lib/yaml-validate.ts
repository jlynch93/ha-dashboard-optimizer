// Validate a Lovelace YAML string using js-yaml and tally views/cards for a
// quick quality signal to show in the UI.

import yaml from "js-yaml";
import type { YamlValidation } from "./types";

interface LovelaceView {
  cards?: unknown[];
  sections?: Array<{ cards?: unknown[] }>;
}

interface LovelaceDoc {
  views?: LovelaceView[];
}

export function validateLovelaceYaml(input: string): YamlValidation {
  const trimmed = input.trim();
  if (!trimmed) {
    return { valid: false, error: "Empty document", view_count: 0, card_count: 0 };
  }

  let doc: unknown;
  try {
    doc = yaml.load(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "YAML parse error";
    return { valid: false, error: message, view_count: 0, card_count: 0 };
  }

  if (!doc || typeof doc !== "object") {
    return {
      valid: false,
      error: "Document is not a mapping",
      view_count: 0,
      card_count: 0,
    };
  }

  const views = (doc as LovelaceDoc).views;
  if (!Array.isArray(views)) {
    return {
      valid: false,
      error: "Missing `views:` array at the top level",
      view_count: 0,
      card_count: 0,
    };
  }

  let cardCount = 0;
  for (const view of views) {
    if (!view || typeof view !== "object") continue;
    if (Array.isArray(view.cards)) cardCount += view.cards.length;
    if (Array.isArray(view.sections)) {
      for (const section of view.sections) {
        if (section && Array.isArray(section.cards)) {
          cardCount += section.cards.length;
        }
      }
    }
  }

  return { valid: true, view_count: views.length, card_count: cardCount };
}
