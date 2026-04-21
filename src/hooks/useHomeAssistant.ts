"use client";

import { useCallback, useState } from "react";
import type { HaSummary } from "@/lib/types";
import { useLocalStorage } from "./useLocalStorage";

interface UseHomeAssistantResult {
  haUrl: string;
  setHaUrl: (url: string) => void;
  haToken: string;
  setHaToken: (token: string) => void;
  summary: HaSummary | null;
  connected: boolean;
  loading: boolean;
  error: string;
  connect: () => Promise<void>;
}

export function useHomeAssistant(): UseHomeAssistantResult {
  // Persist the URL (public) but NOT the token (sensitive).
  const [haUrl, setHaUrl] = useLocalStorage("haUrl", "");
  const [haToken, setHaToken] = useState("");
  const [summary, setSummary] = useState<HaSummary | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const connect = useCallback(async () => {
    if (!haUrl || !haToken) {
      setError("Please provide both the Home Assistant URL and access token.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ha-entities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ haUrl, haToken }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Failed to connect to Home Assistant");
      }
      const data = (await res.json()) as { summary: HaSummary };
      setSummary(data.summary);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setConnected(false);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [haUrl, haToken]);

  return {
    haUrl,
    setHaUrl,
    haToken,
    setHaToken,
    summary,
    connected,
    loading,
    error,
    connect,
  };
}
