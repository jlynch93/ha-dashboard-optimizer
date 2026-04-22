"use client";

import { useCallback, useRef, useState } from "react";
import type { AuditReport } from "@/lib/audit-types";
import type { HaSummary } from "@/lib/types";

export function useAuditJob() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<AuditReport | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setLoading(false);
    setError("");
    setReport(null);
  }, []);

  const run = useCallback(
    async (summary: HaSummary) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError("");
      setReport(null);

      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ summary }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Audit failed (${res.status})`);
        }

        const data = (await res.json()) as AuditReport;
        setReport(data);
        return { ok: true };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return { ok: false };
        }
        const message = err instanceof Error ? err.message : "Audit failed";
        setError(message);
        return { ok: false, error: message };
      } finally {
        setLoading(false);
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  return { loading, error, report, run, reset };
}
