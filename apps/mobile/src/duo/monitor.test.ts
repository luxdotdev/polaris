import { describe, expect, test } from "bun:test";
import type { ConnectionState, HostStreamItem } from "@polaris/protocol";
import { applyHostItem, emptyHostFeed } from "../home/feed/fold.ts";
import {
  commandApproval,
  minutesAgo,
  question,
  session,
  snapshot,
  summary,
  synchronized,
  type SnapshotInput,
  workspace,
} from "../home/fixtures.testing.ts";
import { buildHome, type HomeHost } from "../home/model/home.ts";
import {
  isNight,
  skyLine,
  starLabel,
  starLimit,
  starsOf,
  targetsOf,
  wantsDetail,
  wantsLine,
} from "./monitor.ts";

const host = (items: ReadonlyArray<HostStreamItem>, connection: ConnectionState = "connected") =>
  ({
    hostId: "studio",
    name: "Mac Studio",
    connection,
    followed: { state: items.reduce(applyHostItem, emptyHostFeed), seen: true, error: null },
  }) satisfies HomeHost;

const home = (sessions: NonNullable<SnapshotInput["sessions"]>) =>
  buildHome(
    [host([snapshot({ workspaces: [workspace("w1", "polaris")], sessions }), synchronized()])],
    null
  );

const night = home([
  summary(session({ id: "spike", title: "Spike GPUI review screen", state: "needs-you" }), [
    commandApproval("spike", "r1", "cargo build --release", minutesAgo(42)),
  ]),
  summary(session({ id: "form", title: "Fix eligibility form", state: "needs-you" }), [
    question("form", "r2", "Monthly or annually?", ["Annual", "Monthly"]),
  ]),
  summary(session({ id: "planning", title: "Polaris planning", state: "working" })),
  summary(session({ id: "relay", title: "Relay codec", state: "working", harness: "codex" })),
  summary(session({ id: "proto", title: "Old prototype", state: "idle" })),
]);

describe("the monitor", () => {
  test("needs you and working sessions stand on the horizon; idle ones stay on Home", () => {
    expect(starsOf(night, 9).map((s) => [s.label, s.tone, s.working])).toEqual([
      ["spike-gpui-review…", "needs-you", false],
      ["fix-eligibility-f…", "needs-you", false],
      ["polaris-planning", "working", true],
      ["relay-codec", "working", true],
    ]);
  });

  test("celestials are spaced evenly across the sky, as many as their slots allow", () => {
    expect(starsOf(night, 9).map((s) => s.x)).toEqual([0.125, 0.375, 0.625, 0.875]);
    expect(starLimit(669)).toBe(5);
    expect(starsOf(night, starLimit(300)).map((s) => s.label)).toEqual([
      "spike-gpui-review…",
      "fix-eligibility-f…",
    ]);
  });

  test.each([
    ["command", "Wants to run"],
    ["file-change", "Wants to change"],
    ["tool", "Wants to use"],
  ] as const)("a %s permission reads %p before its detail", (kind, line) => {
    expect(wantsLine(kind)).toBe(line);
  });

  test("the sky line counts working and needs you, in the singular for one", () => {
    expect(skyLine(night)).toEqual({ working: "2 working", needsYou: "2 need you" });
    expect(skyLine(home([]))).toEqual({ working: "", needsYou: "" });
  });

  test("targets are the answerable needs you items, capped to what fits", () => {
    expect(targetsOf(night, 1).map((row) => String(row.session.id))).toEqual(["spike"]);
  });

  test.each([
    [23, true],
    [3, true],
    [6, false],
    [13, false],
    [21, false],
  ])("at %i:00 the targets dim: %p", (hour, dim) => {
    expect(isNight(hour)).toBe(dim);
  });

  test("the command after Wants to run drops its prompt sign, and nothing else", () => {
    expect(wantsDetail("$ cargo build --release")).toBe("cargo build --release");
    expect(wantsDetail("echo $ HOME")).toBe("echo $ HOME");
  });

  test("a title with nothing to slug reads untitled", () => {
    expect(starLabel("…")).toBe("untitled");
  });
});
