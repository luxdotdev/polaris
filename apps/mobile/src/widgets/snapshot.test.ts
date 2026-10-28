import { describe, expect, test } from "bun:test";
import type { ConnectionState, HostStreamItem } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "../home/feed/fold.ts";
import {
  commandApproval,
  constellation,
  minutesAgo,
  NOW,
  question,
  session,
  snapshot,
  summary,
  synchronized,
  workspace,
} from "../home/fixtures.testing.ts";
import { buildHome, type HomeHost } from "../home/model/home.ts";
import { routeOfLink } from "./links.ts";
import { widgetSnapshot } from "./snapshot.ts";

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

const studioItems = [
  snapshot({
    workspaces: [workspace("w1", "polaris"), workspace("w2", "nj-homes")],
    sessions: [
      summary(session({ id: "spike", title: "Spike GPUI review screen", state: "needs-you" }), [
        commandApproval("spike", "r1", "cargo build --release", minutesAgo(42)),
      ]),
      summary(session({ id: "form", state: "needs-you", workspaceId: "w2" }), [
        question("form", "r2", "Monthly or annually?", ["Annual", "Monthly"]),
      ]),
      summary(
        session({
          id: "planning",
          title: "Polaris planning",
          state: "working",
          turnCount: 24,
          updatedAt: minutesAgo(1),
        })
      ),
      summary(session({ id: "relay", state: "working", updatedAt: minutesAgo(4) })),
      summary(session({ id: "proto", state: "idle", updatedAt: minutesAgo(180) })),
    ],
  }),
  synchronized(),
];

const studio = host("Mac Studio", studioItems);

const snapshotOf = (hosts: ReadonlyArray<HomeHost>) =>
  widgetSnapshot(buildHome(hosts, null), hosts.filter((h) => h.connection === "connected").length);

describe("the widget snapshot", () => {
  test("W1's summary is Home's counts", () => {
    const { summary: parts } = snapshotOf([studio]);

    expect(parts.map((part) => part.text).join(" · ")).toBe("2 need you · 2 working");
    expect(parts[0]?.tone).toBe("needs-you");
  });

  test("W2 takes needs you first, oldest first, then working with its turn", () => {
    const rows = snapshotOf([studio]).rows;

    expect(rows.map((row) => row.sessionId)).toEqual(["spike", "form", "planning"]);
    expect(rows[0]).toMatchObject({
      title: "Spike GPUI review screen",
      glyph: "needs-you",
      since: NOW - 42 * 60_000,
      turn: null,
    });
    expect(rows[2]).toMatchObject({ glyph: "working", turn: 24, since: null });
  });

  test("each row's link opens its agent session on its Host", () => {
    for (const row of snapshotOf([studio]).rows)
      expect(routeOfLink(row.link)).toEqual({
        screen: "thread",
        hostId: "Mac Studio",
        sessionId: row.sessionId,
      });

    expect(routeOfLink(snapshotOf([studio]).link)).toEqual({ screen: "tabs" });
  });

  test("recent agent sessions fill the rows when little is happening", () => {
    const quiet = host("Mac Studio", [
      snapshot({
        workspaces: [workspace("w1")],
        sessions: [
          summary(session({ id: "done", state: "idle", updatedAt: minutesAgo(10) })),
          summary(session({ id: "broke", state: "failed", updatedAt: minutesAgo(5) })),
        ],
      }),
      synchronized(),
    ]);

    const result = snapshotOf([quiet]);

    expect(result.rows.map((row) => [row.sessionId, row.glyph])).toEqual([
      ["broke", "failed"],
      ["done", "done"],
    ]);
    expect(result.summary.map((part) => part.text)).toEqual(["Nothing needs you"]);
  });

  test("a constellation is never a row; its lead's agent session isn't either", () => {
    const withLead = host("Mac Studio", [
      snapshot({
        workspaces: [workspace("w1")],
        sessions: [summary(session({ id: "lead", state: "working" }))],
        constellations: [constellation("overhaul", "lead")],
      }),
      synchronized(),
    ]);

    expect(snapshotOf([withLead]).rows).toEqual([]);
  });

  test("with no Host connected the counts stand, marked as last seen", () => {
    const result = snapshotOf([host("Mac Studio", studioItems, "offline")]);

    expect(result.stale).toBe(true);
    expect(result.summary.map((part) => part.text)).toEqual([
      "2 need you",
      "2 working",
      "Mac Studio offline",
    ]);
  });

  test.each([
    { hosts: [], summary: "No hosts yet", empty: "Link this iPhone from Polaris on your Mac" },
    {
      hosts: [host("Mac Studio", null)],
      summary: "Nothing needs you",
      empty: "Can't reach your hosts",
    },
    {
      hosts: [host("Mac Studio", [snapshot({ workspaces: [workspace("w1")] }), synchronized()])],
      summary: "Nothing needs you",
      empty: "No agent sessions yet",
    },
  ])("empty: $empty", ({ hosts, summary: line, empty }) => {
    const result = snapshotOf(hosts);

    expect(result.summary.map((part) => part.text).join(" · ")).toStartWith(line);
    expect(result.rows).toEqual([]);
    expect(result.empty).toBe(empty);
  });
});
