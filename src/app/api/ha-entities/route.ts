import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { haUrl, haToken } = await request.json();

    if (!haUrl || !haToken) {
      return NextResponse.json(
        { error: "Home Assistant URL and Long-Lived Access Token are required" },
        { status: 400 }
      );
    }

    const baseUrl = haUrl.replace(/\/$/, "");
    const headers = {
      Authorization: `Bearer ${haToken}`,
      "Content-Type": "application/json",
    };

    // Fetch states, areas, and device registry in parallel
    const [statesRes, areasRes, configRes] = await Promise.all([
      fetch(`${baseUrl}/api/states`, { headers }),
      fetch(`${baseUrl}/api/template`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          template: `{% set areas = states | map(attribute='entity_id') | map('area_name') | reject('none') | unique | list %}{{ areas | tojson }}`,
        }),
      }).catch(() => null),
      fetch(`${baseUrl}/api/config`, { headers }),
    ]);

    if (!statesRes.ok) {
      if (statesRes.status === 401) {
        return NextResponse.json(
          { error: "Invalid access token. Check your Long-Lived Access Token." },
          { status: 401 }
        );
      }
      return NextResponse.json(
        { error: `Home Assistant returned ${statesRes.status}. Check your URL.` },
        { status: statesRes.status }
      );
    }

    const states = await statesRes.json();

    // Parse areas from template response
    let areas: string[] = [];
    if (areasRes && areasRes.ok) {
      try {
        const areaText = await areasRes.text();
        areas = JSON.parse(areaText);
      } catch {
        // areas will remain empty
      }
    }

    // Parse config
    let config = null;
    if (configRes.ok) {
      config = await configRes.json();
    }

    // Organize entities by domain
    const entityMap: Record<string, Array<{
      entity_id: string;
      friendly_name: string;
      state: string;
      domain: string;
      area?: string;
      device_class?: string;
      unit?: string;
    }>> = {};

    for (const entity of states) {
      const domain = entity.entity_id.split(".")[0];
      if (!entityMap[domain]) {
        entityMap[domain] = [];
      }
      entityMap[domain].push({
        entity_id: entity.entity_id,
        friendly_name: entity.attributes?.friendly_name || entity.entity_id,
        state: entity.state,
        domain,
        device_class: entity.attributes?.device_class,
        unit: entity.attributes?.unit_of_measurement,
      });
    }

    // Build a summary for the LLM
    const summary = {
      location: config?.location_name || "Home",
      entity_count: states.length,
      domains: Object.entries(entityMap).map(([domain, entities]) => ({
        domain,
        count: entities.length,
        entities: entities.slice(0, 50), // Limit to prevent token overflow
      })),
      areas,
    };

    return NextResponse.json({ summary, entityMap });
  } catch (error: unknown) {
    if (
      error instanceof TypeError &&
      error.message.includes("fetch failed")
    ) {
      return NextResponse.json(
        { error: "Could not connect to Home Assistant. Check the URL and ensure HA is accessible from this machine." },
        { status: 503 }
      );
    }
    const message =
      error instanceof Error ? error.message : "Failed to fetch HA entities";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
