/**
 * Which connection hosts each Agent Session's Browser (ENG-616, ADR 0092), and the Browser
 * streams the Daemon opens toward it. Connections are `Rpc.ServerClient` ids, as in presence.
 */
import {
  type BlobError,
  type BrowserHostItem,
  type BrowserStreamPurpose,
  type ByteStreamCloseReason,
  type ByteStreamId,
  type ByteTransport,
  NoDesktopApp,
  type NotFound,
  SessionId,
  Unsupported,
} from "@polaris/protocol";
import { Context, Effect, Layer, type Scope, Schema, type Stream } from "effect";

/** The hosting Desktop App closed or refused the stream before it carried the session's bytes. */
export class BrowserStreamRefused extends Schema.TaggedError<BrowserStreamRefused>()(
  "BrowserStreamRefused",
  { sessionId: SessionId, reason: Schema.String }
) {}

export class BrowserHosting extends Context.Service<
  BrowserHosting,
  {
    /**
     * `browser.host`: `connectionId` can host Browsers until the scope closes, which also
     * releases its claims. Answers the items to send that connection.
     */
    readonly register: (
      connectionId: number
    ) => Effect.Effect<Stream.Stream<BrowserHostItem>, never, Scope.Scope>;
    /** `browser.claim`: `Unsupported` unless `connectionId` is registered. */
    readonly claim: (
      connectionId: number,
      sessionId: SessionId
    ) => Effect.Effect<void, NotFound | Unsupported>;
    /** `browser.release`. A no-op for a claim the connection doesn't hold. */
    readonly release: (connectionId: number, sessionId: SessionId) => Effect.Effect<void>;
    /** The connection hosting `sessionId`'s Browser: the last to claim it, else a present one. */
    readonly current: (sessionId: SessionId) => Effect.Effect<number, NoDesktopApp>;
    /** Opens a Browser stream toward the hosting connection; the scope's close ends it. */
    readonly open: (
      sessionId: SessionId,
      purpose: BrowserStreamPurpose
    ) => Effect.Effect<ByteTransport, NoDesktopApp | BrowserStreamRefused, Scope.Scope>;
    /** `browser.acceptStream`: `upstream` is the Client's blob, `window` its buffer. */
    readonly accept: (
      connectionId: number,
      streamId: ByteStreamId,
      upstream: Stream.Stream<Uint8Array, BlobError>,
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
  /**
   * Placeholder until ENG-616 lands: no connection can register, so `current` and `open`
   * fail `NoDesktopApp`; the stream operations die.
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
