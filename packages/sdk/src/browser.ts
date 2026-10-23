/**
 * `@polaris/sdk` in a browser or WebView: only the gateway. A local pairing
 * (`url` null) needs Node or Bun, so connecting through it fails.
 */
import { Effect, type Scope } from "effect";
import { openPolaris as openPolarisWith, type Polaris, type PolarisOptions } from "./client.ts";
import type { OpenTransport } from "./connection.ts";
import { HostUnreachable } from "./errors.ts";
import type { InvalidPairing } from "./pairing.ts";
import { createPolarisWith, type PolarisClient } from "./promise.ts";
import { webSocketTransport } from "./transport/websocket.ts";

export * from "./api.ts";

export const openTransport: OpenTransport = (pairing) =>
  pairing.url === null
    ? Effect.fail(
        new HostUnreachable({
          hostId: pairing.hostId,
          detail: "this pairing is for the local socket, which a browser can't open",
        })
      )
    : webSocketTransport(pairing.url, pairing.hostId);

export const openPolaris = (
  options: PolarisOptions
): Effect.Effect<Polaris, InvalidPairing, Scope.Scope> => openPolarisWith(options, openTransport);

export const createPolaris = (options: PolarisOptions): Promise<PolarisClient> =>
  createPolarisWith(options, openTransport);

export { openPolarisWith };
