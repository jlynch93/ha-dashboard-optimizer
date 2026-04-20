import { NextRequest, NextResponse } from "next/server";

const SYSTEM_PROMPT = `You generate Home Assistant Lovelace dashboard YAML. You only output valid Lovelace YAML that starts with "views:" and contains cards with "type:" fields. Never output markdown, never output descriptions, never output state summaries. Only Lovelace YAML.`;

// Few-shot example: a sample input and the CORRECT Lovelace output
const EXAMPLE_USER = `Generate a Home Assistant Lovelace dashboard YAML for this setup.

Location: My Home
Areas: Living Room, Kitchen, Bedroom

Available entities:
  light.living_room = "Living Room Light" (on)
  light.kitchen = "Kitchen Light" (off)
  light.bedroom = "Bedroom Light" (on)
  climate.main = "Thermostat" (heating) unit:°C
  sensor.living_room_temperature = "Living Room Temp" (21.5) unit:°C
  sensor.outside_temperature = "Outside Temp" (8.2) unit:°C
  sensor.humidity = "Humidity" (45) unit:%
  weather.home = "Home" (sunny)
  binary_sensor.front_door = "Front Door" (off) class:door
  binary_sensor.motion_hallway = "Hallway Motion" (on) class:motion
  media_player.living_room = "Living Room Speaker" (playing)
  switch.fan = "Fan" (off)
  camera.front_door = "Front Door Camera" (idle)`;

const EXAMPLE_ASSISTANT = `views:
  - title: Overview
    path: overview
    icon: mdi:home
    cards:
      - type: weather-forecast
        entity: weather.home
        show_forecast: true
      - type: horizontal-stack
        cards:
          - type: gauge
            entity: sensor.living_room_temperature
            name: Living Room
            unit: "°C"
            min: 0
            max: 40
            severity:
              green: 18
              yellow: 26
              red: 30
          - type: gauge
            entity: sensor.outside_temperature
            name: Outside
            unit: "°C"
            min: -10
            max: 40
          - type: gauge
            entity: sensor.humidity
            name: Humidity
            unit: "%"
            min: 0
            max: 100
      - type: glance
        title: Security
        show_state: true
        entities:
          - entity: binary_sensor.front_door
            name: Front Door
            icon: mdi:door
          - entity: binary_sensor.motion_hallway
            name: Hallway
            icon: mdi:motion-sensor
      - type: thermostat
        entity: climate.main
      - type: media-control
        entity: media_player.living_room
  - title: Lights
    path: lights
    icon: mdi:lightbulb-group
    cards:
      - type: grid
        columns: 2
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
  - title: Climate
    path: climate
    icon: mdi:thermostat
    cards:
      - type: thermostat
        entity: climate.main
      - type: horizontal-stack
        cards:
          - type: sensor
            entity: sensor.living_room_temperature
            name: Indoor
            graph: line
          - type: sensor
            entity: sensor.outside_temperature
            name: Outdoor
            graph: line
  - title: Security
    path: security
    icon: mdi:shield-home
    cards:
      - type: picture-entity
        entity: camera.front_door
        name: Front Door
        camera_image: camera.front_door
      - type: entities
        title: Sensors
        entities:
          - entity: binary_sensor.front_door
            name: Front Door
            icon: mdi:door
          - entity: binary_sensor.motion_hallway
            name: Hallway Motion
            icon: mdi:motion-sensor`;

function extractYamlFromResponse(content: string): {
  optimizedYaml: string;
  explanation: string;
} {
  // Strategy 1: Look for our EXPLANATION_END marker
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
      explanation: cleanExplanation(beforeBlock) || "Dashboard generated. Review the YAML below.",
    };
  }

  // Strategy 3: Find "views:" and take everything from there
  const viewsIndex = content.indexOf("views:");
  if (viewsIndex !== -1) {
    const yaml = cleanYaml(content.substring(viewsIndex));
    const beforeYaml = content.substring(0, viewsIndex).trim();
    return {
      optimizedYaml: yaml,
      explanation: cleanExplanation(beforeYaml) || "Dashboard generated. Review the YAML below.",
    };
  }

  // Strategy 4: Look for ---YAML--- / ---END--- delimiters
  const delimMatch = content.match(/---YAML---([\s\S]*?)---END---/);
  const explMatch = content.match(/---EXPLANATION---([\s\S]*?)---YAML---/);
  if (delimMatch) {
    return {
      optimizedYaml: cleanYaml(delimMatch[1].trim()),
      explanation: cleanExplanation(explMatch?.[1]?.trim() || "") || "Dashboard generated.",
    };
  }

  // Fallback: return raw content
  return {
    optimizedYaml: content,
    explanation:
      "The model did not output structured YAML. The raw response is shown below. You may need to try again or use a different model.",
  };
}

function cleanYaml(yaml: string): string {
  // Remove any markdown code fences that might be wrapping the YAML
  yaml = yaml.replace(/^```(?:yaml|YAML)?\s*\n?/gm, "");
  yaml = yaml.replace(/```\s*$/gm, "");
  // Remove trailing markdown or text after the YAML ends
  // Find where valid YAML likely ends (look for lines that aren't indented YAML)
  const lines = yaml.split("\n");
  const cleanLines: string[] = [];
  let foundViews = false;
  for (const line of lines) {
    if (line.trim() === "views:" || line.trimStart().startsWith("views:")) {
      foundViews = true;
    }
    if (foundViews) {
      // Stop if we hit a markdown header or obvious non-YAML
      if (/^#{1,6}\s/.test(line) || line.startsWith("---END") || line.startsWith("**")) {
        break;
      }
      cleanLines.push(line);
    }
  }
  return cleanLines.length > 0 ? cleanLines.join("\n").trimEnd() : yaml.trim();
}

function cleanExplanation(text: string): string {
  // Strip markdown formatting from explanation
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^\*\s+/gm, "- ")
    .replace(/^[-•]\s*/gm, "- ")
    .trim();
}

export async function POST(request: NextRequest) {
  try {
    const { summary, ollamaUrl, model } = await request.json();

    if (!summary) {
      return NextResponse.json(
        { error: "No Home Assistant data provided" },
        { status: 400 }
      );
    }

    const ollamaEndpoint = ollamaUrl || "http://localhost:11434";
    const selectedModel = model || "llama3";

    // Build a concise, plain-text entity list matching the few-shot example format
    const entitySummary = summary.domains
      .filter((d: { domain: string; count: number }) => {
        const skipDomains = [
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
        ];
        return !skipDomains.includes(d.domain);
      })
      .flatMap(
        (d: {
          domain: string;
          count: number;
          entities: Array<{
            entity_id: string;
            friendly_name: string;
            state: string;
            device_class?: string;
            unit?: string;
          }>;
        }) =>
          d.entities.map(
            (e) =>
              `  ${e.entity_id} = "${e.friendly_name}" (${e.state})${e.device_class ? " class:" + e.device_class : ""}${e.unit ? " unit:" + e.unit : ""}`
          )
      )
      .join("\n");

    // Match the exact format of the few-shot example input
    const userPrompt = `Generate a Home Assistant Lovelace dashboard YAML for this setup.

Location: ${summary.location}
Areas: ${summary.areas.length > 0 ? summary.areas.join(", ") : "None configured"}

Available entities:
${entitySummary}`;

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
        { error: `Ollama error (${response.status}): ${errorText}` },
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
            "Could not connect to Ollama. Make sure it's running and accessible.",
        },
        { status: 503 }
      );
    }
    const message =
      error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
