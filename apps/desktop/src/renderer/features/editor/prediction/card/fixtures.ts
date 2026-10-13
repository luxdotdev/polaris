/** Card inputs for every state, shared by the view model's tests and the `#completion-card` preview. */
import type { PredictionInspection } from "../../../../../shared/predictionContract.ts";
import { DEFAULT_PREDICTION_PREFERENCES } from "../../../../../shared/predictionPlacement.ts";
import type { CardInput } from "./model.ts";

const GiB = 1024 ** 3;

const MELLUM = "mellum2-12b-a2.5b-q4_k_m";

const OLLAMA_MELLUM = "mellum2-12b-a2.5b:q4";

const QWEN = "qwen2.5-coder-1.5b";

const machine = (ramGiB: number, chip: string) => ({
  chip,
  cpuCores: 8,
  ramBytes: ramGiB * GiB,
  gpu: null,
  gpuMemoryBytes: null,
  unifiedMemory: true,
  load: null,
});

const endpoint = (url: string, ...models: string[]) => ({ kind: "openai" as const, url, models });

export const INSPECTION: PredictionInspection = {
  clientLabel: "This Mac",
  hostLabel: "Mac Studio",
  client: {
    machine: machine(36, "Apple M3 Pro"),
    endpoints: [endpoint("http://127.0.0.1:8080", MELLUM, QWEN, "qwen3-coder-30b-a3b")],
  },
  host: { machine: machine(8, "Raspberry Pi 4 Model B Rev 1.4"), endpoints: [] },
  offer: false,
};

export const EMPTY: PredictionInspection = {
  ...INSPECTION,
  client: { ...INSPECTION.client, endpoints: [] },
  host: { machine: machine(8, "Raspberry Pi 4 Model B Rev 1.4"), endpoints: [] },
};

export const SERVED = {
  model: MELLUM,
  machine: "This Mac",
  elapsedMs: 412,
  side: "client" as const,
  endpoint: { kind: "openai" as const, url: "http://127.0.0.1:8080" },
  latency: { p50: 438, last: 412, count: 12 },
  context: { pieces: 6, languageServer: 2, tokens: 1240 },
};

export const BASE: CardInput = {
  connection: "connected",
  hostName: "Pi 4",
  hostKey: "pi",
  enabled: true,
  offer: false,
  preferences: DEFAULT_PREDICTION_PREFERENCES,
  inspection: INSPECTION,
  result: undefined,
  failure: undefined,
  trusted: true,
  server: { kind: "llama-server", actions: ["clear-cache"], outcome: null },
  memory: "Model server on this Mac · 9.4 GB of memory, counted apart from Polaris",
};

/** One input per reachable state, in the order the preview lays them out. */
export const SCENES: ReadonlyArray<readonly [string, CardInput]> = [
  ["serving", { ...BASE, result: SERVED }],
  ["ready", { ...BASE, trusted: false }],
  ["failed", { ...BASE, result: SERVED, failure: "Completion endpoint returned HTTP 503" }],
  [
    "serving-ollama",
    {
      ...BASE,
      hostName: "Mac Studio",
      inspection: {
        ...INSPECTION,
        client: { ...INSPECTION.client, endpoints: [] },
        host: {
          machine: machine(128, "Apple M2 Ultra"),
          endpoints: [{ kind: "ollama", url: "http://10.0.0.12:11434", models: [OLLAMA_MELLUM] }],
        },
      },
      result: {
        ...SERVED,
        model: OLLAMA_MELLUM,
        machine: "Mac Studio",
        side: "host",
        endpoint: { kind: "ollama", url: "http://10.0.0.12:11434" },
        latency: { p50: 186, last: 171, count: 31 },
        context: { pieces: 3, languageServer: 0, tokens: 640 },
      },
      server: { kind: "ollama", actions: ["reload-model"], outcome: null },
      memory: null,
    },
  ],
  ["unknown-server", { ...BASE, server: { kind: "unknown", actions: [], outcome: null } }],
  ["finding", { ...BASE, inspection: undefined }],
  ["no-server", { ...BASE, inspection: EMPTY }],
  ["off", { ...BASE, enabled: false }],
  ["off-host", { ...BASE, preferences: { ...DEFAULT_PREDICTION_PREFERENCES, placement: "off" } }],
  ["offer", { ...BASE, enabled: false, offer: true }],
  ["offline", { ...BASE, connection: "offline" }],
  ["reconnecting", { ...BASE, connection: "reconnecting" }],
];
