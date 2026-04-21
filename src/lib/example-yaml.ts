// A realistic-ish sample Lovelace config so users can try Optimize mode
// without having Home Assistant wired up yet.

export const EXAMPLE_DASHBOARD_YAML = `views:
  - title: Home
    cards:
      - type: entities
        title: Everything
        entities:
          - light.living_room
          - light.kitchen
          - light.bedroom
          - light.hallway
          - switch.fan
          - switch.coffee_maker
          - sensor.temperature
          - sensor.humidity
          - sensor.outside_temperature
          - binary_sensor.front_door
          - binary_sensor.motion_hallway
          - climate.thermostat
          - media_player.living_room_speaker
          - weather.home
          - camera.front_door
`;
