import type {
  CommandId,
  HostResourcesSnapshot,
  ResourceLease,
  ResourceError,
  SessionId,
} from "@polaris/protocol";
import { Context, Effect, Layer, type Scope } from "effect";

export interface AcquireLease {
  readonly requestId: string;
  readonly name: string;
  readonly processId: number;
  readonly processIdentity: string;
  readonly command: ReadonlyArray<string>;
  readonly sessionId: SessionId | null;
}

export class HostResources extends Context.Service<
  HostResources,
  {
    readonly get: Effect.Effect<HostResourcesSnapshot>;
    readonly declare: (
      commandId: CommandId,
      name: string,
      capacity: number,
      holdLimitMs?: number
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly remove: (
      commandId: CommandId,
      name: string
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly release: (
      commandId: CommandId | null,
      leaseId: string
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly setWorkerCap: (
      commandId: CommandId,
      cap: number | null
    ) => Effect.Effect<HostResourcesSnapshot, ResourceError>;
    readonly acquire: (request: AcquireLease) => Effect.Effect<ResourceLease, ResourceError>;
    readonly acquireWorker: (
      sessionId: SessionId
    ) => Effect.Effect<void, ResourceError, Scope.Scope>;
  }
>()("polaris/daemon/resources/HostResources") {
  static readonly layer = Layer.unwrap(
    Effect.promise(() => import("./index.ts")).pipe(Effect.map((module) => module.resourcesLayer))
  );
}
