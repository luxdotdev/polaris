/**
 * The managed model server as the Desktop App sees it (ADR 0049): the Client side is this
 * machine's local Daemon, the Host side the Workspace's Daemon. Both speak `prediction.managed`.
 */
import type { LiveSession } from "@polaris/client";
import type { CapabilityProbe } from "@polaris/client/prediction/probe";
import type {
  ManagedServerAction,
  ManagedServerStatus,
  PredictionCapability,
} from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { IpcError } from "../../shared/api.ts";
import type { ManagedSideInput } from "../../shared/predictionContract.ts";
import { type ClientServices, LOCAL_HOST_KEY, toIpcError, type ClientRuntime } from "../hosts.ts";
import type { PredictionSettings } from "./preferences.ts";

export interface ManagedPorts {
  readonly runtime: ClientRuntime;
  readonly preferences: PredictionSettings;
  readonly hostSession: (hostKey: string) => Effect.Effect<LiveSession, unknown, ClientServices>;
}

/** The Daemon that owns a side's managed server. */
export const managedHostKey = (input: ManagedSideInput) =>
  input.side === "client" ? LOCAL_HOST_KEY : input.hostKey;

export const createManagedBridge = ({ runtime, preferences, hostSession }: ManagedPorts) => {
  const request = (key: string, action: ManagedServerAction | null) =>
    Effect.flatMap(hostSession(key), (session) =>
      session.capabilities.includes("prediction.managed")
        ? session.client["prediction.managed"]({
            modelsDir: preferences.get(key).modelsDir,
            model: preferences.get(key).managedModel,
            action,
          })
        : Effect.succeed(null)
    );

  const status = (
    input: ManagedSideInput & { readonly action: ManagedServerAction | null }
  ): Promise<ManagedServerStatus | null> =>
    runtime.runPromise(request(managedHostKey(input), input.action));

  /** For the status card: an unreachable or old Daemon reads as "no managed server". */
  const inspect = (hostKey: string) =>
    Promise.all([
      status({ hostKey, side: "client", action: null }).catch(() => null),
      status({ hostKey, side: "host", action: null }).catch(() => null),
    ]).then(([client, host]) => ({ client, host }));

  /** Before a request to a managed endpoint: up, its idle clock reset; true when it had to load. */
  const ensure = (input: ManagedSideInput, signal: AbortSignal): Promise<boolean> =>
    runtime
      .runPromise(request(managedHostKey(input), "start"), { signal })
      .then((answer) => answer?.launched === true);

  const watch = (
    input: ManagedSideInput
  ): Stream.Stream<ManagedServerStatus, IpcError, ClientServices> => {
    const key = managedHostKey(input);

    return Stream.unwrap(
      Effect.map(hostSession(key), (session) =>
        session.capabilities.includes("prediction.managed")
          ? session.client["prediction.managed.watch"]({
              modelsDir: preferences.get(key).modelsDir,
              model: preferences.get(key).managedModel,
            })
          : Stream.empty
      )
    ).pipe(
      Stream.mapError((error) =>
        // SAFETY: session and RPC failures are tagged errors with a message; anything else is a defect.
        toIpcError(error as { readonly _tag: string; readonly message: string })
      )
    );
  };

  /** The Client side's report: the local Daemon's, which lists its managed server; else the in-process probe. */
  const clientCapability = (probe: Pick<CapabilityProbe, "get">): Promise<PredictionCapability> => {
    const endpoints = preferences.getClientEndpoints();

    return runtime
      .runPromise(
        Effect.flatMap(hostSession(LOCAL_HOST_KEY), (session) =>
          session.capabilities.includes("prediction.managed")
            ? session.client["prediction.capability"]({
                endpoints: endpoints.map((endpoint) => endpoint.url),
                modelsDir: preferences.get(LOCAL_HOST_KEY).modelsDir,
                model: preferences.get(LOCAL_HOST_KEY).managedModel,
              })
            : Effect.fail(new Error("no managed server"))
        )
      )
      .catch(() => probe.get(endpoints.map((endpoint) => ({ ...endpoint, models: [] }))));
  };

  return { status, inspect, ensure, watch, clientCapability };
};

export type ManagedBridge = ReturnType<typeof createManagedBridge>;
