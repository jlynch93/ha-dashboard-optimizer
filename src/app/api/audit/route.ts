import { NextRequest, NextResponse } from "next/server";
import { runAudit } from "@/lib/audit";
import type { HaSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let body: { summary?: HaSummary };
  try {
    body = (await request.json()) as { summary?: HaSummary };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.summary) {
    return NextResponse.json({ error: "No Home Assistant data provided" }, { status: 400 });
  }

  const report = runAudit(body.summary);
  return NextResponse.json(report);
}
