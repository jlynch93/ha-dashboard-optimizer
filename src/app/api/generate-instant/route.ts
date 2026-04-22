import { NextRequest, NextResponse } from "next/server";
import { buildFallbackPlan } from "@/lib/parallel-generate";
import { generateFromTemplate } from "@/lib/template-generate";
import { validateLovelaceYaml } from "@/lib/yaml-validate";
import type { HaSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

interface RequestBody {
  summary?: HaSummary;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * Instant mode: deterministic template-based generation, zero LLM calls.
 * Emits the same SSE event shape as the other routes for client consistency.
 */
export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { summary } = body;
  if (!summary) {
    return NextResponse.json({ error: "No Home Assistant data provided" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        const plan = buildFallbackPlan(summary);
        send("planner_done", { plan, elapsedMs: 0, fallback: true });

        const result = generateFromTemplate(summary, plan);
        const validation = validateLovelaceYaml(result.yaml);

        send("done", {
          optimizedYaml: result.yaml,
          explanation: `Instant: generated ${result.viewCount} views with ${result.cardCount} cards from templates (no LLM).`,
          validation,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        send("error", { message, status: 500 });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
