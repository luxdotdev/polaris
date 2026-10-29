import { describe, expect, test } from "bun:test";
import type { ConnectionStatusView, HostView } from "../../../../shared/api.ts";
import { hostArt, routeWords, rowsOf, stateParts, statusLine } from "./model.ts";

const host = (
  label: string,
  state: ConnectionStatusView["state"] = "connected",
  patch: Partial<HostView> = {}
): HostView => ({
  key: label,
  label,
  colour: null,
  alias: label,
  kind: "ssh",
  proofHarness: false,
  status: {
    state,
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 1,
    latencyMs: null,
    lastSeenAt: null,
  },
  ...patch,
});

describe("statusLine", () => {
  test.each([
    ["no hosts", [], "no hosts"],
    ["one connected", [host("Mac Studio")], "connected"],
    ["all connected", [host("Mac Studio"), host("Linux VM")], "all 2 connected"],
    [
      "names the one host retrying",
      [host("Mac Studio"), host("Linux VM"), host("Raspberry Pi 4", "reconnecting")],
      "2 of 3 connected · Raspberry Pi 4 retrying",
    ],
    [
      "counts several, worst first",
      [
        host("Mac Studio", "offline"),
        host("Linux VM", "reconnecting"),
        host("Pi", "reconnecting"),
        host("Box", "needs-attention"),
      ],
      "0 of 4 connected · Box needs attention · 2 retrying · Mac Studio offline",
    ],
  ])("%s", (_, hosts, line) => {
    expect(statusLine(hosts)).toBe(line);
  });
});

describe("stateParts", () => {
  test("a reconnecting host says for how long", () => {
    expect(stateParts(host("Pi", "reconnecting"), "12s", false)).toEqual(["reconnecting", "12s"]);
  });

  test("a slow link says its round trip", () => {
    const slow = host("VM");

    expect(
      stateParts({ ...slow, status: { ...slow.status, latencyMs: 310 } }, undefined, true)
    ).toEqual(["slow link", "310ms"]);
  });

  test("needs attention never shows a time", () => {
    expect(stateParts(host("Box", "needs-attention"), "3s", false)).toEqual(["needs attention"]);
  });
});

describe("hostArt", () => {
  test.each([
    ["ssh", "darwin-arm64", "mac"],
    ["ssh", "linux-arm64", "board"],
    ["ssh", "linux-x64", "server"],
    ["ssh", undefined, "server"],
    ["wsl", "linux-x64", "virtual"],
  ] as const)("%s on %s draws a %s", (kind, platform, art) => {
    expect(hostArt(kind, platform)).toBe(art);
  });
});

test("routeWords names each way the hosts are reached, once", () => {
  expect(routeWords([host("A"), host("B"), host("W", "connected", { kind: "wsl" })])).toEqual([
    "ssh",
    "wsl",
  ]);
});

test("rowsOf wraps past four hosts", () => {
  expect(rowsOf([1, 2, 3, 4, 5]).map((r) => r.length)).toEqual([4, 1]);
});
