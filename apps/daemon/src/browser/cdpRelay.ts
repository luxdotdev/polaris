/**
 * Each Agent Session's loopback CDP WebSocket (ENG-616, ADR 0092): `agent-browser mcp --cdp
 * <url>` connects to it, and the Daemon relays it over a `cdp` Browser stream.
 */
import type { SessionId } from "@polaris/protocol";
import { Context, Effect, Layer } from "effect";

/** The relay URL a session's agent-browser connects to; its last segment is the token. */
export const cdpRelayUrl = (port: number, sessionId: SessionId, token: string): string =>
  `ws://127.0.0.1:${port}/browser/${sessionId}/${token}`;

export interface CdpEndpoint {
  /** `ws://127.0.0.1:<port>/browser/<sessionId>/<token>`. Secret: it carries the token. */
  readonly url: string;
}

export class CdpRelay extends Context.Service<
  CdpRelay,
  {
    /** The session's relay URL, issuing a token on first use; the same URL until revoked. */
    readonly issue: (sessionId: SessionId) => Effect.Effect<CdpEndpoint>;
    /** Revokes the session's token and closes its open relay sockets. Idempotent. */
    readonly revoke: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()("polaris/daemon/browser/CdpRelay") {
  /** Placeholder until ENG-616 lands: `issue` dies, `revoke` does nothing. */
  static readonly layerStub = Layer.succeed(CdpRelay)(
    CdpRelay.of({
      issue: Effect.fn("CdpRelay.issue")(function* (sessionId: SessionId) {
        return yield* Effect.die(new Error(`the CDP relay for ${sessionId} is not implemented`));
      }),
      revoke: Effect.fn("CdpRelay.revoke")(function* () {}),
    })
  );
}
