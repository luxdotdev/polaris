/** Card inputs for every state, shared by the view model's tests and the `#completion-card` preview. */
import { ManagedServerPhase, type ManagedServerStatus } from "@polaris/protocol";
import { Predicate } from "effect";
import type { PredictionInspection } from "../../../../../shared/predictionContract.ts";
import type { PredictionMetrics } from "../../../../../shared/predictionOutcomes.ts";
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
  managed: { client: null, host: null },
};

export const EMPTY: PredictionInspection = {
  ...INSPECTION,
  client: { ...INSPECTION.client, endpoints: [] },
  host: { machine: machine(8, "Raspberry Pi 4 Model B Rev 1.4"), endpoints: [] },
};

export const phases = ManagedServerPhase.cases;

const SWEEP = {
  id: "sweep-next-edit-1.5b" as const,
  name: "Sweep Next-Edit 1.5B",
  sizeBytes: 1_537_269_856,
  serverBytes: 11_971_406,
  memoryBytes: 2_600_000_000,
};

const MANAGED_URL = "http://127.0.0.1:43210";

/** The Client's managed server in one phase, with Sweep as the model. */
export const managed = (
  phase: ManagedServerStatus["phase"],
  patch: Partial<ManagedServerStatus> = {}
): ManagedServerStatus => ({
  model: SWEEP,
  modelsDir: "/Users/lucas/.polaris/models",
  freeBytes: 211 * GiB,
  endpoint:
    Predicate.isTagged(phase, "Absent") || Predicate.isTagged(phase, "Unsupported")
      ? null
      : { kind: "openai", url: MANAGED_URL },
  phase,
  memoryBytes: Predicate.isTagged(phase, "Serving") ? 2_480_000_000 : null,
  loadMs: Predicate.isTagged(phase, "Serving") ? 61_000 : null,
  ...patch,
});

/** No server of the user's own anywhere; the Client's Daemon can run one. */
export const withManaged = (status: ManagedServerStatus): PredictionInspection => ({
  ...EMPTY,
  client: {
    ...EMPTY.client,
    endpoints:
      status.endpoint === null
        ? []
        : [{ ...status.endpoint, models: ["sweep-next-edit-1.5b-q8_0"], managed: true }],
  },
  managed: { client: status, host: null },
});

export const SETUP_SCENES: ReadonlyArray<readonly [string, PredictionInspection]> = [
  ["setup", withManaged(managed(phases.Absent.make({})))],
  [
    "downloading",
    withManaged(
      managed(
        phases.Downloading.make({
          file: "model",
          receivedBytes: 640_000_000,
          totalBytes: SWEEP.sizeBytes,
        })
      )
    ),
  ],
  ["verifying", withManaged(managed(phases.Verifying.make({})))],
  ["loading", withManaged(managed(phases.Starting.make({})))],
  ["managed-ready", withManaged(managed(phases.Stopped.make({})))],
  ["managed-serving", withManaged(managed(phases.Serving.make({})))],
  [
    "no-space",
    withManaged(
      managed(
        phases.Failed.make({ reason: "no-space", message: "Needs 2 GB; 1.4 GB is free", log: [] }),
        { freeBytes: 1.4 * GiB }
      )
    ),
  ],
  [
    "download-failed",
    withManaged(
      managed(
        phases.Failed.make({
          reason: "download-failed",
          message: "The publisher answered HTTP 503",
          log: [],
        })
      )
    ),
  ],
  [
    "checksum-mismatch",
    withManaged(
      managed(
        phases.Failed.make({
          reason: "checksum-mismatch",
          message: "sweep-next-edit-1.5b.q8_0.v2.gguf didn't match its published checksum",
          log: [],
        })
      )
    ),
  ],
  [
    "server-failed",
    withManaged(
      managed(
        phases.Failed.make({
          reason: "server-failed",
          message: "Sweep Next-Edit 1.5B exited with 1",
          log: [
            "ggml_metal_init: loading 'default.metallib'",
            "llama_model_load: error loading model",
            "error: unable to allocate Metal buffer",
          ],
        })
      )
    ),
  ],
  ["too-small", withManaged(managed(phases.Unsupported.make({ reason: "too-small" })))],
];

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
  memory: "On this Mac: llama-server 9.4 GB · counted apart from Polaris",
  metrics: null,
};

/** A log with 200 shown predictions behind it (spec §8). */
export const METRICS: PredictionMetrics = {
  shown: 412,
  accepted: 140,
  acceptanceWindow: 200,
  acceptanceRate: 0.34,
  keystrokes: 9810,
  shownPer100Keystrokes: 4.2,
  undoneWithin30s: 4,
  undoneRate: 0.03,
  countsByKind: { insert: 300, replace: 80, delete: 20, import: 8, jump: 4 },
};

const SWEEP_SERVED = {
  ...SERVED,
  model: "sweep-next-edit-1.5b-q8_0",
  endpoint: { kind: "openai" as const, url: MANAGED_URL },
};

/** One input per reachable state, in the order the preview lays them out. */
export const SCENES: ReadonlyArray<readonly [string, CardInput]> = [
  ["serving", { ...BASE, result: SERVED }],
  ["insertion-only", { ...BASE, result: SERVED, metrics: METRICS }],
  [
    "next-edit",
    {
      ...BASE,
      hostName: "Mac Studio",
      inspection: withManaged(managed(phases.Serving.make({}))),
      result: SWEEP_SERVED,
      server: null,
      memory: null,
      metrics: METRICS,
    },
  ],
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
  ...SETUP_SCENES.map(
    ([name, inspection]) =>
      [
        name,
        {
          ...BASE,
          hostName: "Mac Studio",
          inspection,
          server: null,
          memory: null,
          result: name === "managed-serving" ? SWEEP_SERVED : undefined,
        },
      ] as const
  ),
];

/** 28 models on two servers: long tags, a duplicate across them, quantisation suffixes. */
const MANY_MODELS = [
  MELLUM,
  QWEN,
  "qwen3-coder-30b-a3b-instruct-ud-q4_k_xl",
  "qwen2.5-coder-32b-instruct-128k-gguf-q8_0",
  "deepseek-coder-v2-lite-instruct-q5_k_m",
  "codestral-22b-v0.1-q4_k_m",
  "starcoder2-15b-instruct-v0.1-q6_k",
  "granite-code-34b-instruct-8k-q4_0",
  "zeta-1.5b-next-edit-preview-2026-09",
  "sweep-next-edit-1.5b-q8_0",
  ...Array.from(
    { length: 18 },
    (_, i) => `hf.co/bartowski/model-${i + 1}-coder-7b-instruct-GGUF:Q4_K_M`
  ),
];

const MANY: PredictionInspection = {
  ...INSPECTION,
  client: {
    ...INSPECTION.client,
    endpoints: [endpoint("http://127.0.0.1:8080", ...MANY_MODELS.slice(0, 14))],
  },
  host: {
    machine: machine(512, "AMD Ryzen Threadripper PRO 7995WX 96-Cores"),
    endpoints: [
      endpoint("http://build-farm-eu-west-2.internal.example.com:11434/v1", ...MANY_MODELS),
    ],
  },
};

const LONG_HOST = "build-farm-eu-west-2.internal.example.com";

/** Worst cases for the break-UI pass (ENG-499): many models, no models, long names and figures. */
export const WORST_SCENES: ReadonlyArray<readonly [string, CardInput]> = [
  ["many-models", { ...BASE, hostName: LONG_HOST, inspection: MANY, result: SERVED }],
  [
    "many-models-huge",
    {
      ...BASE,
      hostName: LONG_HOST,
      inspection: MANY,
      result: {
        ...SERVED,
        model: "hf.co/bartowski/model-18-coder-7b-instruct-GGUF:Q4_K_M",
        machine: LONG_HOST,
        side: "host",
        endpoint: {
          kind: "openai",
          url: "http://build-farm-eu-west-2.internal.example.com:11434/v1",
        },
        elapsedMs: 12_840,
        latency: { p50: 9_876, last: 12_840, count: 1_284_000 },
        context: { pieces: 1284, languageServer: 312, tokens: 1_048_576 },
      },
      metrics: {
        ...METRICS,
        shown: 1_284_000,
        accepted: 999_999,
        keystrokes: 98_765_432,
        undoneWithin30s: 12_345,
      },
      memory:
        "On build-farm-eu-west-2.internal.example.com: llama-server 412.8 GB · counted apart from Polaris",
    },
  ],
  ["no-models", { ...BASE, hostName: LONG_HOST, inspection: EMPTY }],
  ["no-models-offline", { ...BASE, hostName: LONG_HOST, inspection: EMPTY, connection: "offline" }],
  [
    "failed-long",
    {
      ...BASE,
      hostName: LONG_HOST,
      result: SERVED,
      failure:
        "Completion endpoint http://build-farm-eu-west-2.internal.example.com:11434/v1/completions returned HTTP 413: request entity too large (prompt of 1048576 tokens exceeds n_ctx_slot 32768)",
    },
  ],
  [
    "one-model",
    {
      ...BASE,
      inspection: {
        ...INSPECTION,
        client: { ...INSPECTION.client, endpoints: [endpoint("http://127.0.0.1:8080", QWEN)] },
      },
      result: { ...SERVED, model: QWEN },
    },
  ],
];
