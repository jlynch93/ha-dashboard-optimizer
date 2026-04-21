// Thin wrapper around the Ollama HTTP API with timeouts, streaming and
// friendly error messages.

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OllamaChatOptions {
  endpoint: string;
  model: string;
  messages: OllamaMessage[];
  signal?: AbortSignal;
  /** Overall request timeout in milliseconds. Default 10 minutes. */
  timeoutMs?: number;
  /** Passed straight through to Ollama's `options` field. */
  options?: Record<string, unknown>;
}

export class OllamaError extends Error {
  readonly status: number;
  readonly endpoint: string;
  constructor(message: string, status: number, endpoint: string) {
    super(message);
    this.name = "OllamaError";
    this.status = status;
    this.endpoint = endpoint;
  }
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Combine an upstream AbortSignal with an internal timeout signal.
 * `AbortSignal.any` exists in Node 20+ which Next 16 requires.
 */
function composeSignal(timeoutMs: number, upstream?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!upstream) return timeout;
  // `any` is available in Node 20 and all modern browsers.
  return AbortSignal.any([timeout, upstream]);
}

export async function ollamaChat(opts: OllamaChatOptions): Promise<string> {
  const {
    endpoint,
    model,
    messages,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    options,
  } = opts;

  const response = await fetchOllama(endpoint, "/api/chat", {
    model,
    messages,
    stream: false,
    options,
  }, composeSignal(timeoutMs, signal));

  const data = await response.json();
  return data.message?.content ?? "";
}

/**
 * Stream chat completions from Ollama, yielding each content chunk as it
 * arrives. The final string is the full concatenated content.
 */
export async function* ollamaChatStream(opts: OllamaChatOptions): AsyncGenerator<string, string, void> {
  const {
    endpoint,
    model,
    messages,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    options,
  } = opts;

  const response = await fetchOllama(endpoint, "/api/chat", {
    model,
    messages,
    stream: true,
    options,
  }, composeSignal(timeoutMs, signal));

  if (!response.body) {
    throw new OllamaError("Ollama returned no response body", 502, endpoint);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Ollama emits newline-delimited JSON.
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const chunk = obj.message?.content;
          if (chunk) {
            full += chunk;
            yield chunk;
          }
        } catch {
          // Ignore malformed lines; Ollama occasionally sends keep-alives.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}

async function fetchOllama(
  endpoint: string,
  path: string,
  body: unknown,
  signal: AbortSignal
): Promise<Response> {
  const base = endpoint.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OllamaError("Ollama request was cancelled or timed out", 504, base);
    }
    if (err instanceof TypeError && /fetch failed/i.test(err.message)) {
      throw new OllamaError(
        `Could not connect to Ollama at ${base}. Make sure it is running and reachable.`,
        503,
        base,
      );
    }
    throw err;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OllamaError(describeOllamaError(response.status, text, base), response.status, base);
  }
  return response;
}

function describeOllamaError(status: number, body: string, endpoint: string): string {
  if (status === 404) {
    // Common when the model isn't pulled yet. The model name is embedded in the body.
    return `Model not found on ${endpoint}. Pull it first: ollama pull <model>`;
  }
  const snippet = body.trim().slice(0, 240);
  return `Ollama error (${status}) from ${endpoint}${snippet ? `: ${snippet}` : ""}`;
}
