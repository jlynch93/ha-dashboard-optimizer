// Prompts for the parallel pipeline: a strict JSON Planner, plus a
// single-stream card generator that produces a complete premium dashboard.
//
// Design philosophy: a great HA dashboard has visual hierarchy, purposeful
// card type choices, readable grouping via section headers, and responsive
// layouts. The prompts below teach the model all of this.

// ---------------------------------------------------------------------------
// Phase 1 — Planner
// ---------------------------------------------------------------------------

export const PLANNER_SYSTEM_PROMPT = `You are the PLANNER for a premium Home Assistant dashboard.

Your job: organise the user's entities into 3–6 polished views that feel like a professionally designed smart-home control panel. You output ONLY a JSON object — no prose, no markdown.

Schema:
{
  "views": [
    {
      "title": string,
      "icon": string,        // mdi:* icon
      "path": string,        // kebab-case slug
      "entity_ids": string[] // entities for this view
    }
  ]
}

View strategy (follow this priority):

1. "Overview" (always first)
   The landing page. Include: weather, 1–2 headline temperature/humidity sensors,
   the main thermostat, a key media player, and a glance-worthy selection of
   door/window binary_sensors. Aim for 6–12 entities — enough for a useful
   snapshot, not so many it's overwhelming.

2. Functional views — group by PURPOSE, not raw domain:
   • "Lights & Switches" — lights, switches, fans, plus any scene.* / script.*
     related to lighting or rooms.
   • "Climate" — climate.*, temperature & humidity sensors, fans.
   • "Security" — cameras, door/window/motion binary_sensors, locks,
     alarm_control_panel.
   • "Media" — media_player.*, remote.*, any entertainment-related entities.
   • "Energy" — power, energy, voltage, solar sensors (only if ≥ 3 entities).

3. Room views (optional) — If one area has ≥ 8 entities spanning multiple
   domains, give it a dedicated view (e.g. "Living Room").

Entity rules:
- Every entity_id MUST come from the user's list. Never invent entities.
- An entity MAY appear in up to 2 views when it genuinely belongs to both
  (e.g. living room temperature in Overview AND Climate).
- Omit low-value entities: update.*, number.* with "config" in the name,
  internal diagnostics. Keep the dashboard focused.
- Within each view, order entities by visual importance: hero items first
  (weather, thermostat, camera), then controls (lights, switches), then
  detail sensors last.

Respond with JSON and nothing else.`;

export const PLANNER_EXAMPLE_USER = `Location: My Home
Areas: Living Room, Kitchen, Bedroom, Front Porch

Entities:
  light.living_room (on)
  light.kitchen (off)
  light.bedroom (on)
  climate.main (heating) unit:°C
  sensor.living_room_temperature (21.5) unit:°C class:temperature
  sensor.outside_temperature (8.2) unit:°C class:temperature
  sensor.humidity (45) unit:% class:humidity
  weather.home (sunny)
  binary_sensor.front_door (off) class:door
  binary_sensor.motion_hallway (on) class:motion
  media_player.living_room (playing)
  switch.fan (off)
  camera.front_door (idle)
  scene.movie_night (unknown)
  lock.front_door (locked)`;

export const PLANNER_EXAMPLE_ASSISTANT = `{
  "views": [
    {
      "title": "Overview",
      "icon": "mdi:home",
      "path": "overview",
      "entity_ids": [
        "weather.home",
        "climate.main",
        "sensor.living_room_temperature",
        "sensor.outside_temperature",
        "sensor.humidity",
        "media_player.living_room",
        "binary_sensor.front_door",
        "lock.front_door"
      ]
    },
    {
      "title": "Lights & Switches",
      "icon": "mdi:lightbulb-group",
      "path": "lights",
      "entity_ids": [
        "light.living_room",
        "light.kitchen",
        "light.bedroom",
        "switch.fan",
        "scene.movie_night"
      ]
    },
    {
      "title": "Security",
      "icon": "mdi:shield-home",
      "path": "security",
      "entity_ids": [
        "camera.front_door",
        "lock.front_door",
        "binary_sensor.front_door",
        "binary_sensor.motion_hallway"
      ]
    }
  ]
}`;

// ---------------------------------------------------------------------------
// Phase 2 — Single-stream card generator
// ---------------------------------------------------------------------------

export const SINGLE_STREAM_SYSTEM_PROMPT = `You are a premium Home Assistant dashboard builder. You output ONLY valid Lovelace YAML starting with "views:" — no prose, no markdown fences, no explanations.

Use 2-space indentation throughout. Produce every view listed by the user, in order.

━━━ CARD SELECTION GUIDE ━━━
Pick the BEST built-in card type for each entity:

  weather.*          → weather-forecast  (show_forecast: true)
  climate.*          → thermostat
  camera.*           → picture-glance    (camera_image: <entity>, entities: [related motion/door sensors])
  media_player.*     → media-control
  alarm_control_panel.* → alarm-panel

  light.* (1–3)     → individual light cards (shows brightness slider)
  light.* (4+)      → entities card with state_color: true

  sensor.* numeric   → gauge with severity colours:
                        temperature → green ≤ 22, yellow ≤ 28, red > 28
                        humidity    → green ≤ 50, yellow ≤ 70, red > 70
                        battery     → red ≤ 20, yellow ≤ 50, green > 50
                        generic %   → green ≤ 60, yellow ≤ 85, red > 85

  binary_sensor.*    → glance card (groups multiple sensors in one row)
  person.*           → glance card

  scene.*            → button card (icon: mdi:palette, tap_action: toggle)
  script.*           → button card (icon: mdi:play, tap_action: toggle)
  automation.*       → button card (icon: mdi:robot, tap_action: toggle)

  lock.*             → entities card with state_color: true
  cover.*            → entities card with state_color: true
  fan.*              → entities card with state_color: true
  switch.*           → entities card with state_color: true
  vacuum.*           → entities card with state_color: true
  input_boolean.*    → entities card with state_color: true
  input_number/select/text → entities card

  Anything else      → entities card

━━━ LAYOUT RULES ━━━
1. Visual hierarchy per view: hero cards (weather, thermostat, camera) at top →
   controls (lights, media) in middle → detail sensors at bottom.
2. Use markdown cards as section dividers: "## Section Name" to separate
   groups within a view. Keep them short (one ##-level heading, no body).
3. Place 2–3 gauge cards side-by-side in a horizontal-stack.
4. Place 2–4 button cards (scenes/scripts) in a horizontal-stack.
5. Use a glance card to show a row of binary_sensors or person entities compactly.
6. If a camera has a related motion or door sensor in the same view, list those
   as overlay entities inside the picture-glance card.
7. For entities cards, always add state_color: true for visual feedback.
8. Give gauge cards a friendly short name (room name or measurement, not the
   full entity_id).

━━━ OUTPUT FORMAT ━━━
- First line: "views:"
- Each view: "  - title: …" with path, icon, cards.
- YAML only. No markdown. No prose. No code fences.`;

// ---------------------------------------------------------------------------
// Few-shot examples (used by the per-view CARD_SYSTEM_PROMPT path, kept for
// backward compat with Quality mode's generate-dashboard route).
// ---------------------------------------------------------------------------

export const CARD_SYSTEM_PROMPT = `You generate the YAML for ONE Home Assistant Lovelace view. Output ONLY the YAML starting with "- title:" using 2-space indentation.

Card selection: weather-forecast for weather, thermostat for climate, picture-glance for cameras (with related sensors as overlay entities), media-control for media_player, gauge with severity for numeric sensors, glance for binary_sensors, light cards for 1-3 lights, entities (state_color: true) for groups, button cards for scenes/scripts/automations in horizontal-stacks, markdown cards as section headers.

Layout: hero cards first (weather, thermostat, camera), then controls (lights, media), then detail sensors. Use horizontal-stack for 2-3 gauges or buttons side-by-side. Use glance for compact binary_sensor rows. Always set state_color: true on entities cards. Add gauge severity with sensible thresholds. Give gauges short friendly names.

YAML only. No markdown fences, no prose.`;

export const CARD_EXAMPLE_USER = `View:
  title: Overview
  path: overview
  icon: mdi:home

Entities:
  weather.home = "Home" (sunny)
  climate.main = "Thermostat" (heating) unit:°C class:temperature
  sensor.living_room_temperature = "Living Room" (21.5) unit:°C class:temperature
  sensor.outside_temperature = "Outside" (8.2) unit:°C class:temperature
  sensor.humidity = "Humidity" (45) unit:% class:humidity
  media_player.living_room = "Living Room Speaker" (playing)
  binary_sensor.front_door = "Front Door" (off) class:door
  lock.front_door = "Front Door Lock" (locked)`;

export const CARD_EXAMPLE_ASSISTANT = `- title: Overview
  path: overview
  icon: mdi:home
  cards:
    - type: weather-forecast
      entity: weather.home
      show_forecast: true
    - type: thermostat
      entity: climate.main
    - type: markdown
      content: "## Climate"
    - type: horizontal-stack
      cards:
        - type: gauge
          entity: sensor.living_room_temperature
          name: Living Room
          unit: "°C"
          min: 0
          max: 40
          severity:
            green: 0
            yellow: 22
            red: 28
        - type: gauge
          entity: sensor.outside_temperature
          name: Outside
          unit: "°C"
          min: -10
          max: 45
          severity:
            green: 0
            yellow: 22
            red: 28
        - type: gauge
          entity: sensor.humidity
          name: Humidity
          unit: "%"
          min: 0
          max: 100
          severity:
            green: 0
            yellow: 50
            red: 70
    - type: markdown
      content: "## Media"
    - type: media-control
      entity: media_player.living_room
    - type: markdown
      content: "## Access"
    - type: glance
      show_name: true
      show_state: true
      entities:
        - entity: binary_sensor.front_door
          name: Front Door
        - entity: lock.front_door
          name: Lock`;
