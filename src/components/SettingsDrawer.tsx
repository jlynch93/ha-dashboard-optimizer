"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { HomeAssistantConfig } from "./HomeAssistantConfig";
import { OllamaConfig } from "./OllamaConfig";
import type { HaSummary, OllamaInstance } from "@/lib/types";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;

  // Ollama props
  ollamaUrl: string;
  setOllamaUrl: (url: string) => void;
  model: string;
  setModel: (model: string) => void;
  availableModels: string[];
  discoveredInstances: OllamaInstance[];
  discovering: boolean;
  onDiscover: (options: { scanLan: boolean; includeCurrent: boolean }) => void;
  onSelectInstance: (instance: OllamaInstance) => void;

  // HA props
  haUrl: string;
  setHaUrl: (url: string) => void;
  haToken: string;
  setHaToken: (token: string) => void;
  haConnected: boolean;
  haLoading: boolean;
  haSummary: HaSummary | null;
  onHaConnect: () => void;
}

export function SettingsDrawer(props: SettingsDrawerProps) {
  const { open, onClose } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Esc to close, plus focus first field on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock body scroll while the drawer is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Defer focus to after the open animation starts.
    const focusTimer = window.setTimeout(() => firstInputRef.current?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-slate-950/60 backdrop-blur-sm transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-xl bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-transform duration-200 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div>
            <h2 id="settings-title" className="text-base font-semibold">
              Settings
            </h2>
            <p className="text-xs text-slate-400">
              Connect Ollama and Home Assistant. Press Esc to close.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-700/50 transition-colors"
            aria-label="Close settings"
          >
            <X className="w-5 h-5 text-slate-300" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <OllamaConfig
            ollamaUrl={props.ollamaUrl}
            setOllamaUrl={props.setOllamaUrl}
            model={props.model}
            setModel={props.setModel}
            availableModels={props.availableModels}
            discoveredInstances={props.discoveredInstances}
            discovering={props.discovering}
            onDiscover={props.onDiscover}
            onSelectInstance={props.onSelectInstance}
            firstInputRef={firstInputRef}
          />
          <HomeAssistantConfig
            haUrl={props.haUrl}
            setHaUrl={props.setHaUrl}
            haToken={props.haToken}
            setHaToken={props.setHaToken}
            connected={props.haConnected}
            loading={props.haLoading}
            summary={props.haSummary}
            onConnect={props.onHaConnect}
          />
        </div>
      </aside>
    </>
  );
}
