import { expect, test } from "bun:test";
import { revokeOnHosts, type RevokingHost, unlinkFrom } from "./unlink.ts";

// SAFETY: these fakes answer `run` without a client, as a Host that revoked, refused or hung.
const host = (hostId: string, run: () => Promise<void>) => ({ hostId, run }) as RevokingHost;

test("only Hosts that answered count as revoked; a hung or offline Host doesn't hold Unlink", async () => {
  const started = Date.now();

  const revoked = await revokeOnHosts(
    [
      host("studio", () => Promise.resolve()),
      host("pi", () => Promise.reject(new Error("not connected"))),
      host("vm", () => new Promise<never>(() => {})),
    ],
    50
  );

  expect([...revoked]).toEqual(["studio"]);
  expect(Date.now() - started).toBeLessThan(1_000);
});

test("unlinking one Host revokes only it; the others stay linked and keep trusting", async () => {
  const asked: Array<string> = [];

  const answering = (hostId: string) =>
    host(hostId, () => {
      asked.push(hostId);

      return Promise.resolve();
    });

  const linked = [{ hostId: "studio" }, { hostId: "pi" }, { hostId: "vm" }];

  const result = await unlinkFrom(
    linked,
    [answering("studio"), answering("pi"), answering("vm")],
    new Set(["pi"]),
    { revoke: 50, unregister: 50 }
  );

  expect([...result.revoked]).toEqual(["pi"]);
  expect(result.kept.map((h) => h.hostId)).toEqual(["studio", "vm"]);
  expect(result.stillTrusting).toEqual([]);
  expect(asked.every((id) => id === "pi")).toBe(true);
});

test("a targeted Host that doesn't answer stays linked, and is named as still trusting", async () => {
  const result = await unlinkFrom(
    [{ hostId: "studio" }, { hostId: "pi" }],
    [host("pi", () => Promise.reject(new Error("not connected")))],
    new Set(["pi"]),
    { revoke: 50, unregister: 50 }
  );

  expect(result.kept.map((h) => h.hostId)).toEqual(["studio", "pi"]);
  expect(result.stillTrusting.map((h) => h.hostId)).toEqual(["pi"]);
});
