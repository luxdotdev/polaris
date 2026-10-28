import { expect, test } from "bun:test";
import {
  decodeClientControl,
  decodePushMessage,
  type PushMessage,
  toBase64Url,
} from "@polaris/protocol/relay";
import { Option } from "effect";
import { openPush, pushSuite, sealPush } from "./seal.ts";

const keys = await pushSuite.kem.generateKeyPair();

const pushKey = toBase64Url(new Uint8Array(await pushSuite.kem.serializePublicKey(keys.publicKey)));

const atLimits = (char: string): PushMessage => ({
  v: 1,
  kind: "needs-you",
  hostId: "host-1",
  hostName: "studio",
  sessionId: "s1",
  requestId: "r1",
  category: "approval",
  title: char.repeat(120 / char.length),
  subtitle: char.repeat(160 / char.length),
  body: char.repeat(600 / char.length),
  at: "2026-10-28T00:00:00.000Z",
});

const wakeOf = (payload: string) =>
  JSON.stringify({
    t: "wake",
    id: "w1",
    peer: "A".repeat(22),
    token: "ab".repeat(32),
    environment: "sandbox",
    ticket: { key: "k", sig: "s" },
    payload,
  });

// RV3 / RX1-6: valid CJK or emoji text must not make a wake the relay rejects.
test.each([
  ["CJK", "需"],
  ["emoji", "🦀"],
  ["control characters", "\u0001"],
])("a schema-valid %s push still seals into a wake the relay accepts", async (_, char) => {
  const message = atLimits(char);
  const payload = await sealPush(pushKey, message);

  expect(Option.isSome(decodeClientControl(wakeOf(payload)))).toBe(true);

  const opened = Option.getOrThrow(decodePushMessage(await openPush(keys.privateKey, payload)));

  // The answerable parts survive; only the display text is cut.
  expect(opened.requestId).toBe("r1");
  expect(message.body.startsWith(opened.body.replace(/…$/, ""))).toBe(true);
});

test("a short push is sealed unchanged", async () => {
  const message = { ...atLimits("a"), body: "Run tests?" };
  const opened = await openPush(keys.privateKey, await sealPush(pushKey, message));

  expect(Option.getOrThrow(decodePushMessage(opened))).toEqual(message);
});
