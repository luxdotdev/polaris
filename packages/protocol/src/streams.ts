/**
 * ByteTransport building blocks for Node-style streams (sockets, child-process
 * stdio), shared by the Daemon and the Client runtime. Typed structurally so
 * the protocol package stays free of Node imports.
 */
import { Cause, Effect, Stream } from "effect";
import { TransportError } from "./wire.ts";

type Listener = (...args: ReadonlyArray<never>) => void;

export interface EventReadable {
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
  pause(): unknown;
  resume(): unknown;
}

export interface EventWritable {
  readonly destroyed: boolean;
  readonly writable: boolean;
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): boolean;
  on(event: string, listener: Listener): unknown;
  off(event: string, listener: Listener): unknown;
}

const READ_HIGH_WATER = 64;

/**
 * Reads a Node-style readable as a Stream. Listeners attach immediately (Bun
 * drops socket data that arrives before a `data` listener exists), chunks are
 * buffered until pulled, and the source is paused while the buffer is full.
 */
export const readEvents = (source: EventReadable): Stream.Stream<Uint8Array, TransportError> => {
  let pending: Array<Uint8Array> = [];
  let ended = false;
  let failure: TransportError | null = null;
  let paused = false;
  let wake: (() => void) | null = null;

  const onData = (chunk: Uint8Array) => {
    pending.push(chunk);

    if (!paused && pending.length >= READ_HIGH_WATER) {
      paused = true;
      source.pause();
    }

    wake?.();
  };

  const onEnd = () => {
    ended = true;
    wake?.();
  };

  const onError = (cause: Error) => {
    failure ??= new TransportError({ message: "read failed", cause });
    wake?.();
  };

  source.on("data", onData as Listener);
  source.on("end", onEnd);
  source.on("close", onEnd);
  source.on("error", onError as Listener);

  const pull = Effect.callback<ReadonlyArray<Uint8Array>, TransportError | Cause.Done>((resume) => {
    const settle = (): boolean => {
      if (pending.length > 0) {
        const chunks = pending;
        pending = [];

        if (paused) {
          paused = false;
          source.resume();
        }

        resume(Effect.succeed(chunks));

        return true;
      }

      if (failure !== null) {
        resume(Effect.fail(failure));

        return true;
      }

      if (ended) {
        resume(Effect.fail(Cause.Done()));

        return true;
      }

      return false;
    };

    if (settle()) return;

    // Clear before settling: resuming can synchronously start the next pull,
    // which registers its own waiter that must not be overwritten.
    const waiter = () => {
      wake = null;

      if (!settle()) wake = waiter;
    };

    wake = waiter;

    return Effect.sync(() => {
      wake = null;
    });
  });

  return Stream.fromEffectRepeat(pull).pipe(
    Stream.flatMap((chunks) => Stream.fromIterable(chunks)),
    Stream.ensuring(
      Effect.sync(() => {
        source.off("data", onData as Listener);
        source.off("end", onEnd);
        source.off("close", onEnd);
        source.off("error", onError as Listener);
      })
    )
  );
};

/**
 * Writes to a Node-style writable. When `write` reports a full buffer, waits
 * for `drain` or for this chunk's write callback, whichever comes first (Bun
 * does not always emit `drain` for sockets).
 */
export const writeEvents =
  (sink: EventWritable) =>
  (bytes: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.callback<void, TransportError>((resume) => {
      if (sink.destroyed || !sink.writable) {
        resume(Effect.fail(new TransportError({ message: "transport closed" })));

        return;
      }

      let done = false;

      const finish = (effect: Effect.Effect<void, TransportError>) => {
        if (done) return;
        done = true;
        cleanup();
        resume(effect);
      };

      const onDrain = () => finish(Effect.void);

      const onClose = () =>
        finish(Effect.fail(new TransportError({ message: "transport closed while writing" })));

      const cleanup = () => {
        sink.off("drain", onDrain);
        sink.off("close", onClose);
        sink.off("error", onClose);
      };

      const flushed = sink.write(bytes, (error) =>
        finish(
          error === null || error === undefined
            ? Effect.void
            : Effect.fail(new TransportError({ message: "write failed", cause: error }))
        )
      );

      if (flushed) {
        finish(Effect.void);

        return;
      }

      sink.on("drain", onDrain);
      sink.on("close", onClose);
      sink.on("error", onClose);

      return Effect.sync(cleanup);
    });
