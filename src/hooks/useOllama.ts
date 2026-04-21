"use client";

import { useCallback, useEffect, useState } from "react";
import type { OllamaInstance } from "@/lib/types";
import { useLocalStorage } from "./useLocalStorage";

interface UseOllamaResult {
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  model: string;
  setModel: (model: string) => void;
  availableModels: string[];
  discoveredInstances: OllamaInstance[];
  connected: boolean;
  discovering: boolean;
  discover: (options?: { scanLan?: boolean; includeCurrent?: boolean }) => Promise<void>;
  selectInstance: (instance: OllamaInstance) => void;
}

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3";

export function useOllama(): UseOllamaResult {
  const [ollamaUrl, setOllamaUrl] = useLocalStorage("ollamaUrl", DEFAULT_URL);
  const [model, setModel] = useLocalStorage("ollamaModel", DEFAULT_MODEL);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [discoveredInstances, setDiscoveredInstances] = useState<OllamaInstance[]>([]);
  const [connected, setConnected] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const discover = useCallback(
    async (options?: { scanLan?: boolean; includeCurrent?: boolean }) => {
      setDiscovering(true);
      try {
        const additionalUrls =
          options?.includeCurrent && ollamaUrl && ollamaUrl !== DEFAULT_URL ? [ollamaUrl] : undefined;
        const res = await fetch("/api/discover-ollama", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ additionalUrls, scanLan: options?.scanLan ?? false }),
        });
        const data = (await res.json()) as { instances?: OllamaInstance[] };
        const instances = data.instances ?? [];
        setDiscoveredInstances(instances);
        if (instances.length > 0) {
          // Prefer the currently-selected URL if it was found; otherwise take the first.
          const match = instances.find((i) => i.url === ollamaUrl) ?? instances[0];
          setOllamaUrl(match.url);
          setAvailableModels(match.models);
          setConnected(true);
          if (match.models.length > 0 && !match.models.includes(model)) {
            setModel(match.models[0]);
          }
        } else {
          setConnected(false);
        }
      } catch {
        setConnected(false);
      } finally {
        setDiscovering(false);
      }
    },
    [ollamaUrl, model, setOllamaUrl, setModel],
  );

  // Auto-probe local candidates once on mount (no LAN sweep). We defer to a
  // microtask so the initial `setDiscovering(true)` inside `discover` doesn't
  // fire synchronously inside the effect body (React 19's
  // react-hooks/set-state-in-effect rule).
  useEffect(() => {
    queueMicrotask(() => {
      void discover({ scanLan: false, includeCurrent: true });
    });
    // Intentionally run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectInstance = useCallback(
    (instance: OllamaInstance) => {
      setOllamaUrl(instance.url);
      setAvailableModels(instance.models);
      setConnected(true);
      if (instance.models.length > 0 && !instance.models.includes(model)) {
        setModel(instance.models[0]);
      }
    },
    [model, setOllamaUrl, setModel],
  );

  return {
    ollamaUrl,
    setOllamaUrl,
    model,
    setModel,
    availableModels,
    discoveredInstances,
    connected,
    discovering,
    discover,
    selectInstance,
  };
}
