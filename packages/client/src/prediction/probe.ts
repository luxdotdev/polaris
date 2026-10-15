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
  /** Each model server's process tree, by the executable's name, largest first. */
  readonly servers: ReadonlyArray<{ readonly name: string; readonly rssBytes: number }>;
}

export interface ProcessRow {
  readonly pid: number;
  readonly parent: number;
  readonly rssBytes: number;
  readonly name: string;
}

const SERVER_NAME = /(?:^|\/)(?:llama-server|ollama|llmster|LM Studio)(?:\s|$)/;

/** Folds a process listing into one entry per model server: Ollama's runners count under Ollama. */
export const foldModelServers = (rows: ReadonlyArray<ProcessRow>): ModelServerResources => {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const candidates = new Set(rows.flatMap((row) => (SERVER_NAME.test(row.name) ? [row.pid] : [])));

  // The outermost server process owns the tree: a llama-server under ollama is Ollama's.
  const rootOf = (pid: number): number | null => {
    let root: number | null = null;
    let current = byPid.get(pid);

    for (let depth = 0; current !== undefined && depth < 64; depth++) {
      if (candidates.has(current.pid)) root = current.pid;
      current = byPid.get(current.parent);
    }

    return root;
  };

  const trees = new Map<number, number>();

  for (const row of rows) {
    const root = rootOf(row.pid);

    if (root !== null) trees.set(root, (trees.get(root) ?? 0) + row.rssBytes);
  }

  const servers = [...trees]
    .map(([pid, rssBytes]) => ({
      name: (byPid.get(pid)?.name ?? "").replace(/^.*\//, "").replace(/\s.*$/, ""),
      rssBytes,
    }))
    .sort((a, b) => b.rssBytes - a.rssBytes);

  return {
    rssBytes: servers.reduce((sum, server) => sum + server.rssBytes, 0),
    processes: servers.length,
    servers,
  };
};

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

  return foldModelServers(rows);
};
