/**
 * The Daemon's side of `hostAddress.open` (ENG-613, ADR 0093): a socket to its own loopback
 * per Host-address stream. The handler bridges it to the stream's blobs and credits.
 */
import { HostAddressError, type ByteTransport } from "@polaris/protocol";
import { Context, Effect, Layer, type Scope } from "effect";

/** Where a Host-address stream goes: `hostname` as the Client sent it, unresolved. */
export interface HostAddressTarget {
  readonly hostname: string;
  readonly port: number;
}

export class HostAddressStreams extends Context.Service<
  HostAddressStreams,
  {
    /**
     * Connects to `target` on the Host's loopback, closed with the scope. Fails with
     * `not-host-address` before connecting when `hostname` is not a Host address.
     */
    readonly connect: (
      target: HostAddressTarget
    ) => Effect.Effect<ByteTransport, HostAddressError, Scope.Scope>;
  }
>()("polaris/daemon/browser/HostAddressStreams") {
  /** Placeholder until ENG-613 lands: every connect dies. */
  static readonly layerStub = Layer.succeed(HostAddressStreams)(
    HostAddressStreams.of({
      connect: Effect.fn("HostAddressStreams.connect")(function* (target: HostAddressTarget) {
        return yield* Effect.die(
          new Error(`hostAddress.open to ${target.hostname}:${target.port} is not implemented`)
        );
      }),
    })
  );
}
