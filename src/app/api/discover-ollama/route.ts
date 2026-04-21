import { NextRequest, NextResponse } from "next/server";
import type { OllamaInstance } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Candidate {
  url: string;
  label: string;
}

interface RequestBody {
  /** Additional URLs the user wants to probe. */
  additionalUrls?: string[];
  /** If true, also scan the common LAN IPs. Default false. */
  scanLan?: boolean;
}

const LOCAL_CANDIDATES: Candidate[] = [
  { url: "http://localhost:11434", label: "Localhost" },
  { url: "http://127.0.0.1:11434", label: "Loopback" },
  { url: "http://host.docker.internal:11434", label: "Docker Host" },
];

const LAN_PREFIXES = ["192.168.1", "192.168.0", "10.0.0", "10.0.1"];
const LAN_HOSTS = [1, 2, 5, 10, 50, 100, 200, 254];

function buildLanCandidates(): Candidate[] {
  const out: Candidate[] = [];
  for (const prefix of LAN_PREFIXES) {
    for (const host of LAN_HOSTS) {
      out.push({ url: `http://${prefix}.${host}:11434`, label: `LAN (${prefix}.${host})` });
    }
  }
  return out;
}

async function probe(
  candidate: Candidate,
  timeoutMs: number,
): Promise<OllamaInstance | null> {
  try {
    const response = await fetch(`${candidate.url}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (data.models ?? []).map((m) => m.name);
    return { url: candidate.url, models, label: candidate.label };
  } catch {
    // Unreachable — not an Ollama here.
    return null;
  }
}

export async function POST(request: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    // Empty body is allowed.
  }

  const candidates: Candidate[] = [...LOCAL_CANDIDATES];
  if (body.scanLan) candidates.push(...buildLanCandidates());
  if (Array.isArray(body.additionalUrls)) {
    for (const url of body.additionalUrls) {
      if (typeof url === "string" && url.trim()) {
        candidates.push({ url: url.replace(/\/$/, ""), label: "Custom" });
      }
    }
  }

  // De-duplicate by URL so user-supplied entries don't double-probe the defaults.
  const seen = new Set<string>();
  const uniq = candidates.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // Shorter timeout for the wide LAN sweep, longer for targeted checks.
  const timeout = body.scanLan ? 1500 : 2500;
  const results = await Promise.all(uniq.map((c) => probe(c, timeout)));
  const instances = results.filter((r): r is OllamaInstance => r !== null);
  return NextResponse.json({ instances });
}
