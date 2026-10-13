import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionState } from "@polaris/protocol";
import type { HostView } from "../../shared/api.ts";
import { durationLabel, offlineView } from "./offline.ts";
import { setClientPlatform } from "../../shared/platform.ts";

const NOW = Date.parse("2026-10-11T13:02:23Z");

const host = (
  key: string,
  state: ConnectionState,
  patch: Partial<HostView["status"]> = {}
): HostView => ({
  key,
  label: key === "local" ? "MacBook Pro" : key,
  colour: null,
  alias: key === "local" ? null : key,
  proofHarness: false,
  status: {
    state,
    failure: null,
    attempt: 0,
    since: NOW - 23_000,
    nextAttemptAt: state === "connected" ? null : NOW + 8_000,
    host: null,
    capabilities: [],
    epoch: 0,
    latencyMs: null,
    lastSeenAt: null,
    ...patch,
  },
});

const input = (hosts: ReadonlyArray<HostView>, online = true) => ({
  hosts,
  online,
  offlineSince: online ? null : NOW - 134_000,
  now: NOW,
});

// The copy names the Client's machine ("this Mac"); pin the platform it expects.
beforeEach(() => setClientPlatform("darwin"));

afterEach(() => setClientPlatform(null));

describe("offlineView", () => {
  test("hidden while online and any remote Host is connected", () => {
    const hosts = [host("local", "connected"), host("vm", "connected"), host("pi", "reconnecting")];

    expect(offlineView(input(hosts))).toBeNull();
  });

  test("no network: how long, and a row per remote Host with its next try", () => {
    const view = offlineView(
      input(
        [
          host("local", "connected"),
          host("vm", "reconnecting"),
          host("pi", "offline", {
            since: Date.parse("2026-10-11T09:02:00"),
            nextAttemptAt: NOW + 360_000,
          }),
        ],
        false
      )
    );

    expect(view?.reason).toBe("network");
    expect(view?.title).toBe("No network on this Mac · 2m 14s");
    expect(view?.rows.map((r) => [r.label, r.caption])).toEqual([
      ["vm", "Reconnecting… (23s) · next try in 8s"],
      ["pi", "Offline since 09:02 · next try in 6m"],
    ]);
  });

  test("online but every remote Host unreachable: since the last one dropped", () => {
    const view = offlineView(
      input([
        host("local", "connected"),
        host("vm", "reconnecting", { since: NOW - 23_000 }),
        host("studio", "needs-attention", { since: NOW - 90_000, nextAttemptAt: null }),
      ])
    );

    expect(view?.reason).toBe("hosts");
    expect(view?.title).toBe("Can't reach your other hosts · 23s");
    expect(view?.rows.map((r) => r.caption)).toEqual([
      "Reconnecting… (23s) · next try in 8s",
      "Needs attention",
    ]);
  });

  test("only this Mac: offline shows, with no rows", () => {
    const view = offlineView(input([host("local", "connected")], false));

    expect(view?.rows).toEqual([]);
    expect(view?.caption).toBe("Agent sessions on this Mac keep working.");
    expect(offlineView(input([host("local", "connected")]))).toBeNull();
  });

  test("names the Client's own machine on each platform", () => {
    for (const [platform, machine] of [
      ["darwin", "this Mac"],
      ["win32", "this PC"],
      ["linux", "this computer"],
    ] as const) {
      setClientPlatform(platform);
      expect(offlineView(input([host("local", "connected")], false))?.caption).toBe(
        `Agent sessions on ${machine} keep working.`
      );
    }
  });

  test("durations", () => {
    expect([23_000, 134_000, 3_900_000].map(durationLabel)).toEqual(["23s", "2m 14s", "1h 5m"]);
  });
});
