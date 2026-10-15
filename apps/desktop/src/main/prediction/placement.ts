import { LatencyRecorder, type LatencyStats } from "@polaris/predict";
import {
  PlacementController,
  editModelFormat,
  type CapabilityReport,
  type PredictionTarget,
  type PlacementInput,
} from "@polaris/client/prediction";
import { CapabilityProbe } from "@polaris/client/prediction/probe";
import { Effect } from "effect";
import type { PredictionEndpoint } from "@polaris/protocol";
import { HostDirectory, type ClientRuntime } from "../hosts.ts";
import { createManagedBridge } from "./managed.ts";
import type { PredictionSettings } from "./preferences.ts";

export interface PredictionLatency {
  record(endpoint: PredictionEndpoint, elapsedMs: number): void;
  p50(endpoint: PredictionEndpoint): number | null;
  stats(endpoint: PredictionEndpoint): LatencyStats | null;
}

interface PlacementPorts {
  readonly recorder?: () => PredictionLatency;
  readonly client: (hostKey: string) => Promise<CapabilityReport | null>;
  readonly host: (
    hostKey: string,
    signal: AbortSignal,
    mode?: PlacementInput["mode"]
  ) => Promise<CapabilityReport | null>;
  readonly preferences: PredictionSettings;
  readonly latency?: PlacementInput["latency"] | undefined;
}

/** Main-process authority: one transient placement machine for each Workspace's Host. */
export class MainPredictionPlacement {
  private readonly workspaces = new Map<string, PlacementController>();
  private readonly requests = new Map<string, AbortController>();
  private readonly hostLatencies = new Map<string, PredictionLatency>();
  private readonly clientLatency: PredictionLatency | null;
  constructor(private readonly ports: PlacementPorts) {
    this.clientLatency = ports.recorder?.() ?? null;
  }

  private controller(hostKey: string, workspaceId: string) {
    const key = JSON.stringify([hostKey, workspaceId]);
    let controller = this.workspaces.get(key);

    if (!controller) {
      controller = new PlacementController();
      this.workspaces.set(key, controller);
    }

    return controller;
  }

  invalidateAll() {
    for (const controller of this.workspaces.values()) controller.off();

    for (const request of this.requests.values()) request.abort();
  }

  invalidateHost(hostKey: string) {
    const prefix = `${JSON.stringify([hostKey]).slice(0, -1)},`;

    for (const [key, controller] of this.workspaces) {
      if (key.startsWith(prefix)) {
        controller.off();
        this.requests.get(key)?.abort();
      }
    }
  }

  /** Round trips through placement for this Host's side: what the status card reports. */
  latency(hostKey: string, side: PredictionTarget["side"], endpoint: PredictionEndpoint) {
    const recorder = side === "client" ? this.clientLatency : this.hostLatencies.get(hostKey);

    return recorder?.stats(endpoint) ?? null;
  }

  release(hostKey: string, workspaceId: string) {
    const key = JSON.stringify([hostKey, workspaceId]);
    this.workspaces.get(key)?.off();
    this.requests.get(key)?.abort();
    this.requests.delete(key);
    this.workspaces.delete(key);
  }

  async choose(
    hostKey: string,
    workspaceId: string,
    signal: AbortSignal,
    mode: PlacementInput["mode"] = "complete",
    preview = false
  ) {
    const controller = preview ? new PlacementController() : this.controller(hostKey, workspaceId);
    const preferences = this.ports.preferences.get(hostKey);

    if (preferences.placement === "off") {
      controller.off();

      return controller.state;
    }

    return controller.probe(async () => {
      const [client, host] = await Promise.all([
        this.ports.client(hostKey).catch(() => null),
        this.ports.host(hostKey, signal, mode).catch(() => null),
      ]);

      signal.throwIfAborted();

      return {
        mode,
        client,
        host,
        override: preferences.placement,
        model:
          mode === "complete" ? preferences.model : (preferences.editModel ?? preferences.model),
        format: mode !== "complete" && preferences.editModel !== null ? null : preferences.format,
        latency: (side, endpoint) =>
          this.ports.latency?.(side, endpoint) ??
          (side === "client"
            ? this.clientLatency?.p50(endpoint)
            : this.hostLatencies.get(hostKey)?.p50(endpoint)) ??
          null,
      };
    });
  }

  /** TUI supplies the LocalPredictor / Daemon stream consumer; Final remains authoritative. */
  async run<A>(
    hostKey: string,
    workspaceId: string,
    serve: (target: PredictionTarget, signal: AbortSignal) => Promise<A>,
    signal: AbortSignal,
    mode: PlacementInput["mode"] = "complete"
  ): Promise<A> {
    const key = JSON.stringify([hostKey, workspaceId]);
    this.requests.get(key)?.abort();
    const active = new AbortController();
    this.requests.set(key, active);
    const combined = AbortSignal.any([signal, active.signal]);

    try {
      await this.choose(hostKey, workspaceId, combined, mode);

      return await this.controller(hostKey, workspaceId).run(async (target) => {
        const start = performance.now();
        const result = await serve(target, combined);
        combined.throwIfAborted();
        let recorder = this.clientLatency;

        if (target.side === "host") {
          recorder = this.hostLatencies.get(hostKey) ?? this.ports.recorder?.() ?? null;

          if (recorder) this.hostLatencies.set(hostKey, recorder);
        }

        recorder?.record(target.endpoint, performance.now() - start);

        return result;
      }, combined);
    } finally {
      if (this.requests.get(key) === active) this.requests.delete(key);
    }
  }
}

export const createMainPredictionPlacement = (
  runtime: ClientRuntime,
  preferences: PredictionSettings,
  latency?: PlacementInput["latency"]
) => {
  const probe = new CapabilityProbe();

  const hostSession = Effect.fn("prediction.placement.session")(function* (hostKey: string) {
    const directory = yield* HostDirectory;
    const connection = yield* directory.connection(hostKey);

    return yield* connection.session;
  });

  const managed = createManagedBridge({ runtime, preferences, hostSession });

  return new MainPredictionPlacement({
    preferences,
    latency,
    recorder: () => new LatencyRecorder(),
    client: () => managed.clientCapability(probe),
    host: (hostKey, signal, mode) =>
      runtime.runPromise(
        HostDirectory.use((directory) =>
          Effect.gen(function* () {
            const connection = yield* directory.connection(hostKey);
            const session = yield* connection.session;

            if (!session.capabilities.includes("prediction.capability")) return null;

            const report = yield* session.client["prediction.capability"]({
              endpoints: preferences.get(hostKey).hostEndpoints.map((endpoint) => endpoint.url),
              modelsDir: preferences.get(hostKey).modelsDir,
              model: preferences.get(hostKey).managedModel,
            });

            if (mode === "complete" || session.capabilities.includes("prediction.edit"))
              return report;

            return {
              ...report,
              endpoints: report.endpoints.map((endpoint) => ({
                ...endpoint,
                models: endpoint.models.filter((model) => editModelFormat(model) === null),
              })),
            };
          })
        ),
        { signal }
      ),
  });
};
