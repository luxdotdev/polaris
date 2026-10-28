import { expect, test } from "bun:test";
import { buildHosts, type HostInput } from "./model.ts";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");

const input = (overrides: Partial<HostInput> & Pick<HostInput, "name" | "state">): HostInput => ({
  hostId: overrides.name,
  route: "relay",
  failure: null,
  latencyMs: null,
  lastSeenAt: null,
  sessions: null,
  ...overrides,
});

const hosts = [
  input({ name: "lucas-rpi", state: "offline", lastSeenAt: NOW - 3 * 3600_000, sessions: null }),
  input({ name: "Linux VM", state: "reconnecting", lastSeenAt: NOW - 42_000, sessions: 2 }),
  input({
    name: "MacBook Air",
    state: "connected",
    route: "dev-bridge",
    latencyMs: 4,
    sessions: 1,
  }),
  input({ name: "Mac Studio", state: "connected", latencyMs: 38.4, sessions: 5 }),
];

test("each Host says its Connection State and route, connected first", () => {
  expect(
    buildHosts(hosts, NOW).rows.map((row) => [row.name, row.line, row.count, row.countLabel])
  ).toEqual([
    ["Mac Studio", "Connected · 38 ms · via Polaris Relay", "5", "agent sessions"],
    ["MacBook Air", "Connected · 4 ms · on this network", "1", "agent session"],
    ["Linux VM", "Reconnecting · 42s · via Polaris Relay", "2", "last known"],
    ["lucas-rpi", "Offline · last seen 3h ago", "0", "agent sessions"],
  ]);
});

test("the summary counts each state and stresses reconnecting", () => {
  expect(buildHosts(hosts, NOW).summary).toEqual([
    { text: "2 connected", emphasis: false },
    { text: "1 reconnecting", emphasis: true },
    { text: "1 offline", emphasis: false },
  ]);
});

test("needs attention comes first and says why", () => {
  const rows = buildHosts(
    [...hosts, input({ name: "Build box", state: "needs-attention", failure: "Pair again" })],
    NOW
  ).rows;

  expect([rows[0]?.name, rows[0]?.line]).toEqual(["Build box", "Needs attention · Pair again"]);
});

test("without a measured round trip the latency is left out", () => {
  const [row] = buildHosts([input({ name: "A", state: "connected" })], NOW).rows;

  expect(row?.line).toBe("Connected · via Polaris Relay");
});
