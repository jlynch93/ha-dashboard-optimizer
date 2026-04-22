import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface FixRequest {
  haUrl: string;
  haToken: string;
  entityId: string;
  action: { type: "rename"; newName: string } | { type: "disable" };
}

/**
 * Proxy fix actions to the HA entity registry API.
 *
 * - rename → POST /api/config/entity_registry/{entity_id} { name: newName }
 * - disable → POST /api/config/entity_registry/{entity_id} { disabled_by: "user" }
 */
export async function POST(request: NextRequest) {
  let body: FixRequest;
  try {
    body = (await request.json()) as FixRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { haUrl, haToken, entityId, action } = body;
  if (!haUrl || !haToken || !entityId || !action) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const base = haUrl.replace(/\/+$/, "");
  const url = `${base}/api/config/entity_registry/${entityId}`;

  let payload: Record<string, unknown>;
  switch (action.type) {
    case "rename":
      payload = { name: action.newName };
      break;
    case "disable":
      payload = { disabled_by: "user" };
      break;
    default:
      return NextResponse.json({ error: "Unknown action type" }, { status: 400 });
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${haToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `HA returned ${res.status}: ${text.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await res.json().catch(() => ({}));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Failed to reach HA: ${msg}` }, { status: 502 });
  }
}
