/**
 * One end-to-end session to a Host over a relay socket, as a ByteTransport: a Noise IK
 * handshake to the Host's static key, then sealed records both ways. The session ends
 * when the socket drops or the Host goes offline; the Connection State reconnects and
 * resume picks up from there, as after any dropped connection.
 */
import { type ByteTransport, TransportError } from "@polaris/protocol";
import type { RelayAddress } from "@polaris/protocol/relay";
import {
  readRecord,
  RecordType,
  RelayInitiator,
  type RelaySession,
  type StaticKeyPair,
} from "@polaris/protocol/relay/party";
import { Cause, Effect, Queue, Stream } from "effect";
import type { RelaySocket } from "./socket.ts";

/** How long a session waits for the relay, the Host's presence and its handshake reply. */
export const OPEN_TIMEOUT_MS = 10_000;

/** After ready, how long to wait for the relay to say the Host is online before trying anyway. */
const PRESENCE_GRACE_MS = 1_000;

export interface RelayPeer {
  readonly address: RelayAddress;
  readonly noiseKey: Uint8Array;
}

const sameTag = (a: Uint8Array, b: Uint8Array) =>
  a.byteLength === b.byteLength && a.every((byte, i) => byte === b[i]);

const failure = (message: string) => new TransportError({ message });

/** Pause before a handshake the relay dropped is sent again. */
const RETRY_MS = 250;

/** Why a handshake ended: `retry` when the relay dropped it and a later one may land. */
class Unanswered {
  constructor(
    readonly failure: TransportError,
    readonly retry: boolean
  ) {}
}

/** Waits until `ready` holds, re-checking on every socket change; false at the deadline. */
const waitFor = async (socket: RelaySocket, ready: () => boolean, deadline: number) => {
  while (!ready()) {
    const left = deadline - Date.now();

    if (left <= 0) return false;
    await Promise.race([socket.changed(), new Promise((resolve) => setTimeout(resolve, left))]);
  }

  return true;
};

interface Pending {
  resolve: (session: RelaySession) => void;
  reject: (error: Unanswered) => void;
}

/** Sends the init and resolves with the session once the Host's reply for this tag arrives. */
const handshake = (
  socket: RelaySocket,
  host: RelayPeer,
  noise: StaticKeyPair,
  payload: Uint8Array | undefined,
  deadline: number
): Promise<RelaySession> =>
  new Promise((resolve, reject) => {
    const initiator = new RelayInitiator(noise, host.noiseKey, payload);
    const pending: Pending = { resolve, reject };
    let timer: ReturnType<typeof setTimeout> | null = null;

    const settle = (outcome: () => void) => {
      if (timer !== null) clearTimeout(timer);
      unlisten();
      outcome();
    };

    const unlisten = socket.listen(host.address, {
      record: (record) => {
        try {
          const { type, tag } = readRecord(record);

          // Replies to an earlier attempt, or data of an old session, are not ours.
          if (type !== RecordType.Reply || !sameTag(tag, initiator.tag)) return;
          const session = initiator.finish(record);
          settle(() => pending.resolve(session));
        } catch {
          settle(() =>
            pending.reject(new Unanswered(failure("the Host's handshake reply failed"), false))
          );
        }
      },
      lost: (reason) => settle(() => pending.reject(new Unanswered(failure(reason), true))),
    });

    const mark = socket.heardMark;

    timer = setTimeout(
      () =>
        settle(() => {
          // Not a word from the relay since the init: the socket itself may be dead.
          if (!socket.heardSince(mark)) socket.recycle("the relay stopped answering");
          pending.reject(new Unanswered(failure("the Host did not answer the handshake"), false));
        }),
      Math.max(0, deadline - Date.now())
    );

    void socket.send(host.address, [initiator.init]).then((sent) => {
      if (!sent) settle(() => pending.reject(new Unanswered(failure(socket.lastError), true)));
    });
  });

/**
 * Opens a Noise session to `host`; with `payload`, it rides encrypted in the init. A Host
 * the relay can't reach yet (it is reconnecting, or only now listing the device) is tried
 * again until the deadline, each time with a fresh handshake.
 */
export const openSession = async (
  socket: RelaySocket,
  host: RelayPeer,
  noise: StaticKeyPair,
  payload?: Uint8Array
): Promise<RelaySession> => {
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  socket.start();

  for (;;) {
    if (!(await waitFor(socket, () => socket.isReady, deadline))) throw failure(socket.lastError);
    // Presence usually arrives with ready; an unlinked device never gets one, so try anyway.
    await waitFor(
      socket,
      () => socket.isOnline(host.address),
      Math.min(deadline, Date.now() + PRESENCE_GRACE_MS)
    );

    try {
      return await handshake(socket, host, noise, payload, deadline);
    } catch (error) {
      if (!(error instanceof Unanswered)) throw error;

      if (!error.retry || Date.now() + RETRY_MS >= deadline) throw error.failure;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }
};

/** The session's bytes: what the Wire writes is sealed for the Host, and its records opened. */
const sessionTransport = (
  socket: RelaySocket,
  host: RelayPeer,
  session: RelaySession
): Effect.Effect<ByteTransport, never, never> =>
  Effect.gen(function* () {
    const queue = yield* Queue.unbounded<Uint8Array, TransportError | Cause.Done>();
    let open = true;
    /** The socket's mark at this session's latest record. */
    let lastRecord = socket.heardMark;

    const end = (error: TransportError | null) => {
      if (!open) return;
      open = false;
      unlisten();

      if (error === null) Queue.endUnsafe(queue);
      else Queue.failCauseUnsafe(queue, Cause.fail(error));
    };

    const unlisten = socket.listen(host.address, {
      record: (record) => {
        if (!open) return;

        try {
          const { type, tag } = readRecord(record);

          // A stray reply or another session's data (a reconnect's leftovers) is skipped.
          if (type !== RecordType.Data || !sameTag(tag, session.tag)) return;
          lastRecord = socket.heardMark;
          Queue.offerUnsafe(queue, session.open(record));
        } catch {
          end(failure("a record from the Host failed authentication"));
        }
      },
      lost: () => end(null),
    });

    return {
      incoming: Stream.fromQueue(queue),
      write: (bytes) =>
        open
          ? Effect.flatMap(
              Effect.tryPromise({
                try: () => socket.send(host.address, session.seal(bytes)),
                catch: (cause) => new TransportError({ message: "sealing failed", cause }),
              }),
              (sent) => (sent ? Effect.void : Effect.fail(failure(socket.lastError)))
            )
          : Effect.fail(failure("the relay session ended")),
      close: Effect.sync(() => {
        // Closed after this session and the whole socket went quiet: the socket may be dead.
        if (open && !socket.heardSince(lastRecord)) socket.recycle("the relay went quiet");
        end(null);
      }),
    } satisfies ByteTransport;
  });

/** A ByteTransport to `host` over `socket`; closing the scope ends the session. */
export const relaySessionTransport = (socket: RelaySocket, host: RelayPeer, noise: StaticKeyPair) =>
  Effect.acquireRelease(
    Effect.flatMap(
      Effect.tryPromise({
        try: () => openSession(socket, host, noise),
        catch: (cause) =>
          cause instanceof TransportError ? cause : new TransportError({ message: String(cause) }),
      }),
      (session) => sessionTransport(socket, host, session)
    ),
    (transport) => transport.close
  );
