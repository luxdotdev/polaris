import { expect, test } from "bun:test";
import type { HomeHost } from "../model/home.ts";
import { emptyHostFeed } from "./fold.ts";
import { settledHosts } from "./settled.ts";

const host = (hostId: string, connection: HomeHost["connection"]): HomeHost => ({
  hostId,
  name: hostId,
  connection,
  followed: { state: emptyHostFeed, seen: true, error: null },
});

// ENG-498: a reconnect shorter than the grace period doesn't dim Home.
test("a Host that went away less than the grace period ago still shows connected", () => {
  const { hosts, nextAt } = settledHosts(
    [host("mac", "reconnecting")],
    new Map([["mac", 1_000]]),
    2_000,
    3_000
  );

  expect(hosts.map((h) => h.connection)).toEqual(["connected"]);
  expect(nextAt).toBe(4_000);
});

test("once the grace period runs out, it shows as it is", () => {
  const { hosts, nextAt } = settledHosts(
    [host("mac", "offline"), host("pi", "connected")],
    new Map([["mac", 1_000]]),
    4_000,
    3_000
  );

  expect(hosts.map((h) => h.connection)).toEqual(["offline", "connected"]);
  expect(nextAt).toBeNull();
});
