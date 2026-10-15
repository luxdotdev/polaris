import type { CapabilityReport, PlacementInput, PredictionTarget } from "./types.ts";

export const capability = (
  ramGiB = 32,
  model = "mellum2-12b-a2.5b",
  chip = "Apple M2 Max"
): CapabilityReport => ({
  machine: {
    chip,
    cpuCores: 12,
    gpu: "Apple Silicon",
    gpuMemoryBytes: ramGiB * 1024 ** 3,
    unifiedMemory: true,
    ramBytes: ramGiB * 1024 ** 3,
    load: 7,
  },
  endpoints: [{ kind: "openai", url: "http://127.0.0.1:8080", models: [model] }],
});

export const input = (): PlacementInput => ({
  client: capability(),
  host: capability(),
  override: "auto",
});

export const target = (side: "client" | "host"): PredictionTarget => ({
  side,
  endpoint: capability().endpoints[0]!,
  model: "mellum2-12b-a2.5b",
  format: "mellum-spm",
  tier: 2,
  p50Ms: null,
  managed: false,
});
