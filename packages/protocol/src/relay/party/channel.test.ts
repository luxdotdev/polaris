import { describe, expect, test } from "bun:test";
import Noise from "noise-handshake";
import CipherState from "noise-handshake/cipher";
import { encodeBlob, encodeJsonFrame, FrameDecoder } from "../../frame.ts";
import {
  acceptHandshake,
  generateStaticKeyPair,
  MAX_PLAINTEXT_CHUNK,
  RelayChannelError,
  RelayInitiator,
  type RelaySession,
} from "./channel.ts";

const sameKey = (a: Uint8Array) => (b: Uint8Array) => Buffer.compare(a, b) === 0;

const linkedPair = () => {
  const host = generateStaticKeyPair();
  const device = generateStaticKeyPair();
  const initiator = new RelayInitiator(device, host.publicKey);
  const accepted = acceptHandshake(host, initiator.init, sameKey(device.publicKey));

  return {
    host,
    device,
    hostSession: accepted.session,
    deviceSession: initiator.finish(accepted.reply),
  };
};

const reason = (run: () => void): RelayChannelError["reason"] | "no error" => {
  try {
    run();
  } catch (error) {
    if (error instanceof RelayChannelError) return error.reason;
    throw error;
  }

  return "no error";
};

const openAll = (session: RelaySession, records: ReadonlyArray<Uint8Array>) => {
  const decoder = new FrameDecoder();

  return records.flatMap((record) => decoder.push(session.open(record)));
};

describe("relay channel", () => {
  test("both sides prove their static keys and agree on the handshake", () => {
    const { host, device, hostSession, deviceSession } = linkedPair();

    expect(Buffer.from(hostSession.remoteStatic)).toEqual(Buffer.from(device.publicKey));
    expect(Buffer.from(deviceSession.remoteStatic)).toEqual(Buffer.from(host.publicKey));
    expect(Buffer.from(hostSession.handshakeHash)).toEqual(
      Buffer.from(deviceSession.handshakeHash)
    );
  });

  test("protocol frames larger than one Noise message cross intact, both ways", () => {
    const { hostSession, deviceSession } = linkedPair();
    const blob = crypto.getRandomValues(new Uint8Array(200_000));
    const frames = [encodeJsonFrame('{"hello":"device"}'), ...encodeBlob("b1", blob)];
    const records = frames.flatMap((frame) => deviceSession.seal(frame));

    expect(records.length).toBeGreaterThan(frames.length);
    const received = openAll(hostSession, records);
    expect(received[0]).toEqual({ kind: "json", text: '{"hello":"device"}' });
    expect(received[1]).toEqual({
      kind: "blob",
      blobId: "b1",
      final: true,
      aborted: false,
      bytes: blob,
    });

    const back = openAll(deviceSession, hostSession.seal(encodeJsonFrame('{"hello":"host"}')));
    expect(back).toEqual([{ kind: "json", text: '{"hello":"host"}' }]);
  });

  test("records never carry the plaintext", () => {
    const { deviceSession } = linkedPair();
    const marker = "plaintext-marker-6d1f";
    const records = deviceSession.seal(new TextEncoder().encode(marker.repeat(5_000)));

    for (const record of records) expect(Buffer.from(record).includes(marker)).toBe(false);
    expect(records.every((r) => r.byteLength <= 9 + MAX_PLAINTEXT_CHUNK + 16)).toBe(true);
  });

  test("the host refuses a device it did not link, before replying", () => {
    const host = generateStaticKeyPair();
    const stranger = new RelayInitiator(generateStaticKeyPair(), host.publicKey);

    expect(reason(() => acceptHandshake(host, stranger.init, () => false))).toBe("not-linked");
  });

  test("a device dialing the wrong host key cannot complete", () => {
    const host = generateStaticKeyPair();
    const impostor = generateStaticKeyPair();
    const device = generateStaticKeyPair();
    const initiator = new RelayInitiator(device, host.publicKey);

    expect(reason(() => acceptHandshake(impostor, initiator.init, () => true))).toBe(
      "decrypt-failed"
    );
  });

  test("a tampered, replayed or skipped record fails authentication", () => {
    const { hostSession, deviceSession } = linkedPair();
    const records = deviceSession.seal(new Uint8Array(MAX_PLAINTEXT_CHUNK * 2 + 1));

    const tampered = records[0]!.slice();
    tampered[20] = (tampered[20] ?? 0) ^ 1;
    expect(reason(() => hostSession.open(tampered))).toBe("decrypt-failed");

    hostSession.open(records[0]!);
    expect(reason(() => hostSession.open(records[0]!))).toBe("decrypt-failed");
    expect(reason(() => hostSession.open(records[2]!))).toBe("decrypt-failed");
    expect(hostSession.open(records[1]!).byteLength).toBe(MAX_PLAINTEXT_CHUNK);
  });

  test("a record from another session is refused by its tag", () => {
    const a = linkedPair();
    const b = linkedPair();

    expect(reason(() => a.hostSession.open(b.deviceSession.seal(new Uint8Array(4))[0]!))).toBe(
      "malformed"
    );
  });

  // RV6 / RX1-9: an independent IK initiator keys transport as Noise's Split says.
  test("a plain Noise IK initiator talks to the host with the specification's key directions", () => {
    const host = generateStaticKeyPair();
    const device = generateStaticKeyPair();
    const initiator = new Noise("IK", true, device);
    initiator.initialise(new TextEncoder().encode("polaris-relay-e2e/2"), host.publicKey);
    const tag = new Uint8Array(8).fill(9);
    const record = (type: number, body: Uint8Array) => Uint8Array.from([type, ...tag, ...body]);
    const accepted = acceptHandshake(host, record(1, initiator.send()), sameKey(device.publicKey));
    initiator.recv(accepted.reply.subarray(9));
    const ad = record(3, new Uint8Array(0));

    // Split's first key, initiator → responder; the second, responder → initiator.
    const toHost = new CipherState(initiator.tx).encrypt(new TextEncoder().encode("hi"), ad);
    expect(new TextDecoder().decode(accepted.session.open(record(3, toHost)))).toBe("hi");

    const [fromHost] = accepted.session.seal(new TextEncoder().encode("hello"));
    const body = (fromHost ?? new Uint8Array()).subarray(9);
    expect(new TextDecoder().decode(new CipherState(initiator.rx).decrypt(body, ad))).toBe("hello");
  });
});
