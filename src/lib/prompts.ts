// Prompts and few-shot examples for Ollama. Kept in one place so the two
// routes (generate + optimize) stay in sync.

export const GENERATE_SYSTEM_PROMPT =
  `You generate Home Assistant Lovelace dashboard YAML. You only output valid Lovelace YAML that starts with "views:" and contains cards with "type:" fields. Never output markdown, never output descriptions, never output state summaries. Only Lovelace YAML.`;

export const OPTIMIZE_SYSTEM_PROMPT =
  `You optimize Home Assistant Lovelace dashboard YAML. You receive existing YAML and output improved YAML. You only output valid Lovelace YAML starting with "views:" that contains cards with "type:" fields. Never output markdown, never describe what things look like, never output state summaries. Only Lovelace YAML code.`;

export const GENERATE_EXAMPLE_USER = `Generate a Home Assistant Lovelace dashboard YAML for this setup.

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

export const GENERATE_EXAMPLE_ASSISTANT = `views:
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

export const OPTIMIZE_EXAMPLE_USER = `Optimize this Home Assistant Lovelace dashboard YAML.

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

export const OPTIMIZE_EXAMPLE_ASSISTANT = `views:
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
