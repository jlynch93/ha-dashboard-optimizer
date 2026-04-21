"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Persist a single string value in `localStorage`. Uses `useSyncExternalStore`
 * so SSR returns `initial` and the client reads the stored value on mount
 * without triggering cascading renders. Writes in one tab propagate to other
 * components via a shared in-process listener set (the native `storage` event
 * only fires across windows).
 */

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function subscribeKey(key: string, listener: Listener): () => void {
  let bucket = listeners.get(key);
  if (!bucket) {
    bucket = new Set();
    listeners.set(key, bucket);
  }
  bucket.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    bucket!.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

function readKey(key: string, initial: string): string {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ?? initial;
  } catch {
    return initial;
  }
}

export function useLocalStorage(
  key: string,
  initial: string,
): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    (listener) => subscribeKey(key, listener),
    () => readKey(key, initial),
    () => initial,
  );

  const update = useCallback(
    (next: string) => {
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Ignore — storage unavailable.
      }
      notify(key);
    },
    [key],
  );

  return [value, update];
}
