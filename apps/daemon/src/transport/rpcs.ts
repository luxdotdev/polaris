/**
 * The RPC group as the Daemon serves it: `DaemonRpcs` behind the Grant gate,
 * plus a server-only middleware that gives every handler the `BlobChannel` of
 * the connection the request arrived on. Clients keep using `DaemonRpcs`; the
 * middlewares have no client side, so the wire is unchanged.
 *
 * Handler modules build their layers from `ServerRpcs`, e.g.
 *
 *   export const ReadFileLive = ServerRpcs.toLayerHandler("files.read", (req) =>
 *     Effect.gen(function* () {
 *       const blobs = yield* BlobChannel
 *       ...
 *     }))
 *
 * and `serve` composes them in one place (see `server.ts`).
 */
import {
  ExtensionDaemonRpcs,
  ExtensionTokenRejected,
  GrantGate,
  Hello,
  LanguageIdentityError,
  ProtocolMismatch,
  NotGranted,
  ShareGate,
  StatementRejected,
} from "@polaris/protocol";
import { Schema } from "effect";
import { RpcMiddleware } from "effect/rpc";
import type { BlobChannel } from "../services.ts";
import type { CurrentLanguageConnection } from "./currentLanguageConnection.ts";
import type { LanguageConnectionLifetime } from "./languageConnectionLifetime.ts";
import type { ConnectionActor } from "./actor.ts";

export class ConnectionBlobs extends RpcMiddleware.Service<
  ConnectionBlobs,
  {
    provides:
      | BlobChannel
      | CurrentLanguageConnection
      | LanguageConnectionLifetime
      | ConnectionActor;
  }
>()("polaris/daemon/transport/ConnectionBlobs", { error: NotGranted }) {}

/** `hello` as the Daemon serves it: a Teammate's can also fail with `StatementRejected` (ADR 0112). */
export const ServerHello = Hello.setError(
  Schema.Union([LanguageIdentityError, ExtensionTokenRejected, ProtocolMismatch, StatementRejected])
);

/**
 * Every RPC also passes the Grant gate (`extensions/connection.ts`), the user gate
 * (`userAccess.ts`) and the Share gate (`shares/gate.ts`), which scopes a Teammate's connection.
 */
export const ServerRpcs = ExtensionDaemonRpcs.omit("hello")
  .add(ServerHello.middleware(GrantGate))
  .middleware(ShareGate)
  .middleware(ConnectionBlobs);

export type ServerRpcs = typeof ServerRpcs;
