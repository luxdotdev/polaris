/**
 * `@polaris/sdk` for Node and Bun: pairings with a `url` reach the gateway over
 * a WebSocket, local ones (`url` null) the Daemon's Unix socket.
 */
import { Effect, type Scope } from "effect";
import { openPolaris as openPolarisWith, type Polaris, type PolarisOptions } from "./client.ts";
import type { OpenTransport } from "./connection.ts";
import type { InvalidPairing } from "./pairing.ts";
import { createPolarisWith, type PolarisClient } from "./promise.ts";
import { defaultSocketPath, socketTransport } from "./transport/socket.ts";
import { webSocketTransport } from "./transport/websocket.ts";

export * from "./api.ts";

export { defaultSocketPath, socketTransport } from "./transport/socket.ts";

/** The socket for local pairings, the gateway for the others. */
export const openTransport: OpenTransport = (pairing) =>
  pairing.url === null
    ? socketTransport(defaultSocketPath(), pairing.hostId)
    : webSocketTransport(pairing.url, pairing.hostId);

/** The Effect API: a client whose connections close with the Scope. */
export const openPolaris = (
  options: PolarisOptions
): Effect.Effect<Polaris, InvalidPairing, Scope.Scope> => openPolarisWith(options, openTransport);

/** The plain API. Rejects with `InvalidPairing` for a pairing string it can't read. */
export const createPolaris = (options: PolarisOptions): Promise<PolarisClient> =>
  createPolarisWith(options, openTransport);

export { openPolarisWith };
