import { describe, expect, test } from "bun:test";
import type { DiffFile } from "../../model/diff.ts";
import {
  type ActivityInput,
  activity,
  aheadBehind,
  middleCut,
  phrase,
  railChanges,
} from "./model.ts";

const file = (path: string, added: number, removed: number): DiffFile => ({
  path,
  oldPath: null,
  status: "modified",
  binary: false,
  added,
  removed,
  hunks: [],
});

describe("railChanges", () => {
  test.each([
    [0, 0, 0],
    [3, 3, 0],
    [5, 5, 0],
    [6, 5, 1],
    [500, 5, 495],
  ])("%i files list %i and leave %i for “and N more”", (count, shown, more) => {
    const files = Array.from({ length: count }, (_, i) => file(`f${i}.ts`, i, 1));
    const rail = railChanges(files);

    expect(rail.shown.map((f) => f.path)).toEqual(files.slice(0, shown).map((f) => f.path));
    expect(rail.more).toBe(more);
    expect(rail.count).toBe(count);
  });

  test("totals count every file, not only the five shown", () => {
    const files = Array.from({ length: 8 }, (_, i) => file(`f${i}.ts`, 10, 2));

    expect(railChanges(files)).toMatchObject({ added: 80, removed: 16 });
  });
});

test.each([
  ["index.html", 20, "index.html"],
  ["ClaudeDriverIntegration.test.ts", 17, "ClaudeDr….test.ts"],
  ["0142-a-closed-output-rail.md", 20, "0142-a-clos…-rail.md"],
  ["abcdefgh", 7, "abc…fgh"],
  ["abcdefgh", 2, "ab"],
])("%p in %i cells reads %p", (name, cells, shown) => {
  expect(middleCut(name, cells)).toBe(shown);
  expect(middleCut(name, cells).length).toBeLessThanOrEqual(cells);
});

test.each([
  [0, 0, null],
  [3, 0, "↑3"],
  [0, 2, "↓2"],
  [3, 2, "↑3 ↓2"],
])("ahead %i, behind %i reads %p", (ahead, behind, text) => {
  expect(aheadBehind(ahead, behind)).toBe(text);
});

test.each([
  ["Running bun test", "Running ", "bun test"],
  ["Editing index.html", "Editing ", "index.html"],
  ["Wants to run cargo build", "Wants to run ", "cargo build"],
  ["Editing 3 files", "Editing 3 files", null],
  ["Running a command…", "Running a command…", null],
  ["Waiting on a subagent", "Waiting on a subagent", null],
])("%p sets %p in prose and %p in code", (text, prose, code) => {
  expect(phrase(text)).toEqual({ text: prose, code });
});

const NOW = Date.parse("2026-11-19T12:00:00Z");

const input = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  now: NOW,
  host: { label: "Mac Studio", state: "connected", since: NOW },
  harness: "Claude Code",
  state: "working",
  request: null,
  live: null,
  waiting: null,
  turn: { number: 24, startedAt: "2026-11-19T11:58:48Z", endedAt: null },
  lastError: null,
  limitResetsAt: null,
  ...over,
});

describe("activity", () => {
  test("Working says what it does now, the Turn and how long it has run", () => {
    expect(activity(input({ live: "Editing index.html" }))).toEqual({
      glyph: "session",
      title: { text: "Editing ", code: "index.html" },
      attention: false,
      sub: "Claude Code · turn 24 · 1m 12s",
    });
  });

  test("a pending request wins over the live text and asks for attention", () => {
    const shown = activity(input({ request: "Wants to run cargo build", live: "Thinking…" }));

    expect(shown.title).toEqual({ text: "Wants to run ", code: "cargo build" });
    expect(shown.attention).toBe(true);
    expect(shown.sub).toBe("Claude Code · waiting on you");
  });

  test("Idle is Ready, with when its Turn ended", () => {
    const turn = { number: 3, startedAt: "2026-11-19T11:50:00Z", endedAt: "2026-11-19T11:58:00Z" };

    expect(activity(input({ state: "idle", turn }))).toMatchObject({
      title: { text: "Ready", code: null },
      sub: "Turn 3 ended 2m ago",
    });
  });

  test("an Idle session with background tasks says what it waits on", () => {
    const shown = activity(input({ state: "idle", waiting: "Waiting on a subagent" }));

    expect(shown.title.text).toBe("Waiting on a subagent");
  });

  test.each([
    ["reconnecting", "Reconnecting"],
    ["offline", "Offline"],
  ] as const)("a %s Host says so, and when it was last seen", (state, title) => {
    const shown = activity(
      input({ host: { label: "Raspberry Pi 4", state, since: NOW - 18_000 }, request: "Wants x" })
    );

    expect(shown).toEqual({
      glyph: "connection",
      title: { text: title, code: null },
      attention: false,
      sub: "Raspberry Pi 4 · seen 18s ago",
    });
  });

  test("a Turn that ended under a minute ago just ended", () => {
    const turn = { number: 3, startedAt: "2026-11-19T11:59:00Z", endedAt: "2026-11-19T11:59:40Z" };

    expect(activity(input({ state: "idle", turn })).sub).toBe("Turn 3 just ended");
  });

  test("a session with no Turns yet is Ready under its Harness", () => {
    expect(activity(input({ state: "idle", turn: null })).sub).toBe("Claude Code");
  });
});
