import { type Capability, FileError, type HostInfo, Unsupported } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import type { UserAccessRegistry } from "../../userAccess/index.ts";

export type DefaultOptions = {
  readonly hostInfo: HostInfo;
  readonly capabilities: ReadonlyArray<Capability>;
  /** The Host's enrolled user keys (ADR 0114); `hello` presents each connection's key to it. */
  readonly userAccess: UserAccessRegistry;
};

export const notYet = (what: string) => `${what} is not available on this Daemon yet`;

export const fileError = (path: string, what: string) =>
  new FileError({ path, code: "ENOTSUP", message: notYet(what) });

/** A request that fails as `Unsupported` for `capability`. */
export const unsupported = (capability: string) => () =>
  Effect.fail(new Unsupported({ capability }));

/** A feed that fails as `Unsupported` for `capability`. */
export const unsupportedFeed = (capability: string) => () =>
  Stream.fail(new Unsupported({ capability }));
