import { type Attempt, type ResourceError } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { McpTokens, revokeMcpBindings } from "../mcp/index.ts";
import { HostResources } from "../resources/index.ts";
import { paths } from "../paths.ts";
import { ConstellationOwner, type ConstellationRuntimeService } from "./runtime.ts";
import { workingAttemptsLayer } from "./working.ts";

export interface HostWorkingAttemptHooks<E, R> {
  readonly runtime: ConstellationRuntimeService;
  /** The callback uses H's startWorker and commits the title/Turn through the Session machine. */
  readonly startWorker: (
    attempt: Attempt,
    environment: Readonly<WorkerEnvironment>
  ) => Effect.Effect<void, E, R>;
  readonly resumeWorker: (
    attempt: Attempt,
    environment: Readonly<WorkerEnvironment>
  ) => Effect.Effect<void, E, R>;
  readonly failed: (attempt: Attempt, error: E | ResourceError) => Effect.Effect<void, never, R>;
}

export interface WorkerEnvironment {
  POLARIS_HOST_SOCKET: string;
  POLARIS_SESSION_ID: string;
  POLARIS_BINARY?: string;
}

export const workerEnvironment = (attempt: Attempt): WorkerEnvironment => {
  const environment: WorkerEnvironment = {
    POLARIS_HOST_SOCKET: paths().socket,
    POLARIS_SESSION_ID: attempt.sessionId,
  };

  if (process.env.POLARIS_BINARY !== undefined)
    environment.POLARIS_BINARY = process.env.POLARIS_BINARY;

  return environment;
};

/** Capture Host services while retaining W/L's provisioning and Session-machine startup callbacks. */
export const hostWorkingAttemptsLayer = <E, R>(hooks: HostWorkingAttemptHooks<E, R>) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const hostId = yield* ConstellationOwner;
      const resources = yield* HostResources;
      const tokens = yield* McpTokens;
      const context = yield* Effect.context<R>();

      return workingAttemptsLayer<E | ResourceError>({
        runtime: hooks.runtime,
        ownsAttempt: (attempt) => attempt.hostId === hostId,
        acquireWorker: resources.acquireWorker,
        startWorker: (attempt) =>
          hooks.startWorker(attempt, workerEnvironment(attempt)).pipe(Effect.provide(context)),
        resumeWorker: (attempt) =>
          hooks.resumeWorker(attempt, workerEnvironment(attempt)).pipe(Effect.provide(context)),
        failed: (attempt, error) => hooks.failed(attempt, error).pipe(Effect.provide(context)),
        eventCommitted: (event) =>
          revokeMcpBindings(event).pipe(Effect.provideService(McpTokens, tokens), Effect.orDie),
      });
    })
  );
