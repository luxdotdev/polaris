import { PredictionEndpointUrl } from "@polaris/protocol";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { cpus, loadavg, totalmem } from "node:os";
import { Option, Schema } from "effect";
import type { CapabilityReport, MachineFacts, ReachableEndpoint } from "./types.ts";

const OpenAIModels = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) });

const OllamaModels = Schema.Struct({
  models: Schema.Array(Schema.Struct({ name: Schema.String })),
});

export const DEFAULT_ENDPOINTS: ReadonlyArray<ReachableEndpoint> = [
  { kind: "openai", url: "http://127.0.0.1:8080", models: [] },
  { kind: "openai", url: "http://127.0.0.1:1234", models: [] },
  { kind: "ollama", url: "http://127.0.0.1:11434", models: [] },
];

const command = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: 1000, maxBuffer: 1048576, windowsHide: true },
      (error, stdout) => resolve(error ? "" : stdout.trim())
    );
  });

const linuxGpu = () => {
  if (existsSync("/dev/nvidiactl")) return "CUDA";

  if (existsSync("/dev/kfd")) return "ROCm";

  return null;
};

const linuxChip = (fallback: string) => {
  try {
    return readFileSync("/proc/device-tree/model", "utf8").replaceAll("\0", "").trim() || fallback;
  } catch {
    return fallback;
  }
};

/** Machine facts are sampled only when requested. GPU presence does not launch a model. */
export const machineFacts = async (): Promise<MachineFacts> => {
  const chip = cpus()[0]?.model ?? process.arch;
  const apple = process.platform === "darwin" && process.arch === "arm64";

  const appleChip = apple
    ? await command("/usr/sbin/sysctl", ["-n", "machdep.cpu.brand_string"])
    : "";

  return {
    chip: process.platform === "linux" ? linuxChip(chip) : appleChip || chip,
    cpuCores: Math.max(1, cpus().length),
    gpuMemoryBytes: apple ? totalmem() : null,
    gpu: apple ? "Apple Silicon" : process.platform === "linux" ? linuxGpu() : null,
    unifiedMemory: apple,
    ramBytes: totalmem(),
    load: process.platform === "win32" ? null : (loadavg()[0] ?? null),
  };
};

const baseUrl = (url: string) => url.replace(/\/(?:v1|api)\/?$/, "").replace(/\/$/, "");

export const probeEndpoint = async (
  endpoint: ReachableEndpoint,
  fetcher: typeof fetch = fetch
): Promise<ReachableEndpoint | null> => {
  try {
    if (Option.isNone(Schema.decodeUnknownOption(PredictionEndpointUrl)(endpoint.url))) return null;
    const url = new URL(baseUrl(endpoint.url));

    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;

    const response = await fetcher(
      `${url.href.replace(/\/$/, "")}/${endpoint.kind === "ollama" ? "api/tags" : "v1/models"}`,
      {
        signal: AbortSignal.timeout(1500),
        redirect: "error",
      }
    );

    if (!response.ok) return null;
    const payload: unknown = await response.json();

    const models =
      endpoint.kind === "ollama"
        ? Option.map(Schema.decodeUnknownOption(OllamaModels)(payload), (value) =>
            value.models.map((model) => model.name)
          )
        : Option.map(Schema.decodeUnknownOption(OpenAIModels)(payload), (value) =>
            value.data.map((model) => model.id)
          );

    return Option.match(models, {
      onNone: () => null,
      onSome: (models) => ({ ...endpoint, url: baseUrl(endpoint.url), models }),
    });
  } catch {
    return null;
  }
};

interface ProbeOptions {
  readonly facts?: () => Promise<MachineFacts>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

/** Briefly cached and coalesced; expiry is checked on demand, without a timer. */
export class CapabilityProbe {
  private readonly entries = new Map<
    string,
    { expiresAt: number; value: Promise<CapabilityReport> }
  >();
  private readonly options: ProbeOptions;

  constructor(options: ProbeOptions = {}) {
    this.options = options;
  }

  get(configured: ReadonlyArray<ReachableEndpoint> = []): Promise<CapabilityReport> {
    const endpoints = [
      ...new Map(
        [...DEFAULT_ENDPOINTS, ...configured].map((endpoint) => [
          `${endpoint.kind}:${baseUrl(endpoint.url)}`,
          endpoint,
        ])
      ).values(),
    ];

    const key = JSON.stringify(endpoints);
    const now = this.options.now?.() ?? Date.now();
    const cached = this.entries.get(key);

    if (cached && cached.expiresAt > now) return cached.value;

    const value = Promise.all([
      (this.options.facts ?? machineFacts)(),
      Promise.all(endpoints.map((endpoint) => probeEndpoint(endpoint, this.options.fetch))),
    ]).then(([facts, endpoints]) => ({
      machine: facts,
      endpoints: endpoints.filter((endpoint) => endpoint !== null),
    }));

    if (this.entries.size >= 16) this.entries.clear();
    this.entries.set(key, { expiresAt: now + (this.options.ttlMs ?? 5000), value });
    void value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });

    return value;
  }
}

/** Processes visible to this machine, reported outside the Desktop App's budget. */
export const modelServerPids = async (): Promise<ReadonlyArray<number>> => {
  const text = await command("ps", ["-axo", "pid=,comm="]);

  return text.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(?:.*\/)?(llama-server|ollama|llmster|LM Studio)(?:\s|$)/.exec(line);

    return match?.[1] ? [Number(match[1])] : [];
  });
};

export interface ModelServerResources {
  readonly rssBytes: number;
  readonly processes: number;
}

/** Includes each model-server descendant once; this sample has RSS, not physical footprint. */
export const modelServerResources = async (): Promise<ModelServerResources> => {
  const listing = await command("ps", ["-axo", "pid=,ppid=,rss=,comm="]);

  const rows = listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);

    return match
      ? [
          {
            pid: Number(match[1]),
            parent: Number(match[2]),
            rssBytes: Number(match[3]) * 1024,
            name: match[4] ?? "",
          },
        ]
      : [];
  });

  const selected = new Set(
    rows
      .filter((row) => /(?:^|\/)(?:llama-server|ollama|llmster|LM Studio)(?:\s|$)/.test(row.name))
      .map((row) => row.pid)
  );

  let previous = -1;

  while (selected.size !== previous) {
    previous = selected.size;

    for (const row of rows) if (selected.has(row.parent)) selected.add(row.pid);
  }

  return {
    rssBytes: rows
      .filter((row) => selected.has(row.pid))
      .reduce((sum, row) => sum + row.rssBytes, 0),
    processes: selected.size,
  };
};
