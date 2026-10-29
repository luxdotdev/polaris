import { expect, test } from "bun:test";
import { fromBase64Url, PUSH_ENC_BYTES, toBase64Url } from "@polaris/protocol/relay";
import { Option, Schema } from "effect";
import {
  HostSlice,
  LIVE_HPKE_INFO,
  liveActivityBody,
  MAX_LIVE_HOSTS,
  MAX_LIVE_SLICE_CHARS,
  sealSlice,
} from "./live.ts";
import { pushSuite } from "./seal.ts";

const keys = await pushSuite.kem.generateKeyPair();

const pushKey = toBase64Url(new Uint8Array(await pushSuite.kem.serializePublicKey(keys.publicKey)));

const open = async (sealed: string) => {
  const bytes = Option.getOrThrow(fromBase64Url(sealed));

  const recipient = await pushSuite.createRecipientContext({
    recipientKey: keys.privateKey,
    enc: new Uint8Array(bytes.subarray(0, PUSH_ENC_BYTES)),
    info: new TextEncoder().encode(LIVE_HPKE_INFO),
  });

  const plain = new TextDecoder().decode(
    await recipient.open(new Uint8Array(bytes.subarray(PUSH_ENC_BYTES)))
  );

  return Schema.decodeUnknownSync(Schema.fromJsonString(HostSlice))(plain);
};

const atLimits = (char: string): HostSlice => ({
  v: 1,
  hostId: "host-1",
  host: char.repeat(64 / char.length),
  seq: 41,
  working: 3,
  since: 1_793_000_000,
  step: {
    at: 1_793_000_100,
    sessionId: "s1",
    session: char.repeat(200 / char.length),
    line: char.repeat(400 / char.length),
  },
  need: {
    at: 1_793_000_050,
    sessionId: "s2",
    session: char.repeat(200 / char.length),
    line: char.repeat(400 / char.length),
    requestId: "r1",
    kind: "approval",
  },
  needs: 2,
});

test.each([
  ["ASCII", "a"],
  ["CJK", "需"],
  ["emoji", "🦀"],
])("a %s slice at its limits seals within its share and keeps what answers", async (_, char) => {
  const sealed = await sealSlice(pushKey, atLimits(char));

  expect(sealed.length).toBeLessThanOrEqual(MAX_LIVE_SLICE_CHARS);

  const opened = await open(sealed);

  expect(opened.need?.requestId).toBe("r1");
  expect(opened.need?.sessionId).toBe("s2");
  expect(opened.since).toBe(1_793_000_000);
  expect(atLimits(char).step?.line.startsWith(opened.step?.line.replace(/…$/, "") ?? "x")).toBe(
    true
  );
});

test("a short slice is sealed unchanged", async () => {
  const slice: HostSlice = { ...atLimits("a"), host: "studio", step: null, need: null, needs: 0 };

  expect(await open(await sealSlice(pushKey, slice))).toEqual(slice);
});

test("every Host the activity carries fits one liveactivity push, takeover alert included", async () => {
  const slices = await Promise.all(
    Array.from({ length: MAX_LIVE_HOSTS }, () => sealSlice(pushKey, atLimits("🦀")))
  );

  const body = liveActivityBody({
    event: "update",
    timestamp: 1_793_000_200,
    state: { v: 1, slices },
    alert: true,
  });

  // APNs refuses a liveactivity payload over 4 KB.
  expect(new TextEncoder().encode(body).byteLength).toBeLessThanOrEqual(4096);
});
