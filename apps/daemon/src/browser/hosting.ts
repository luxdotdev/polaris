/**
 * Which connection hosts each Agent Session's Browser (ENG-616, ADR 0092), and the Browser
 * streams the Daemon opens toward it. Connections are `Rpc.ServerClient` ids, as in presence.
 * A stream belongs to the connection it was offered to: no other connection can accept, close
 * or credit it, and it ends with that connection or when the Browser moves (`revoked`).
 */
import {
  type BlobId,
  BrowserHostItem,
  type BrowserStreamPurpose,
  BYTE_STREAM_WINDOW_BYTES,
  type ByteStreamCloseReason,
  type ByteStreamEndpoint,
  ByteStreamId,
  type ByteTransport,
  makeByteStreamEndpoint,
  NoDesktopApp,
  NotFound,
  SessionId,
  Unsupported,
} from "@polaris/protocol";
import {
  type Cause,
  Context,
  Deferred,
  type Duration,
  Effect,
  Layer,
  Queue,
  type Scope,
  Schema,
  Stream,
} from "effect";
import { HostPresence } from "../presence/index.ts";
import type { BlobChannel } from "../services.ts";
import { ByteStreamQuota } from "./quota.ts";

/** The hosting Desktop App closed or refused the stream before it carried the session's bytes. */
export class BrowserStreamRefused extends Schema.TaggedError<BrowserStreamRefused>()(
  "BrowserStreamRefused",
  { sessionId: SessionId, reason: Schema.String }
) {}

/** How long the hosting Desktop App has to answer an `Open` before it counts as refused. */
export const BROWSER_STREAM_ACCEPT_TIMEOUT: Duration.Input = "30 seconds";

/** What the Client answers an `Open` with. */
interface Accepted {
  readonly upstream: BlobId;
  readonly window: number;
}

type StreamState =
  | {
      readonly kind: "pending";
      readonly sessionId: SessionId;
      readonly accepted: Deferred.Deferred<Accepted, BrowserStreamRefused>;
      /** What the offered `downstream` blob carries: the endpoint's bytes, or nothing when refused. */
      readonly outgoing: Deferred.Deferred<Stream.Stream<Uint8Array>>;
    }
  | { readonly kind: "open"; readonly sessionId: SessionId; readonly endpoint: ByteStreamEndpoint };

interface Registration {
  readonly connectionId: number;
  readonly blobs: BlobChannel["Service"];
  readonly items: Queue.Queue<BrowserHostItem, Cause.Done>;
  readonly streams: Map<ByteStreamId, StreamState>;
  /** Registration order: the latest wins a tie on presence. */
  readonly order: number;
  closed: boolean;
}

export interface BrowserHostingOptions {
  /** Shorter in tests. */
  readonly acceptTimeout?: Duration.Input;
}

let streamCounter = 0;

const allocateStreamId = () => {
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return ByteStreamId.make(`bs${(++streamCounter).toString(36)}-${suffix}`);
};

const notFound = (streamId: ByteStreamId) => new NotFound({ what: "browser stream", id: streamId });

export class BrowserHosting extends Context.Service<
  BrowserHosting,
  {
    /**
     * `browser.host`: `connectionId` can host Browsers until the scope closes, which also
     * releases its claims and ends its streams. Answers the items to send that connection.
     * `blobs` is the connection's channel, where the streams' blobs travel.
     */
    readonly register: (
      connectionId: number,
      blobs: BlobChannel["Service"]
    ) => Effect.Effect<Stream.Stream<BrowserHostItem>, never, Scope.Scope>;
    /** `browser.claim`: `Unsupported` unless `connectionId` is registered. Moves the session's streams off the previous holder. */
    readonly claim: (
      connectionId: number,
      sessionId: SessionId
    ) => Effect.Effect<void, NotFound | Unsupported>;
    /** `browser.release`. A no-op for a claim the connection doesn't hold. */
    readonly release: (connectionId: number, sessionId: SessionId) => Effect.Effect<void>;
    /** The connection hosting `sessionId`'s Browser: the last to claim it, else the most recently present one. */
    readonly current: (sessionId: SessionId) => Effect.Effect<number, NoDesktopApp>;
    /** Opens a Browser stream toward the hosting connection; the scope's close ends it. */
    readonly open: (
      sessionId: SessionId,
      purpose: BrowserStreamPurpose
    ) => Effect.Effect<ByteTransport, NoDesktopApp | BrowserStreamRefused, Scope.Scope>;
    /** `browser.acceptStream`: `upstream` is the Client's blob on its connection, `window` its buffer. */
    readonly accept: (
      connectionId: number,
      streamId: ByteStreamId,
      upstream: BlobId,
      window: number
    ) => Effect.Effect<void, NotFound>;
    /** `browser.closeStream`. */
    readonly close: (
      connectionId: number,
      streamId: ByteStreamId,
      reason: ByteStreamCloseReason
    ) => Effect.Effect<void, NotFound>;
    /** `byteStream.credit` for a Browser stream: the Client consumed `bytes` of `downstream`. */
    readonly credit: (
      connectionId: number,
      streamId: ByteStreamId,
      bytes: number
    ) => Effect.Effect<void, NotFound>;
  }
>()("polaris/daemon/browser/BrowserHosting") {
  static make(
    presence: HostPresence["Service"],
    quota: ByteStreamQuota["Service"],
    options: BrowserHostingOptions = {}
  ): BrowserHosting["Service"] {
    const acceptTimeout = options.acceptTimeout ?? BROWSER_STREAM_ACCEPT_TIMEOUT;
    const registrations = new Map<number, Registration>();
    /** A `claim` that raced ahead of its `browser.host`: resolved when the connection registers. */
    const awaitingRegistration = new Map<number, Deferred.Deferred<Registration>>();
    /** The connection that last claimed each session's Browser. */
    const claims = new Map<SessionId, number>();
    let registrationCounter = 0;

    /** Forgets the stream; tells the connection when the Daemon's side ended it. */
    const endStream = (
      registration: Registration,
      streamId: ByteStreamId,
      reason: ByteStreamCloseReason,
      notify: boolean
    ) => {
      const state = registration.streams.get(streamId);

      if (state === undefined) return;
      registration.streams.delete(streamId);
      quota.release(registration.connectionId);

      if (state.kind === "pending") {
        Deferred.doneUnsafe(
          state.accepted,
          Effect.fail(new BrowserStreamRefused({ sessionId: state.sessionId, reason }))
        );
        Deferred.doneUnsafe(state.outgoing, Effect.succeed(Stream.empty));
      } else if (reason === "closed") {
        state.endpoint.end();
      } else {
        state.endpoint.fail(`browser stream ${reason}`);
      }

      if (notify && !registration.closed)
        Queue.offerUnsafe(
          registration.items,
          BrowserHostItem.cases.Close.make({ streamId, reason })
        );
    };

    const revokeSession = (registration: Registration, sessionId: SessionId) => {
      for (const [streamId, state] of registration.streams)
        if (state.sessionId === sessionId) endStream(registration, streamId, "revoked", true);
    };

    const unregister = (registration: Registration) => {
      if (registration.closed) return;
      registration.closed = true;

      const openStreamIds = [...registration.streams.keys()];

      for (const streamId of openStreamIds) endStream(registration, streamId, "failed", false);

      for (const [sessionId, holder] of claims)
        if (holder === registration.connectionId) claims.delete(sessionId);

      if (registrations.get(registration.connectionId) === registration)
        registrations.delete(registration.connectionId);
      Queue.endUnsafe(registration.items);
    };

    const hostOf = (sessionId: SessionId): Registration | null => {
      const claimed = claims.get(sessionId);
      const claimedBy = claimed === undefined ? undefined : registrations.get(claimed);

      if (claimedBy !== undefined) return claimedBy;
      let best: Registration | null = null;
      let bestAt = -1;

      for (const registration of registrations.values()) {
        const at = presence.lastPresentAt(registration.connectionId) ?? -1;

        if (best === null || at > bestAt || (at === bestAt && registration.order > best.order)) {
          best = registration;
          bestAt = at;
        }
      }

      return best;
    };

    const current = (sessionId: SessionId) =>
      Effect.suspend(() => {
        const host = hostOf(sessionId);

        return host === null
          ? Effect.fail(new NoDesktopApp({ sessionId }))
          : Effect.succeed(host.connectionId);
      });

    const register = Effect.fn("BrowserHosting.register")(function* (
      connectionId: number,
      blobs: BlobChannel["Service"]
    ) {
      // A second `browser.host` on one connection replaces the first, which ends.
      const previous = registrations.get(connectionId);

      if (previous !== undefined) unregister(previous);

      const registration: Registration = {
        connectionId,
        blobs,
        items: yield* Queue.unbounded<BrowserHostItem, Cause.Done>(),
        streams: new Map(),
        order: ++registrationCounter,
        closed: false,
      };

      registrations.set(connectionId, registration);
      const waiter = awaitingRegistration.get(connectionId);

      if (waiter !== undefined) {
        awaitingRegistration.delete(connectionId);
        Deferred.doneUnsafe(waiter, Effect.succeed(registration));
      }

      yield* Effect.addFinalizer(() => Effect.sync(() => unregister(registration)));

      return Stream.fromQueue(registration.items);
    });

    const open = Effect.fn("BrowserHosting.open")(function* (
      sessionId: SessionId,
      purpose: BrowserStreamPurpose
    ) {
      const host = hostOf(sessionId);

      if (host === null) return yield* new NoDesktopApp({ sessionId });

      if (!quota.acquire(host.connectionId))
        return yield* new BrowserStreamRefused({
          sessionId,
          reason: "the hosting Desktop App has too many byte streams open",
        });

      const streamId = allocateStreamId();
      const accepted = yield* Deferred.make<Accepted, BrowserStreamRefused>();
      const outgoing = yield* Deferred.make<Stream.Stream<Uint8Array>>();
      host.streams.set(streamId, { kind: "pending", sessionId, accepted, outgoing });
      // Ending our side (the scope closed, or `close`) tells the Desktop App; a refusal already has.
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => endStream(host, streamId, "closed", true))
      );
      const downstream = yield* host.blobs.offer(Stream.unwrap(Deferred.await(outgoing)));

      yield* Queue.offer(
        host.items,
        BrowserHostItem.cases.Open.make({
          streamId,
          sessionId,
          purpose,
          downstream,
          window: BYTE_STREAM_WINDOW_BYTES,
        })
      );

      const answer = yield* Deferred.await(accepted).pipe(
        Effect.timeoutOrElse({
          duration: acceptTimeout,
          orElse: () =>
            Effect.fail(
              new BrowserStreamRefused({
                sessionId,
                reason: "the hosting Desktop App did not answer in time",
              })
            ),
        })
      );

      const endpoint = yield* makeByteStreamEndpoint({
        incoming: host.blobs.takeStream(answer.upstream, { longLived: true }),
        window: BYTE_STREAM_WINDOW_BYTES,
        peerWindow: answer.window,
        grant: (bytes) =>
          Effect.asVoid(
            Queue.offer(host.items, BrowserHostItem.cases.Credit.make({ streamId, bytes }))
          ),
      });

      // Refused or revoked while the open was waiting: the entry is gone already.
      if (host.streams.get(streamId)?.kind !== "pending") {
        endpoint.fail("browser stream revoked");

        return yield* new BrowserStreamRefused({ sessionId, reason: "revoked" });
      }

      host.streams.set(streamId, { kind: "open", sessionId, endpoint });
      yield* Deferred.succeed(outgoing, endpoint.outgoing);

      return {
        ...endpoint.transport,
        close: Effect.sync(() => endStream(host, streamId, "closed", true)),
      } satisfies ByteTransport;
    });

    /** The stream `connectionId` was offered, or `NotFound`: another connection's is invisible. */
    const owned = (connectionId: number, streamId: ByteStreamId) =>
      Effect.suspend(() => {
        const registration = registrations.get(connectionId);
        const state = registration?.streams.get(streamId);

        return registration === undefined || state === undefined
          ? Effect.fail(notFound(streamId))
          : Effect.succeed({ registration, state });
      });

    /** Waits out the gap between a connection's `browser.host` arriving and its handler registering. */
    const awaitRegistered = Effect.fn("BrowserHosting.awaitRegistered")(function* (
      connectionId: number
    ) {
      let waiter = awaitingRegistration.get(connectionId);

      if (waiter === undefined) {
        waiter = yield* Deferred.make<Registration>();
        awaitingRegistration.set(connectionId, waiter);
      }

      return yield* Deferred.await(waiter).pipe(
        Effect.timeoutOrElse({
          duration: acceptTimeout,
          orElse: () =>
            Effect.sync(() => awaitingRegistration.delete(connectionId)).pipe(
              Effect.andThen(new Unsupported({ capability: "browser.host" }))
            ),
        })
      );
    });

    return BrowserHosting.of({
      register,
      claim: Effect.fn("BrowserHosting.claim")(function* (connectionId, sessionId) {
        const registration =
          registrations.get(connectionId) ?? (yield* awaitRegistered(connectionId));

        const previous = claims.get(sessionId);
        claims.set(sessionId, connectionId);
        const moved = previous === undefined ? undefined : registrations.get(previous);

        if (moved !== undefined && moved !== registration) revokeSession(moved, sessionId);
      }),
      release: (connectionId, sessionId) =>
        Effect.sync(() => {
          if (claims.get(sessionId) === connectionId) claims.delete(sessionId);
        }),
      current,
      open,
      accept: Effect.fn("BrowserHosting.accept")(
        function* (connectionId, streamId, upstream, window) {
          const { state } = yield* owned(connectionId, streamId);

          // Accepting twice, or after the stream opened, is not an accept.
          if (state.kind !== "pending") return yield* notFound(streamId);
          yield* Deferred.succeed(state.accepted, { upstream, window });
        }
      ),
      close: Effect.fn("BrowserHosting.close")(function* (connectionId, streamId, reason) {
        const { registration } = yield* owned(connectionId, streamId);
        endStream(registration, streamId, reason, false);
      }),
      credit: Effect.fn("BrowserHosting.credit")(function* (connectionId, streamId, bytes) {
        const { registration, state } = yield* owned(connectionId, streamId);

        if (state.kind !== "open") return yield* notFound(streamId);

        // Credit for bytes never sent is a protocol violation: the stream ends.
        if (!state.endpoint.credited(bytes)) {
          endStream(registration, streamId, "failed", true);

          return yield* notFound(streamId);
        }
      }),
    });
  }

  static layer(options?: BrowserHostingOptions) {
    return Layer.effect(
      BrowserHosting,
      Effect.gen(function* () {
        return BrowserHosting.make(yield* HostPresence, yield* ByteStreamQuota, options);
      })
    );
  }

  /**
   * Placeholder for Daemons that mount no byte-stream handlers: no connection can register,
   * so `current` and `open` fail `NoDesktopApp`; the stream operations die.
   */
  static readonly layerStub = Layer.succeed(BrowserHosting)(
    BrowserHosting.of({
      register: Effect.fn("BrowserHosting.register")(function* () {
        return yield* Effect.die(new Error("browser.host is not implemented"));
      }),
      claim: Effect.fn("BrowserHosting.claim")(function* () {
        return yield* new Unsupported({ capability: "browser.host" });
      }),
      release: Effect.fn("BrowserHosting.release")(function* () {}),
      current: Effect.fn("BrowserHosting.current")(function* (sessionId: SessionId) {
        return yield* new NoDesktopApp({ sessionId });
      }),
      open: Effect.fn("BrowserHosting.open")(function* (sessionId: SessionId) {
        return yield* new NoDesktopApp({ sessionId });
      }),
      accept: Effect.fn("BrowserHosting.accept")(function* () {
        return yield* Effect.die(new Error("browser.acceptStream is not implemented"));
      }),
      close: Effect.fn("BrowserHosting.close")(function* () {
        return yield* Effect.die(new Error("browser.closeStream is not implemented"));
      }),
      credit: Effect.fn("BrowserHosting.credit")(function* () {
        return yield* Effect.die(new Error("byteStream.credit is not implemented"));
      }),
    })
  );
}
