import { NextRequest, NextResponse } from "next/server";
import {
  OPTIMIZE_EXAMPLE_ASSISTANT,
  OPTIMIZE_EXAMPLE_USER,
  OPTIMIZE_SYSTEM_PROMPT,
} from "@/lib/prompts";
import {
  collectStream,
  createSseResponse,
  describeError,
} from "@/lib/stream-response";
import { extractYamlFromResponse } from "@/lib/yaml-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

interface RequestBody {
  yaml?: string;
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

  const { yaml, ollamaUrl, model, stream = true } = body;
  if (!yaml || !yaml.trim()) {
    return NextResponse.json({ error: "No YAML configuration provided" }, { status: 400 });
  }

  const call = {
    endpoint: ollamaUrl || "http://localhost:11434",
    model: model || "llama3",
    messages: [
      { role: "system" as const, content: OPTIMIZE_SYSTEM_PROMPT },
      { role: "user" as const, content: OPTIMIZE_EXAMPLE_USER },
      { role: "assistant" as const, content: OPTIMIZE_EXAMPLE_ASSISTANT },
      {
        role: "user" as const,
        content: `Optimize this Home Assistant Lovelace dashboard YAML.\n\n${yaml}`,
      },
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
