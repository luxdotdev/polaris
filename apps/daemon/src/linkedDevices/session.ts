/**
 * One Linked Device's end-to-end session as a ByteTransport: records the device
 * sends are opened into the byte stream the Wire frames, and what the Wire writes
 * is sealed into records for the relay. Closing it ends the device's connection.
 */
import { type ByteTransport, TransportError } from "@polaris/protocol";
import type { RelayAddress } from "@polaris/protocol/relay";
import type { RelaySession } from "@polaris/protocol/relay/party";
import { Cause, Effect, Queue, Stream } from "effect";

/** Bytes opened but not yet read by the Wire before the session is closed as stuck. */
export const MAX_QUEUED_INCOMING_BYTES = 16 * 1024 * 1024;

export interface SessionSink {
  /** Sends the records to `peer` in order; rejects once the relay socket is gone. */
  readonly send: (peer: RelayAddress, records: ReadonlyArray<Uint8Array>) => Promise<void>;
  /** Told once when the session ends, whoever ended it. */
  readonly ended: (session: DeviceSession) => void;
}

export class DeviceSession implements ByteTransport {
  private closed = false;
  private queuedBytes = 0;
  private readonly queue = Effect.runSync(Queue.unbounded<Uint8Array, Cause.Done>());

  readonly incoming = Stream.fromQueue(this.queue).pipe(
    Stream.map((bytes) => {
      this.queuedBytes -= bytes.byteLength;

      return bytes;
    })
  );

  constructor(
    /** The device's relay address: where its records come from and go to. */
    readonly peer: RelayAddress,
    private readonly session: RelaySession,
    private readonly sink: SessionSink
  ) {}

  get tag(): Uint8Array {
    return this.session.tag;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Opens a data record from the device; a record that fails ends the session (ADR 0082). */
  receive(record: Uint8Array): void {
    if (this.closed) return;
    let plaintext: Uint8Array;

    try {
      plaintext = this.session.open(record);
    } catch {
      this.end();

      return;
    }

    this.queuedBytes += plaintext.byteLength;

    if (this.queuedBytes > MAX_QUEUED_INCOMING_BYTES) {
      this.end();

      return;
    }

    Queue.offerUnsafe(this.queue, plaintext);
  }

  readonly write = (bytes: Uint8Array): Effect.Effect<void, TransportError> =>
    Effect.suspend(() => {
      if (this.closed)
        return Effect.fail(new TransportError({ message: "the Linked Device's session ended" }));
      let records: ReadonlyArray<Uint8Array>;

      try {
        records = this.session.seal(bytes);
      } catch (cause) {
        this.end();

        return Effect.fail(
          new TransportError({ message: "the session needs a new handshake", cause })
        );
      }

      return Effect.tryPromise({
        try: () => this.sink.send(this.peer, records),
        catch: (cause) => new TransportError({ message: "the relay socket closed", cause }),
      });
    });

  readonly close: Effect.Effect<void> = Effect.sync(() => this.end());

  /** Ends the session: the Wire sees its input end and the connection closes. Idempotent. */
  end(): void {
    if (this.closed) return;
    this.closed = true;
    Queue.endUnsafe(this.queue);
    this.sink.ended(this);
  }
}
