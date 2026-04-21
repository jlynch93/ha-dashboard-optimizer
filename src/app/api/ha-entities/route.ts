import { NextRequest, NextResponse } from "next/server";
import type { HaEntity, HaSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

interface RequestBody {
  haUrl?: string;
  haToken?: string;
  /** Per-domain sample cap sent to the LLM. Default 50. */
  sampleLimit?: number;
}

interface HaRawEntity {
  entity_id: string;
  state: string;
  attributes?: {
    friendly_name?: string;
    device_class?: string;
    unit_of_measurement?: string;
  };
}

const AREA_TEMPLATE = `{% set areas = states | map(attribute='entity_id') | map('area_name') | reject('none') | unique | list %}{{ areas | tojson }}`;
const HA_TIMEOUT_MS = 15_000;
const DEFAULT_SAMPLE_LIMIT = 50;

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { haUrl, haToken, sampleLimit = DEFAULT_SAMPLE_LIMIT } = body;
  if (!haUrl || !haToken) {
    return NextResponse.json(
      { error: "Home Assistant URL and Long-Lived Access Token are required" },
      { status: 400 },
    );
  }

  const baseUrl = haUrl.replace(/\/$/, "");
  const headers = {
    Authorization: `Bearer ${haToken}`,
    "Content-Type": "application/json",
  };

  try {
    const [statesRes, areasRes, configRes] = await Promise.all([
      fetch(`${baseUrl}/api/states`, { headers, signal: AbortSignal.timeout(HA_TIMEOUT_MS) }),
      fetch(`${baseUrl}/api/template`, {
        method: "POST",
        headers,
        body: JSON.stringify({ template: AREA_TEMPLATE }),
        signal: AbortSignal.timeout(HA_TIMEOUT_MS),
      }).catch(() => null),
      fetch(`${baseUrl}/api/config`, { headers, signal: AbortSignal.timeout(HA_TIMEOUT_MS) }),
    ]);

    if (!statesRes.ok) {
      if (statesRes.status === 401) {
        return NextResponse.json(
          { error: "Invalid access token. Check your Long-Lived Access Token." },
          { status: 401 },
        );
      }
      return NextResponse.json(
        { error: `Home Assistant returned ${statesRes.status}. Check your URL.` },
        { status: statesRes.status },
      );
    }

    const states = (await statesRes.json()) as HaRawEntity[];
    const areas = await parseAreas(areasRes);
    const config = configRes.ok
      ? ((await configRes.json()) as { location_name?: string })
      : null;

    const summary = buildSummary(states, areas, config, sampleLimit);
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return NextResponse.json(
        { error: "Home Assistant request timed out. Check that the URL is reachable from this machine." },
        { status: 504 },
      );
    }
    if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
      return NextResponse.json(
        { error: "Could not connect to Home Assistant. Check the URL and ensure HA is accessible from this machine." },
        { status: 503 },
      );
    }
    const message = err instanceof Error ? err.message : "Failed to fetch HA entities";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function parseAreas(res: Response | null): Promise<string[]> {
  if (!res || !res.ok) return [];
  try {
    const text = await res.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function buildSummary(
  states: HaRawEntity[],
  areas: string[],
  config: { location_name?: string } | null,
  sampleLimit: number,
): HaSummary {
  const byDomain = new Map<string, HaEntity[]>();
  for (const entity of states) {
    const domain = entity.entity_id.split(".")[0];
    const list = byDomain.get(domain) ?? [];
    list.push({
      entity_id: entity.entity_id,
      friendly_name: entity.attributes?.friendly_name || entity.entity_id,
      state: entity.state,
      domain,
      device_class: entity.attributes?.device_class,
      unit: entity.attributes?.unit_of_measurement,
    });
    byDomain.set(domain, list);
  }

  const domains = Array.from(byDomain.entries()).map(([domain, entities]) => ({
    domain,
    count: entities.length,
    entities: entities.slice(0, sampleLimit),
    truncated: entities.length > sampleLimit,
  }));

  return {
    location: config?.location_name || "Home",
    entity_count: states.length,
    domains,
    areas,
    sample_limit: sampleLimit,
  };
}
