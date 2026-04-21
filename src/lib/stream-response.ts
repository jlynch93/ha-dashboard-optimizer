// Shared plumbing for the two streaming routes (generate + optimize). Wraps
// the Ollama streaming generator in an SSE response with well-defined event
// types and consistent error handling.

import { OllamaError, ollamaChatStream, type OllamaMessage } from "./ollama";
import { extractYamlFromResponse } from "./yaml-extract";

interface StreamOptions {
  endpoint: string;
  model: string;
  messages: OllamaMessage[];
  options?: Record<string, unknown>;
  signal: AbortSignal;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store, no-transform",
  Connection: "keep-alive",
  // Prevents nginx/compression proxies from buffering SSE frames.
  "X-Accel-Buffering": "no",
} as const;

/** Encode a single SSE frame. */
function frame(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

export function createSseResponse(opts: StreamOptions): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(frame(event, data));
      };
      try {
        let full = "";
        for await (const chunk of ollamaChatStream(opts)) {
          full += chunk;
          send("chunk", { content: chunk });
        }
        send("done", extractYamlFromResponse(full));
      } catch (err) {
        const { message, status } = describeError(err);
        send("error", { message, status });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(body, { headers: SSE_HEADERS });
}

export async function collectStream(opts: StreamOptions): Promise<string> {
  let full = "";
  for await (const chunk of ollamaChatStream(opts)) {
    full += chunk;
  }
  return full;
}

export function describeError(err: unknown): { message: string; status: number } {
  if (err instanceof OllamaError) return { message: err.message, status: err.status };
  if (err instanceof Error) return { message: err.message, status: 500 };
  return { message: "Internal server error", status: 500 };
}
