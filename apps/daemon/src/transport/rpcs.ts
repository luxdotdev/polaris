/**
 * The RPC group as the Daemon serves it: `DaemonRpcs` plus a server-only
 * middleware that gives every handler the `BlobChannel` of the connection the
 * request arrived on. Clients keep using `DaemonRpcs`; the middleware has no
 * client side, so the wire is unchanged.
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
import { DaemonRpcs } from "@polaris/protocol";
import { RpcMiddleware } from "effect/rpc";
import type { BlobChannel } from "../services.ts";

export class ConnectionBlobs extends RpcMiddleware.Service<
  ConnectionBlobs,
  { provides: BlobChannel }
>()("polaris/daemon/transport/ConnectionBlobs") {}

export const ServerRpcs = DaemonRpcs.middleware(ConnectionBlobs);

export type ServerRpcs = typeof ServerRpcs;
