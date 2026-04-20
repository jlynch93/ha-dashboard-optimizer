import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You optimize Home Assistant Lovelace dashboard YAML. You receive existing YAML and output improved YAML. You only output valid Lovelace YAML starting with "views:" that contains cards with "type:" fields. Never output markdown, never describe what things look like, never output state summaries. Only Lovelace YAML code.`;

// Few-shot example for the optimize flow
const EXAMPLE_USER = `Optimize this Home Assistant Lovelace dashboard YAML.

views:
  - title: Home
    cards:
      - type: entities
        entities:
          - light.living_room
          - light.kitchen
          - light.bedroom
          - switch.fan
          - sensor.temperature
          - sensor.humidity
          - binary_sensor.front_door
          - climate.thermostat
          - media_player.speaker`;

const EXAMPLE_ASSISTANT = `views:
  - title: Home
    path: home
    icon: mdi:home
    cards:
      - type: horizontal-stack
        cards:
          - type: gauge
            entity: sensor.temperature
            name: Temperature
            unit: "°F"
            min: 50
            max: 100
          - type: gauge
            entity: sensor.humidity
            name: Humidity
            unit: "%"
            min: 0
            max: 100
      - type: thermostat
        entity: climate.thermostat
      - type: grid
        columns: 3
        cards:
          - type: light
            entity: light.living_room
            name: Living Room
            icon: mdi:ceiling-light
          - type: light
            entity: light.kitchen
            name: Kitchen
            icon: mdi:ceiling-light
          - type: light
            entity: light.bedroom
            name: Bedroom
            icon: mdi:lamp
      - type: glance
        title: Status
        entities:
          - entity: binary_sensor.front_door
            name: Front Door
            icon: mdi:door
          - entity: switch.fan
            name: Fan
            icon: mdi:fan
      - type: media-control
        entity: media_player.speaker`;

function extractYamlFromResponse(content: string): {
  optimizedYaml: string;
  explanation: string;
} {
  // Strategy 1: Look for EXPLANATION_END marker
  const markerIndex = content.indexOf("EXPLANATION_END");
  if (markerIndex !== -1) {
    const explanation = content.substring(0, markerIndex).trim();
    let yaml = content.substring(markerIndex + "EXPLANATION_END".length).trim();
    yaml = cleanYaml(yaml);
    if (yaml.includes("views:")) {
      return { optimizedYaml: yaml, explanation: cleanExplanation(explanation) };
    }
  }

  // Strategy 2: Look for ```yaml code blocks
  const codeBlockMatch = content.match(/```(?:yaml|YAML)?\s*\n([\s\S]*?)```/);
  if (codeBlockMatch) {
    const yaml = cleanYaml(codeBlockMatch[1].trim());
    const beforeBlock = content.substring(0, content.indexOf("```")).trim();
    return {
      optimizedYaml: yaml,
      explanation: cleanExplanation(beforeBlock) || "Dashboard optimized. Review the YAML below.",
    };
  }

  // Strategy 3: Find "views:" and take everything from there
  const viewsIndex = content.indexOf("views:");
  if (viewsIndex !== -1) {
    const yaml = cleanYaml(content.substring(viewsIndex));
    const beforeYaml = content.substring(0, viewsIndex).trim();
    return {
      optimizedYaml: yaml,
      explanation: cleanExplanation(beforeYaml) || "Dashboard optimized. Review the YAML below.",
    };
  }

  // Strategy 4: Look for ---YAML--- / ---END--- delimiters
  const delimMatch = content.match(/---YAML---([\s\S]*?)---END---/);
  const explMatch = content.match(/---EXPLANATION---([\s\S]*?)---YAML---/);
  if (delimMatch) {
    return {
      optimizedYaml: cleanYaml(delimMatch[1].trim()),
      explanation: cleanExplanation(explMatch?.[1]?.trim() || "") || "Dashboard optimized.",
    };
  }

  // Fallback
  return {
    optimizedYaml: content,
    explanation:
      "The model did not output structured YAML. The raw response is shown. You may need to try again or use a different model.",
  };
}

function cleanYaml(yaml: string): string {
  yaml = yaml.replace(/^```(?:yaml|YAML)?\s*\n?/gm, "");
  yaml = yaml.replace(/```\s*$/gm, "");
  const lines = yaml.split("\n");
  const cleanLines: string[] = [];
  let foundViews = false;
  for (const line of lines) {
    if (line.trim() === "views:" || line.trimStart().startsWith("views:")) {
      foundViews = true;
    }
    if (foundViews) {
      if (/^#{1,6}\s/.test(line) || line.startsWith("---END") || line.startsWith("**")) {
        break;
      }
      cleanLines.push(line);
    }
  }
  return cleanLines.length > 0 ? cleanLines.join("\n").trimEnd() : yaml.trim();
}

function cleanExplanation(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\*\s+/gm, "- ")
    .replace(/^[-•]\s*/gm, "- ")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const { yaml, ollamaUrl, model } = await request.json();

    if (!yaml || !yaml.trim()) {
      return NextResponse.json(
        { error: "No YAML configuration provided" },
        { status: 400 }
      );
    }

    const ollamaEndpoint = ollamaUrl || "http://localhost:11434";
    const selectedModel = model || "llama3";

    // Match the format of the few-shot example
    const userPrompt = `Optimize this Home Assistant Lovelace dashboard YAML.

${yaml}`;

    const response = await fetch(`${ollamaEndpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          // Few-shot example: teaches the model the exact format
          { role: "user", content: EXAMPLE_USER },
          { role: "assistant", content: EXAMPLE_ASSISTANT },
          // Actual request
          { role: "user", content: userPrompt },
        ],
        stream: false,
        options: {
          temperature: 0.2,
          num_predict: 8192,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      if (response.status === 404) {
        return NextResponse.json(
          {
            error: `Model "${selectedModel}" not found. Run: ollama pull ${selectedModel}`,
          },
          { status: 404 }
        );
      }

      return NextResponse.json(
        {
          error: `Ollama error (${response.status}). Is Ollama running at ${ollamaEndpoint}? ${errorText}`,
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data.message?.content || "";

    const { optimizedYaml, explanation } = extractYamlFromResponse(content);

    return NextResponse.json({ optimizedYaml, explanation });
  } catch (error: unknown) {
    if (
      error instanceof TypeError &&
      error.message.includes("fetch failed")
    ) {
      return NextResponse.json(
        {
          error:
            "Could not connect to Ollama. Make sure Ollama is running.",
        },
        { status: 503 }
      );
    }

    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
