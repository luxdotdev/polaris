import { expect, test } from "bun:test";
import { Predicate } from "effect";
import { DEVICES_MAX_BYTES, fetchDevices, MAX_DEVICES_PER_SHARE } from "./issuer.ts";
import type { Fetch } from "./statement.ts";

const ISSUER = "https://accounts.test";

const ADDRESS = "A".repeat(22);

const listed = (noiseKey: string, statement = "a.b.c") => ({
  personId: "p1",
  relayAddress: ADDRESS,
  noiseKey,
  statement,
});

const ask = (fetch: Fetch) =>
  fetchDevices(fetch, { issuer: ISSUER, inviteId: "inv", capability: "cap", etag: null, waitS: 0 });

const keysOf = async (fetch: Fetch) => {
  const answer = await ask(fetch);

  return Predicate.isTagged(answer, "Devices")
    ? answer.devices.map((device) => device.noiseKey)
    : answer._tag;
};

const answering =
  (body: string, headers: Record<string, string> = {}): Fetch =>
  () =>
    Promise.resolve(new Response(body, { headers }));

test("an issuer's list is read: its devices and its ETag", async () => {
  const answer = await ask(answering(JSON.stringify([listed("k1")]), { etag: '"v1"' }));

  expect(answer).toMatchObject({ etag: '"v1"', devices: [listed("k1")] });
});

test("a devices answer past the byte limit is not read to its end and changes nothing", async () => {
  const bytes = new TextEncoder().encode(
    `${JSON.stringify([listed("k1")])}${" ".repeat(4 * 1024 * 1024)}`
  );

  let pulled = 0;

  const fetch: Fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          pull: (controller) => {
            if (pulled >= bytes.length) {
              controller.close();

              return;
            }

            controller.enqueue(bytes.slice(pulled, pulled + 8192));
            pulled += 8192;
          },
        })
      )
    );

  expect(await keysOf(fetch)).toBe("Unreachable");
  expect(pulled).toBeLessThan(DEVICES_MAX_BYTES * 2);
});

test("an answer that declares more than the limit is refused before any of it is read", async () => {
  const fetch = answering(JSON.stringify([listed("k1")]), {
    "content-length": String(DEVICES_MAX_BYTES + 1),
  });

  expect(await keysOf(fetch)).toBe("Unreachable");
});

test("an answer that arrives from another origin is not the issuer's", async () => {
  const fetch: Fetch = () => {
    const response = new Response(JSON.stringify([listed("k1")]));
    Object.defineProperty(response, "url", { value: "https://evil.test/v1/shares/inv/devices" });

    return Promise.resolve(response);
  };

  expect(await keysOf(fetch)).toBe("Unreachable");
});

test("a list is cut to the device limit, and an oversized entry or ETag is left out", async () => {
  const many = Array.from({ length: MAX_DEVICES_PER_SHARE + 8 }, (_, at) => listed(`k${at}`));

  expect(await keysOf(answering(JSON.stringify(many)))).toHaveLength(MAX_DEVICES_PER_SHARE);

  const oversized = [listed("k1", "x".repeat(5000)), listed("k".repeat(300)), listed("k2")];
  const answer = await ask(answering(JSON.stringify(oversized), { etag: "e".repeat(300) }));

  expect(answer).toMatchObject({ etag: null, devices: [listed("k2")] });
});
