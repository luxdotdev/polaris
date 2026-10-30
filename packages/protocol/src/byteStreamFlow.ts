/**
 * One end of a byte stream (ADR 0093, `byteStreams.ts`) as a ByteTransport, shared by the
 * Daemon and the Client runtime. Our bytes leave as `outgoing`, the blob the peer reads, split
 * to fit the peer's credit; the peer's blob arrives as `transport.incoming`, and each chunk is
 * granted back once the consumer has taken it. Neither side's buffer can grow past its window.
 */
import { type Cause, Deferred, Effect, Queue, Stream } from "effect";
import { BLOB_CHUNK_BYTES } from "./frame.ts";
import { type ByteTransport, TransportError } from "./wire.ts";

/** The peer's allowance: `reserve` waits while sending would exceed it; `grant` returns what it consumed. */
export interface CreditWindow {
  /** Takes `bytes` (at most the window) from the allowance, waiting for credit when it is short. */
  readonly reserve: (bytes: number) => Effect.Effect<void, TransportError>;
  /** The peer consumed `bytes`. False when that is more than was outstanding, or not a count. */
  readonly grant: (bytes: number) => boolean;
  /** Fails every waiting and future `reserve`. */
  readonly fail: (error: TransportError) => void;
  /** Bytes sent and not yet credited. */
  readonly outstanding: () => number;
}

interface Waiter {
  readonly bytes: number;
  readonly resume: (effect: Effect.Effect<void, TransportError>) => void;
}

export const makeCreditWindow = (window: number): CreditWindow => {
  let available = window;
  let failure: TransportError | null = null;
  let waiters: Array<Waiter> = [];

  const settle = () => {
    while (waiters.length > 0) {
      const head = waiters[0]!;

      if (failure !== null) {
        waiters.shift();
        head.resume(Effect.fail(failure));
        continue;
      }

      if (head.bytes > available) return;
      available -= head.bytes;
      waiters.shift();
      head.resume(Effect.void);
    }
  };

  return {
    reserve: (bytes) =>
      Effect.callback<void, TransportError>((resume) => {
        if (failure !== null) {
          resume(Effect.fail(failure));

          return;
        }

        if (bytes > window) {
          resume(
            Effect.fail(
              new TransportError({ message: `${bytes} bytes exceed the ${window}-byte window` })
            )
          );

          return;
        }

        if (waiters.length === 0 && bytes <= available) {
          available -= bytes;
          resume(Effect.void);

          return;
        }

        const waiter: Waiter = { bytes, resume };
        waiters.push(waiter);

        return Effect.sync(() => {
          waiters = waiters.filter((w) => w !== waiter);
        });
      }),
    grant: (bytes) => {
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > window - available) return false;
      available += bytes;
      settle();

      return true;
    },
    fail: (error) => {
      failure ??= error;
      settle();
    },
    outstanding: () => window - available,
  };
};

export interface ByteStreamEndpointOptions<E extends { readonly message: string }> {
  /** The peer's blob toward us, taken long-lived from the Wire; its failure carries a message. */
  readonly incoming: Stream.Stream<Uint8Array, E>;
  /** The window we announced: what we buffer of `incoming` unread. Credits go back by the quarter. */
  readonly window: number;
  /** The peer's window: what we may send of `outgoing` before it grants credit. */
  readonly peerWindow: number;
  /** Tells the peer we consumed `bytes` more of its blob. */
  readonly grant: (bytes: number) => Effect.Effect<void>;
}

export interface ByteStreamEndpoint {
  readonly transport: ByteTransport;
  /** Our bytes toward the peer: offer it as the blob the peer reads. Ends when the transport closes. */
  readonly outgoing: Stream.Stream<Uint8Array>;
  /** The peer consumed `bytes` of `outgoing`. False when that exceeds what was outstanding: fail the stream. */
  readonly credited: (bytes: number) => boolean;
  /** The peer closed the stream cleanly: `incoming` ends, `outgoing` ends, writes fail. */
  readonly end: () => void;
  /** Ends the stream from outside (the peer refused it, the connection dropped): reads and writes fail. */
  readonly fail: (message: string) => void;
  /** Settles once the transport has closed, by either side. */
  readonly closed: Effect.Effect<void>;
}

/** Builds the endpoint; `transport.close` ends `outgoing` (the peer sees its blob end). */
export const makeByteStreamEndpoint = Effect.fnUntraced(function* <
  E extends { readonly message: string },
>(options: ByteStreamEndpointOptions<E>): Effect.fn.Return<ByteStreamEndpoint, never> {
  const queue = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const closed = yield* Deferred.make<void>();
  /** Succeeds on a clean close (incoming ends), fails on `fail` (incoming fails). */
  const ended = yield* Deferred.make<void, TransportError>();
  const peerCredit = makeCreditWindow(options.peerWindow);
  const pieceBytes = Math.min(options.peerWindow, BLOB_CHUNK_BYTES);
  const grantThreshold = Math.max(1, Math.floor(options.window / 4));
  let ungranted = 0;
  let isClosed = false;

  const grant = (bytes: number) =>
    Effect.suspend(() => {
      ungranted += bytes;

      if (ungranted < grantThreshold || isClosed) return Effect.void;
      const granted = ungranted;
      ungranted = 0;

      return options.grant(granted);
    });

  const finish = (exit: Effect.Effect<void, TransportError>, error: TransportError) => {
    if (isClosed) return;
    isClosed = true;
    Deferred.doneUnsafe(ended, exit);
    peerCredit.fail(error);
    Queue.endUnsafe(queue);
    Deferred.doneUnsafe(closed, Effect.void);
  };

  const write = (bytes: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.gen(function* () {
      for (let offset = 0; offset < bytes.byteLength; offset += pieceBytes) {
        if (isClosed) return yield* new TransportError({ message: "byte stream closed" });
        const piece = bytes.subarray(offset, offset + pieceBytes);
        yield* peerCredit.reserve(piece.byteLength);
        yield* Queue.offer(queue, piece);
      }
    });

  const end = () => finish(Effect.void, new TransportError({ message: "byte stream closed" }));

  return {
    transport: {
      incoming: options.incoming.pipe(
        Stream.mapError((error) => new TransportError({ message: error.message })),
        Stream.interruptWhen(Deferred.await(ended)),
        Stream.tap((chunk) => grant(chunk.byteLength))
      ),
      write,
      close: Effect.sync(end),
    },
    outgoing: Stream.fromQueue(queue),
    credited: peerCredit.grant,
    end,
    fail: (message) => {
      const error = new TransportError({ message });
      finish(Effect.fail(error), error);
    },
    closed: Deferred.await(closed),
  };
});

/**
 * Copies bytes both ways between two transports until either side's incoming ends or fails,
 * then closes both. Answers the error that ended it, if any.
 */
export const pipeTransports = (
  a: ByteTransport,
  b: ByteTransport
): Effect.Effect<TransportError | null> => {
  const copy = (from: ByteTransport, to: ByteTransport) =>
    from.incoming.pipe(Stream.runForEach(to.write));

  return Effect.raceFirst(copy(a, b), copy(b, a)).pipe(
    Effect.match({ onFailure: (error) => error, onSuccess: () => null }),
    Effect.tap(() => Effect.andThen(a.close, b.close))
  );
};
