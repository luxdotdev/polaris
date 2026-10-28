import { describe, expect, test } from "bun:test";
import { type ConnectionState, type HostStreamItem, RequestId } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "../feed/fold.ts";
import {
  commandApproval,
  constellation,
  minutesAgo,
  question,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "../fixtures.testing.ts";
import { buildHome, type HomeHost, type HomeRow, RECENT_LIMIT } from "./home.ts";

const host = (
  name: string,
  items: ReadonlyArray<HostStreamItem> | null,
  connection: ConnectionState = "connected"
): HomeHost => ({
  hostId: name,
  name,
  connection,
  followed:
    items === null
      ? { state: emptyHostFeed, seen: false, error: null }
      : { state: items.reduce(applyHostItem, emptyHostFeed), seen: true, error: null },
});

const keys = (rows: ReadonlyArray<HomeRow>) => rows.map((row) => row.key.split("/").at(-1));

const studio = host("Mac Studio", [
  snapshot({
    workspaces: [workspace("w1", "polaris"), workspace("w2", "nj-homes")],
    sessions: [
      summary(session({ id: "spike", state: "needs-you", updatedAt: minutesAgo(1) }), [
        commandApproval("spike", "r1", "cargo build --release", minutesAgo(42)),
      ]),
      summary(session({ id: "form", state: "needs-you", workspaceId: "w2" }), [
        question("form", "r2", "Monthly or annually?", ["Annual", "Monthly"]),
      ]),
      summary(session({ id: "planning", state: "working", updatedAt: minutesAgo(1) })),
      summary(session({ id: "lead", state: "working", updatedAt: minutesAgo(0) })),
      summary(session({ id: "relay", state: "working", updatedAt: minutesAgo(4) })),
      summary(session({ id: "proto", state: "idle", updatedAt: minutesAgo(180) })),
      summary(session({ id: "old", state: "archived" })),
    ],
    constellations: [constellation("overhaul", "lead")],
  }),
  synchronized(),
]);

describe("sections", () => {
  const home = buildHome([studio], null);

  test("needs you holds every pending approval and question, oldest first", () => {
    expect(keys(home.sections.needsYou)).toEqual(["spike", "form"]);
    expect(home.sections.needsYou[0]?.approval?.id).toBe(RequestId.make("r1"));
  });

  test("a constellation is one working row in place of its lead, newest first", () => {
    expect(keys(home.sections.working)).toEqual(["overhaul", "planning", "relay"]);
  });

  test("recent has the rest without archived agent sessions", () => {
    expect(keys(home.sections.recent)).toEqual(["proto"]);
  });

  test("the summary counts needs you and working apart", () => {
    expect([home.needsYou, home.working]).toEqual([2, 3]);
  });

  test(`recent keeps the newest ${RECENT_LIMIT}`, () => {
    const many = host("Pi", [
      snapshot({
        sessions: Array.from({ length: RECENT_LIMIT + 5 }, (_, n) =>
          summary(session({ id: `s${n}`, updatedAt: minutesAgo(n) }))
        ),
      }),
    ]);

    const recent = buildHome([many], null).sections.recent;

    expect(recent).toHaveLength(RECENT_LIMIT);
    expect(keys(recent)[0]).toBe("s0");
  });
});

describe("workspaces", () => {
  test("a chip narrows every section to that workspace", () => {
    const home = buildHome([studio], "nj-homes");

    expect(keys(home.sections.needsYou)).toEqual(["form"]);
    expect(home.sections.working).toEqual([]);
  });

  test("chips list every workspace once across Hosts, most recently active first", () => {
    const names = Array.from({ length: 12 }, (_, n) => `ws-${String(n).padStart(2, "0")}`);

    const a = host("A", [
      snapshot({ workspaces: names.slice(0, 8).map((name) => workspace(name)) }),
    ]);

    const b = host("B", [
      snapshot({
        workspaces: names.slice(6).map((name) => workspace(name)),
        sessions: [summary(session({ id: "x", workspaceId: "ws-11" }))],
      }),
    ]);

    const home = buildHome([a, b], null);

    expect(home.workspaceCount).toBe(12);
    expect(home.chips.map((chip) => chip.label).slice(0, 3)).toEqual([
      "All workspaces",
      "ws-11",
      "ws-00",
    ]);
  });
});

describe("Hosts that aren't connected", () => {
  test.each([
    [["connected", "reconnecting"], "B reconnecting"],
    [["offline", "connected"], "A offline"],
    [["offline", "offline"], "All hosts offline"],
    [["reconnecting", "reconnecting"], "All hosts reconnecting"],
    [["offline", "reconnecting", "connected"], "2 hosts not connected"],
    [["connected", "connected"], null],
  ] as const)("%p reads %p", (states, line) => {
    const hosts = states.map((state, n) => host(String.fromCharCode(65 + n), [snapshot()], state));

    expect(buildHome(hosts, null).attention).toBe(line);
  });

  test("their rows stay, as last seen, and can't be acted on", () => {
    const away = { ...studio, connection: "reconnecting" as const };
    const row = buildHome([away], null).sections.needsYou[0];

    expect(row?.stale).toBe(true);
    expect(row?.approval?.id).toBe(RequestId.make("r1"));
  });
});

describe("empty", () => {
  test.each([
    ["no Host", [], null, "no-hosts"],
    ["Hosts never reached", [host("A", null, "offline")], null, "unreachable"],
    [
      "a Host with no agent sessions",
      [host("A", [snapshot(), synchronized()])],
      null,
      "no-sessions",
    ],
    ["a workspace with none", [studio], "dcai", "filtered"],
    ["agent sessions to show", [studio], null, null],
  ] as const)("%s", (_, hosts, filter, empty) => {
    expect(buildHome(hosts, filter).empty).toBe(empty);
  });
});
