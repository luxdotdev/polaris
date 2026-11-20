import { afterEach, describe, expect, test } from "bun:test";
import {
  decodeDataFrame,
  encodeControl,
  type RelayAddress,
  relayAddress,
  toBase64Url,
} from "@polaris/protocol/relay";
import { generateRelayIdentity } from "@polaris/protocol/relay/party";
import { Option, Predicate } from "effect";
import { RelaySocket } from "./socket.ts";

const LIMITS = {
  maxMessageBytes: 1 << 20,
  maxPeers: 64,
  messagesPerSecond: 1_000,
  bytesPerSecond: 1 << 24,
  authTimeoutMs: 5_000,
  idleTimeoutSeconds: 60,
};

/** A relay that checks no proof: it greets each socket as `address` and, while `answering`, answers forwards. */
const fakeRelay = (address: RelayAddress) => {
  const state = { dials: 0, probes: 0, answering: true };

  const server = Bun.serve({
    port: 0,
    fetch: (request, upgrading) =>
      upgrading.upgrade(request) ? undefined : new Response(null, { status: 400 }),
    websocket: {
      open: (ws) => {
        state.dials++;
        const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
        ws.send(encodeControl({ t: "challenge", v: 1, nonce, limits: LIMITS }));
      },
      message: (ws, message) => {
        if (Predicate.isString(message)) {
          ws.send(encodeControl({ t: "ready", address }));

          return;
        }

        // Only probes travel here, each to the device's own address.
        if (Option.isNone(decodeDataFrame(new Uint8Array(message)))) return;
        state.probes++;

        if (state.answering) ws.send(encodeControl({ t: "unreachable", peer: address }));
      },
    },
  });

  return { state, url: `ws://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
};

const until = async (holds: () => boolean) => {
  for (const deadline = Date.now() + 1_000; !holds(); await Bun.sleep(5))
    if (Date.now() > deadline) throw new Error("timed out");
};

const cleanups: Array<() => void> = [];

afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

/** A ready socket with a session listening for a Host, and what that session lost. */
const setup = async () => {
  const identity = generateRelayIdentity();
  const relay = fakeRelay(await relayAddress(identity.publicKey));

  const socket = new RelaySocket({
    url: relay.url,
    identity,
    reconnect: true,
    backoff: () => 10,
    probeTimeoutMs: 100,
  });

  cleanups.push(() => socket.stop(), relay.stop);
  socket.start();
  await until(() => socket.isReady);

  const lost: Array<string> = [];
  const host = await relayAddress(generateRelayIdentity().publicKey);
  socket.listen(host, { record: () => undefined, lost: (reason) => lost.push(reason) });

  return { relay, socket, lost };
};

describe("a relay socket a session found quiet", () => {
  test("is kept, with the sessions on it, when the relay answers its probe", async () => {
    const { relay, socket, lost } = await setup();

    // A second probe goes out only once the first one's wait ended.
    await until(() => {
      socket.suspect("the relay stopped answering");

      return relay.state.probes >= 2;
    });

    expect(lost).toEqual([]);
    expect(relay.state.dials).toBe(1);
    expect(socket.isReady).toBe(true);
  });

  test("is redialled, ending the sessions on it, when the relay answers nothing", async () => {
    const { relay, socket, lost } = await setup();
    relay.state.answering = false;

    socket.suspect("the relay stopped answering");
    await until(() => relay.state.dials === 2);

    expect(lost).toEqual(["the relay stopped answering"]);
  });
});
