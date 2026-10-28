import { expect, test } from "bun:test";
import { revokeOnHosts, type RevokingHost } from "./unlink.ts";

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
