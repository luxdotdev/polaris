/**
 * A relay Host as a HostConnection's Connector: the device's Noise session to the Host,
 * so the Connection State, resume and every feed run over it as they do over SSH.
 */
import type { ByteTransport, TransportError } from "@polaris/protocol";
import { Effect, type Scope } from "effect";
import { ConnectFailure } from "./failures.ts";
import type { RelayTarget } from "./HostConnection.ts";
import type { ClientTransport, Connector } from "./transport.ts";

/** The part of `@polaris/client/relay`'s RelayDevice a connection needs. */
export interface RelaySessions {
  readonly transport: (
    host: RelayTarget
  ) => Effect.Effect<ByteTransport, TransportError, Scope.Scope>;
}

const lost = new ConnectFailure({
  kind: "transient",
  reason: "connection-lost",
  detail: "the relay session ended",
});

/** Opens `target` through `device`; a session that can't open is a transient "unreachable". */
export const relayConnector =
  (device: RelaySessions) =>
  (target: RelayTarget): Connector =>
    device.transport(target).pipe(
      Effect.mapError(
        (error) =>
          new ConnectFailure({ kind: "transient", reason: "unreachable", detail: error.message })
      ),
      Effect.map((transport): ClientTransport => ({ ...transport, diagnose: Effect.succeed(lost) }))
    );
