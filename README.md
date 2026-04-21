# HA Dashboard Optimizer

A Next.js app that uses a **local Llama model (via [Ollama](https://ollama.ai/))** to generate or optimize [Home Assistant Lovelace](https://www.home-assistant.io/dashboards/) dashboard YAML based on your real entities. No cloud inference — everything runs on your network.

## Features

- **Generate from Home Assistant** — connects to your HA instance with a long-lived access token, fetches every entity/area/domain, and produces a multi-view Lovelace dashboard tailored to it.
- **Optimize existing YAML** — drop in any lovelace YAML and get a cleaner, grouped version back.
- **Auto-discovery** — probes common localhost/Docker/LAN addresses for running Ollama servers and lists the models each one has available.
- **Streaming output** — tokens appear in the output pane as the model emits them, and a **Cancel** button aborts a long generation.
- **YAML validation** — every response is parsed with `js-yaml`; a badge shows view/card counts or flags a parse error.
- **Local-first** — Ollama URL, model and HA URL are stored in `localStorage`; the long-lived access token is kept in memory only.

## Architecture

```
src/
├─ app/
│  ├─ page.tsx                ← thin composition root
│  ├─ layout.tsx
│  └─ api/
│     ├─ discover-ollama/     ← probes candidates with short timeouts
│     ├─ ha-entities/         ← pulls states/areas/config from HA
│     ├─ generate-dashboard/  ← SSE-streamed Ollama chat (generate)
│     └─ optimize/            ← SSE-streamed Ollama chat (optimize)
├─ components/                ← presentational pieces (Header, OutputPanel, …)
├─ hooks/                     ← useOllama, useHomeAssistant, useDashboardJob, useLocalStorage
└─ lib/
   ├─ ollama.ts               ← fetch wrapper + NDJSON streaming generator
   ├─ sse.ts                  ← Server-Sent-Events parser for the client
   ├─ prompts.ts              ← system prompts + few-shot examples
   ├─ ha.ts                   ← HA summary → prompt
   ├─ yaml-extract.ts         ← pulls `views:` YAML out of free-form LLM output
   ├─ yaml-validate.ts        ← js-yaml parse + view/card tally
   └─ types.ts
```

API routes proxy the long-lived Ollama and HA requests so the browser never holds an open connection to your LAN; they return NDJSON-derived SSE frames (`event: chunk`, `event: done`, `event: error`) to the client.

## Getting Started

### Prerequisites

- [Node.js 20+](https://nodejs.org/) (Next 16 requires it)
- [Ollama](https://ollama.ai/) running somewhere on your network, with at least one chat model pulled:
  ```bash
  ollama pull llama3
  ```
- A [Home Assistant](https://www.home-assistant.io/) instance with a [long-lived access token](https://www.home-assistant.io/docs/authentication/#your-account-profile) (only needed for the **Generate** mode).

### Install & run

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Run the production build |
| `npm run lint` | ESLint |

## Privacy

- The HA **long-lived access token** is kept in React state only. It is posted once to `/api/ha-entities` to fetch your entities and never persisted.
- The entity list sent to Ollama is capped per-domain (default 50) to keep the prompt bounded; the UI surfaces when truncation happens.
- All LLM traffic goes to the Ollama server you pick — no third-party calls.

## License

MIT.

