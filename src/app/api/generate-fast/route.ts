import { NextRequest, NextResponse } from "next/server";
import { runParallelGeneration } from "@/lib/parallel-generate";
import { describeError } from "@/lib/stream-response";
import type { HaSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface RequestBody {
  summary?: HaSummary;
  /** Primary Ollama endpoint. */
  ollamaUrl?: string;
  /** Additional endpoints to round-robin per-view calls across. */
  extraEndpoints?: string[];
  /** Planner model. Defaults to `model` or `llama3`. */
  plannerModel?: string;
  /** Per-view card model. Defaults to `model` or `llama3`. */
  model?: string;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { summary, ollamaUrl, extraEndpoints, plannerModel, model } = body;
  if (!summary) {
    return NextResponse.json({ error: "No Home Assistant data provided" }, { status: 400 });
  }

  const primary = ollamaUrl || "http://localhost:11434";
  const endpoints = dedupe([primary, ...(extraEndpoints ?? [])]).filter(Boolean);
  const cardModelName = model || "llama3";
  const plannerModelName = plannerModel || cardModelName;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        for await (const event of runParallelGeneration({
          summary,
          endpoints,
          plannerModel: plannerModelName,
          cardModel: cardModelName,
          signal: request.signal,
        })) {
          send(event.event, event.data);
        }
      } catch (err) {
        const { message, status } = describeError(err);
        send("error", { message, status });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    if (typeof raw !== "string") continue;
    const url = raw.trim().replace(/\/$/, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}
