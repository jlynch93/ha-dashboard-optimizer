// Heuristics to pull a Lovelace `views:` document out of an LLM response that
// may also contain prose, markdown, or code fences.

import { validateLovelaceYaml } from "./yaml-validate";
import type { ExtractedYaml } from "./types";

const FALLBACK_EXPLANATION =
  "Dashboard ready. Review the YAML below.";

const RAW_FALLBACK_EXPLANATION =
  "The model did not output structured YAML. The raw response is shown below. Try again or switch to a more capable model.";

export function extractYamlFromResponse(content: string): ExtractedYaml {
  const parsed = runStrategies(content);
  const validation = validateLovelaceYaml(parsed.optimizedYaml);
  return { ...parsed, validation };
}

function runStrategies(content: string): { optimizedYaml: string; explanation: string } {
  // Strategy 1: explicit EXPLANATION_END marker (preferred).
  const markerIndex = content.indexOf("EXPLANATION_END");
  if (markerIndex !== -1) {
    const explanation = content.substring(0, markerIndex).trim();
    const yaml = cleanYaml(
      content.substring(markerIndex + "EXPLANATION_END".length).trim()
    );
    if (yaml.includes("views:")) {
      return { optimizedYaml: yaml, explanation: cleanExplanation(explanation) };
    }
  }

  // Strategy 2: fenced ```yaml code block.
  const fence = content.match(/```(?:yaml|yml|YAML)?\s*\n([\s\S]*?)```/);
  if (fence) {
    const yaml = cleanYaml(fence[1].trim());
    const before = content.substring(0, content.indexOf("```")).trim();
    return {
      optimizedYaml: yaml,
      explanation: cleanExplanation(before) || FALLBACK_EXPLANATION,
    };
  }

  // Strategy 3: find `views:` and keep everything from there onward.
  const viewsIndex = content.indexOf("views:");
  if (viewsIndex !== -1) {
    const yaml = cleanYaml(content.substring(viewsIndex));
    const before = content.substring(0, viewsIndex).trim();
    return {
      optimizedYaml: yaml,
      explanation: cleanExplanation(before) || FALLBACK_EXPLANATION,
    };
  }

  // Strategy 4: custom delimiters some models like to use.
  const delim = content.match(/---YAML---([\s\S]*?)---END---/);
  const expl = content.match(/---EXPLANATION---([\s\S]*?)---YAML---/);
  if (delim) {
    return {
      optimizedYaml: cleanYaml(delim[1].trim()),
      explanation: cleanExplanation(expl?.[1]?.trim() ?? "") || FALLBACK_EXPLANATION,
    };
  }

  // Fallback: return the raw content untouched so the user can inspect it.
  return {
    optimizedYaml: content.trim(),
    explanation: RAW_FALLBACK_EXPLANATION,
  };
}

function cleanYaml(input: string): string {
  // Strip any remaining fence markers.
  let yaml = input.replace(/^```(?:yaml|yml|YAML)?\s*\n?/gm, "");
  yaml = yaml.replace(/```\s*$/gm, "");

  const lines = yaml.split("\n");
  const out: string[] = [];
  let foundViews = false;
  for (const line of lines) {
    if (!foundViews && line.trimStart().startsWith("views:")) {
      foundViews = true;
    }
    if (!foundViews) continue;
    // Stop on markdown headers or sentinel markers that indicate prose follows.
    if (/^#{1,6}\s/.test(line) || line.startsWith("---END") || line.startsWith("**")) {
      break;
    }
    out.push(line);
  }
  return out.length > 0 ? out.join("\n").trimEnd() : yaml.trim();
}

function cleanExplanation(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\*\s+/gm, "- ")
    .replace(/^[-•]\s*/gm, "- ")
    .trim();
}
