/**
 * Each Agent Session's loopback CDP WebSocket (ENG-616, ADR 0092): `agent-browser` connects to
 * it (`AGENT_BROWSER_CDP`), and the Daemon relays it over a `cdp` Browser stream to the
 * Desktop App hosting the session's Browser. See `README.md`.
 */
import { DomainEvent, type SessionId } from "@polaris/protocol";
import { Context, Effect, Layer, Option, Stream } from "effect";
import { join } from "node:path";
import { EventStore } from "../store/EventStore.ts";
import { LiveItem } from "../store/hub.ts";
import { BrowserHosting } from "./hosting.ts";
import { startRelayServer } from "./relayServer.ts";
import type { RelaySocket } from "./relaySocket.ts";
import { CdpRelayStore } from "./relayStore.ts";
import { cdpRelayUrl } from "./relayUrl.ts";

export { cdpRelayUrl } from "./relayUrl.ts";

export interface CdpEndpoint {
  /** `ws://127.0.0.1:<port>/browser/<sessionId>/<token>`. Secret: it carries the token. */
  readonly url: string;
}

export interface CdpRelayOptions {
  /** The Daemon's private home; the token store is `browser-cdp.sqlite` there. */
  readonly home: string;
  /** The Daemon's version, shown by `/json/version`. */
  readonly version: string;
  /** 0 (the default) picks a free port; a URL outlives the Daemon only on a fixed one. */
  readonly port?: number;
}

const archived = (item: LiveItem) =>
  LiveItem.$is("Event")(item) &&
  DomainEvent.guards.SessionStateChanged(item.envelope.event) &&
  item.envelope.event.state === "archived";

/** Revokes each session as it is archived; resubscribes if the feed drops it for lagging. */
const revokeArchived = (
  store: EventStore["Service"],
  revoke: (sessionId: SessionId) => Effect.Effect<void>
) =>
  Effect.gen(function* () {
    const items = yield* store.subscribe({ filter: archived });
    yield* items.pipe(
      Stream.runForEach((item) =>
        LiveItem.$is("Event")(item) && DomainEvent.guards.SessionStateChanged(item.envelope.event)
          ? revoke(item.envelope.event.sessionId)
          : Effect.void
      )
    );
  }).pipe(Effect.scoped, Effect.forever);

export class CdpRelay extends Context.Service<
  CdpRelay,
  {
    /** The session's relay URL, issuing a token on first use; the same URL until revoked. */
    readonly issue: (sessionId: SessionId) => Effect.Effect<CdpEndpoint>;
    /** Revokes the session's token and closes its open relay sockets. Idempotent. */
    readonly revoke: (sessionId: SessionId) => Effect.Effect<void>;
  }
>()("polaris/daemon/browser/CdpRelay") {
  /** The relay on a loopback port, over `BrowserHosting`. */
  static layer(options: CdpRelayOptions) {
    return Layer.effect(
      CdpRelay,
      Effect.gen(function* () {
        const hosting = yield* BrowserHosting;
        const store = yield* CdpRelayStore;
        const sockets = new Map<SessionId, Set<RelaySocket>>();

        const server = yield* startRelayServer({
          port: options.port ?? 0,
          version: options.version,
          store,
          hosted: (sessionId) =>
            hosting.current(sessionId).pipe(
              Effect.as(true),
              Effect.catchTag("NoDesktopApp", () => Effect.succeed(false))
            ),
          hooks: {
            open: (sessionId) => hosting.open(sessionId, "cdp"),
            remembered: (sessionId) => store.remembered(sessionId).pipe(Effect.orDie),
            remember: (sessionId, tabs) => store.remember(sessionId, tabs).pipe(Effect.orDie),
            opened: (socket) => {
              const set = sockets.get(socket.sessionId) ?? new Set<RelaySocket>();
              set.add(socket);
              sockets.set(socket.sessionId, set);
            },
            closed: (socket) => {
              const set = sockets.get(socket.sessionId);
              set?.delete(socket);

              if (set?.size === 0) sockets.delete(socket.sessionId);
            },
          },
        });

        const port = server.port ?? options.port ?? 0;

        const revoke = Effect.fn("CdpRelay.revoke")(function* (sessionId: SessionId) {
          yield* store.revoke(sessionId).pipe(Effect.orDie);

          for (const socket of sockets.get(sessionId) ?? []) socket.close(1008, "revoked");
        });

        // An archived session's URL dies with it, as its MCP bindings do (`mcp/revoke.ts`).
        const eventStore = yield* Effect.serviceOption(EventStore);

        if (Option.isSome(eventStore))
          yield* Effect.forkScoped(revokeArchived(eventStore.value, revoke));

        return CdpRelay.of({
          issue: Effect.fn("CdpRelay.issue")(function* (sessionId: SessionId) {
            const token = yield* store.issue(sessionId).pipe(Effect.orDie);

            return { url: cdpRelayUrl(port, sessionId, token) };
          }),
          revoke,
        });
      })
    ).pipe(Layer.provide(CdpRelayStore.layer(join(options.home, "browser-cdp.sqlite"))));
  }

  /** Placeholder for tests and Daemons without a Browser: `issue` dies, `revoke` does nothing. */
  static readonly layerStub = Layer.succeed(CdpRelay)(
    CdpRelay.of({
      issue: Effect.fn("CdpRelay.issue")(function* (sessionId: SessionId) {
        return yield* Effect.die(new Error(`the CDP relay for ${sessionId} is not implemented`));
      }),
      revoke: Effect.fn("CdpRelay.revoke")(function* () {}),
    })
  );
}
