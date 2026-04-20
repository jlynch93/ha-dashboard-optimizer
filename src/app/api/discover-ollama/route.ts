import { NextRequest, NextResponse } from "next/server";

interface OllamaInstance {
  url: string;
  models: string[];
  label: string;
}

async function probeOllama(
  url: string,
  label: string,
  timeoutMs = 3000
): Promise<OllamaInstance | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`${url}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      const data = await response.json();
      const models = (data.models || []).map(
        (m: { name: string }) => m.name
      );
      return { url, models, label };
    }
  } catch {
    // Connection failed - not available at this address
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const { additionalUrls } = await request.json().catch(() => ({}));

    // Common places Ollama might be running
    const candidates: { url: string; label: string }[] = [
      { url: "http://localhost:11434", label: "Localhost" },
      { url: "http://127.0.0.1:11434", label: "Loopback" },
      { url: "http://host.docker.internal:11434", label: "Docker Host" },
    ];

    // Add common LAN patterns
    const lanPrefixes = ["192.168.1", "192.168.0", "10.0.0", "10.0.1"];
    for (const prefix of lanPrefixes) {
      // Try common server IPs on each subnet
      for (const host of [1, 2, 5, 10, 50, 100, 200, 254]) {
        candidates.push({
          url: `http://${prefix}.${host}:11434`,
          label: `LAN (${prefix}.${host})`,
        });
      }
    }

    // Add user-provided URLs
    if (additionalUrls && Array.isArray(additionalUrls)) {
      for (const url of additionalUrls) {
        if (url && typeof url === "string") {
          candidates.push({ url: url.replace(/\/$/, ""), label: "Custom" });
        }
      }
    }

    // Probe all candidates in parallel with timeout
    const results = await Promise.all(
      candidates.map((c) => probeOllama(c.url, c.label, 2000))
    );

    const discovered = results.filter(Boolean) as OllamaInstance[];

    return NextResponse.json({ instances: discovered });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Discovery failed";
    return NextResponse.json({ error: message, instances: [] }, { status: 500 });
  }
}
