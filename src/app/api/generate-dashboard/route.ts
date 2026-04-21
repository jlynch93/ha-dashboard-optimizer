import { NextRequest, NextResponse } from "next/server";
import { buildGenerateUserPrompt } from "@/lib/ha";
import {
  GENERATE_EXAMPLE_ASSISTANT,
  GENERATE_EXAMPLE_USER,
  GENERATE_SYSTEM_PROMPT,
} from "@/lib/prompts";
import {
  collectStream,
  createSseResponse,
  describeError,
} from "@/lib/stream-response";
import { extractYamlFromResponse } from "@/lib/yaml-extract";
import type { HaSummary } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface RequestBody {
  summary?: HaSummary;
  ollamaUrl?: string;
  model?: string;
  stream?: boolean;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { summary, ollamaUrl, model, stream = true } = body;
  if (!summary) {
    return NextResponse.json({ error: "No Home Assistant data provided" }, { status: 400 });
  }

  const call = {
    endpoint: ollamaUrl || "http://localhost:11434",
    model: model || "llama3",
    messages: [
      { role: "system" as const, content: GENERATE_SYSTEM_PROMPT },
      { role: "user" as const, content: GENERATE_EXAMPLE_USER },
      { role: "assistant" as const, content: GENERATE_EXAMPLE_ASSISTANT },
      { role: "user" as const, content: buildGenerateUserPrompt(summary) },
    ],
    options: { temperature: 0.2, num_predict: 8192 },
    signal: request.signal,
  };

  if (stream) return createSseResponse(call);

  try {
    const full = await collectStream(call);
    return NextResponse.json(extractYamlFromResponse(full));
  } catch (err) {
    const { message, status } = describeError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
