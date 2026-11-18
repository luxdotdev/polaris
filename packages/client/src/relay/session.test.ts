import { describe, expect, test } from "bun:test";
import type { ByteTransport } from "@polaris/protocol";
import { type RelayAddress, relayAddress } from "@polaris/protocol/relay";
import {
  acceptHandshake,
  generateStaticKeyPair,
  readRecord,
  RecordType,
  type RelaySession,
} from "@polaris/protocol/relay/party";
import { Effect, Exit, Scope, Stream } from "effect";
import { openSession, relaySessionTransport, type SessionSocket } from "./session.ts";
import type { PeerListener } from "./socket.ts";

const text = new TextEncoder();

const read = new TextDecoder();

const key = (tag: Uint8Array) => Buffer.from(tag).toString("hex");

/** A relay socket with the Host behind it: answers handshakes, keeps what each session sent. */
class FakeRelay implements SessionSocket {
  readonly isReady = true;
  lastError = "";
  silent = false;
  readonly recycled: Array<string> = [];
  readonly received = new Map<string, Array<string>>();
  private heard = 0;
  private readonly sessions = new Map<string, RelaySession>();
  private readonly listeners = new Set<PeerListener>();

  constructor(private readonly hostKeys: ReturnType<typeof generateStaticKeyPair>) {}

  get heardMark() {
    return this.heard;
  }

  get listening() {
    return this.listeners.size;
  }

  start() {}
  isOnline() {
    return true;
  }
  changed() {
    return new Promise<void>(() => {});
  }
  heardSince(mark: number) {
    return this.heard > mark;
  }

  listen(_peer: RelayAddress, listener: PeerListener) {
    this.listeners.add(listener);

    return () => void this.listeners.delete(listener);
  }

  recycle(reason: string) {
    this.recycled.push(reason);

    for (const listener of this.listeners) listener.lost(reason);
  }

  async send(_peer: RelayAddress, records: ReadonlyArray<Uint8Array>) {
    for (const record of this.silent ? [] : records) this.atHost(record);

    return true;
  }

  /** The Host sends `message` on the session whose init carried `sessionKey`'s tag. */
  fromHost(sessionKey: string, message: string) {
    const session = this.sessions.get(sessionKey);

    if (session === undefined) throw new Error(`no session ${sessionKey}`);

    for (const record of session.seal(text.encode(message))) this.deliver(record);
  }

  sessionKeys() {
    return [...this.sessions.keys()];
  }

  private atHost(record: Uint8Array) {
    const { type, tag } = readRecord(record);

    if (type === RecordType.Init) {
      const { session, reply } = acceptHandshake(this.hostKeys, record, () => true);
      this.sessions.set(key(tag), session);
      queueMicrotask(() => this.deliver(reply));

      return;
    }

    const session = this.sessions.get(key(tag));
    const log = this.received.get(key(tag)) ?? [];
    log.push(read.decode(session?.open(record)));
    this.received.set(key(tag), log);
  }

  private deliver(record: Uint8Array) {
    this.heard++;

    for (const listener of this.listeners) listener.record(record);
  }
}

const setup = async () => {
  const hostKeys = generateStaticKeyPair();
  const relay = new FakeRelay(hostKeys);
  const host = { address: await relayAddress(hostKeys.publicKey), noiseKey: hostKeys.publicKey };

  /** One Account's session: its transport, the Host-side key and a way to close it. */
  const connect = async () => {
    const scope = await Effect.runPromise(Scope.make());
    const before = new Set(relay.sessionKeys());

    const transport: ByteTransport = await Effect.runPromise(
      Scope.provide(scope)(relaySessionTransport(relay, host, generateStaticKeyPair()))
    );

    const sessionKey = relay.sessionKeys().find((k) => !before.has(k)) ?? "";

    return {
      transport,
      sessionKey,
      close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
    };
  };

  return { relay, host, connect };
};

const next = (transport: ByteTransport, count = 1) =>
  Effect.runPromise(Stream.runCollect(Stream.take(transport.incoming, count))).then((chunks) =>
    chunks.map((bytes) => read.decode(bytes))
  );

const ended = (transport: ByteTransport) =>
  Effect.runPromise(Effect.exit(Stream.runCollect(transport.incoming))).then(Exit.isSuccess);

describe("relay sessions sharing one socket", () => {
  test("closing one Account's session leaves the other's stream and a pending request working", async () => {
    const { relay, connect } = await setup();
    const work = await connect();
    const personal = await connect();

    // Personal heard last: the socket is quiet since its latest record when it closes.
    relay.fromHost(work.sessionKey, "work hello");
    expect(await next(work.transport)).toEqual(["work hello"]);
    relay.fromHost(personal.sessionKey, "personal hello");
    expect(await next(personal.transport)).toEqual(["personal hello"]);

    await Effect.runPromise(work.transport.write(text.encode("request 1")));
    await personal.close();

    expect(relay.recycled).toEqual([]);
    expect(relay.received.get(work.sessionKey)).toEqual(["request 1"]);
    relay.fromHost(work.sessionKey, "response 1");
    expect(await next(work.transport)).toEqual(["response 1"]);
    await Effect.runPromise(work.transport.write(text.encode("request 2")));
    expect(relay.received.get(work.sessionKey)).toEqual(["request 1", "request 2"]);
    await work.close();
  });

  test("the last session closing on a quiet socket recycles it", async () => {
    const { relay, connect } = await setup();
    const only = await connect();
    relay.fromHost(only.sessionKey, "hello");
    await next(only.transport);

    await only.close();

    expect(relay.recycled).toEqual(["the relay went quiet"]);
  });

  test("a handshake the relay never answers recycles the socket, ending the other live session", async () => {
    const { relay, host, connect } = await setup();
    const work = await connect();
    const workEnded = ended(work.transport);
    relay.silent = true;

    const failed = await openSession(relay, host, generateStaticKeyPair(), undefined, 50).then(
      () => null,
      (error: Error) => error.message
    );

    expect(failed).toBe("the Host did not answer the handshake");
    expect(relay.recycled).toEqual(["the relay stopped answering"]);
    expect(await workEnded).toBe(true);
  });
});
