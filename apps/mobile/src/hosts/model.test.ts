import { expect, test } from "bun:test";
import { buildHosts, hostDetails, type HostInput } from "./model.ts";

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
  input({ name: "lucas-rpi", state: "reconnecting", lastSeenAt: NOW - 42_000, latencyMs: 30 }),
  input({ name: "mac-studio", state: "connected", route: "dev-bridge", latencyMs: 4, sessions: 6 }),
  input({ name: "build-vm", state: "offline", lastSeenAt: NOW - 3 * 3600_000, sessions: 2 }),
  input({ name: "gpu-box", state: "connected", latencyMs: 181.6, sessions: 1 }),
];

const rows = (model: ReturnType<typeof buildHosts>) =>
  model.sections.map((section) => [
    section.title,
    section.rows.map((row) => [row.name, row.line, row.roundTrip, row.route]),
  ]);

test("hosts that aren't connected group under Needs a look, above Connected (MX-AD)", () => {
  expect(rows(buildHosts(hosts, NOW))).toEqual([
    [
      "Needs a look",
      [
        ["lucas-rpi", "Reconnecting · 42s", "—", "via Polaris Relay"],
        ["build-vm", "Offline · last seen 3h ago", "—", "via Polaris Relay"],
      ],
    ],
    [
      "Connected",
      [
        ["gpu-box", "1 agent session", "182 ms", "via Polaris Relay"],
        ["mac-studio", "6 agent sessions", "4 ms", "on this network"],
      ],
    ],
  ]);
});

test("needs attention leads Needs a look, and the summary counts each state", () => {
  const model = buildHosts([...hosts, input({ name: "z-box", state: "needs-attention" })], NOW);

  expect(model.sections[0]?.rows[0]?.name).toBe("z-box");
  expect(model.summary).toBe("5 linked · 1 needs attention · 1 reconnecting · 1 offline");
});

test("a group with no hosts is left out", () => {
  const model = buildHosts([input({ name: "a", state: "connected" })], NOW);

  expect(model.sections.map((section) => section.title)).toEqual(["Connected"]);
  expect(model.summary).toBe("1 linked");
});

test("the details sheet says how long the state has lasted and keeps the last failure", () => {
  const details = hostDetails(
    input({
      name: "lucas-rpi",
      state: "reconnecting",
      lastSeenAt: NOW - 42_000,
      latencyMs: 30,
      failure: "relay: tunnel closed by peer (ECONNRESET)",
      sessions: 3,
    }),
    NOW
  );

  expect(details).toMatchObject({
    status: "Reconnecting for 42s",
    failure: "relay: tunnel closed by peer (ECONNRESET)",
    roundTrip: "—",
    sessions: "3",
    sessionsLabel: "Agent sessions, last known",
  });
});

test("a connected host's details show its round trip and how long it has been up", () => {
  const details = hostDetails(
    input({ name: "gpu-box", state: "connected", lastSeenAt: NOW - 2 * 3600_000, latencyMs: 4 }),
    NOW
  );

  expect([details.status, details.roundTrip, details.sessions]).toEqual([
    "Connected for 2h",
    "4 ms",
    "—",
  ]);
});
