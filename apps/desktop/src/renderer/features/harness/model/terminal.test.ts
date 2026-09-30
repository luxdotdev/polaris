import { describe, expect, test } from "bun:test";
import { PlanLimit } from "@polaris/protocol";
import {
  freshness,
  limitHint,
  limitLine,
  limitsFor,
  shortDuration,
  upsertLimit,
} from "./limits.ts";
import { appendOutput, keyBytes, linksIn, tail } from "./terminal.ts";

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}
) => keyBytes({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe("sign-in terminal", () => {
  test("escape sequences are dropped", () => {
    expect(appendOutput("", "\u001B[1;32mSigned in\u001B[0m\r\n")).toBe("Signed in\n");
    expect(appendOutput("", "\u001B]0;title\u0007ok")).toBe("ok");
  });

  test("a carriage return overwrites the line", () => {
    expect(appendOutput("", "Waiting 1\rWaiting 2\rDone     \n")).toBe("Done     \n");
  });

  test("chunks join across calls", () => {
    expect(appendOutput(appendOutput("", "Open "), "https://example.com/x\n")).toBe(
      "Open https://example.com/x\n"
    );
  });

  test("keys become TTY bytes; ⌘-shortcuts stay with the app", () => {
    expect(key("a")).toBe("a");
    expect(key("Enter")).toBe("\r");
    expect(key("Backspace")).toBe("\u007F");
    expect(key("c", { ctrlKey: true })).toBe("\u0003");
    expect(key("ArrowUp")).toBe("\u001B[A");
    expect(key("v", { metaKey: true })).toBeNull();
    expect(key("Shift")).toBeNull();
  });

  test("links and a bounded tail", () => {
    expect(linksIn("go to https://a.test/x?y=1 or https://a.test/x?y=1.")).toEqual([
      "https://a.test/x?y=1",
      "https://a.test/x?y=1.",
    ]);
    expect(tail("abcdef", 3)).toBe("def");
  });
});

const NOW = Date.parse("2026-09-30T12:00:00.000Z");

const limit = (patch: Partial<PlanLimit> = {}) =>
  new PlanLimit({
    harness: "claude",
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent: 42,
    status: "ok",
    resetsAt: "2026-09-30T14:00:00.000Z",
    observedAt: "2026-09-30T11:58:00.000Z",
    plan: "max",
    ...patch,
  });

describe("Plan Limits", () => {
  test("one line per window: use and reset; near a limit, words change", () => {
    expect(limitLine(limit(), NOW)).toBe("5-hour 42% · resets in 2h");
    expect(limitLine(limit({ kind: "weekly", status: "warning", usedPercent: 91 }), NOW)).toBe(
      "Near the weekly limit · 91% · resets in 2h"
    );
    expect(limitLine(limit({ status: "reached", resetsAt: "2026-09-30T12:40:00.000Z" }), NOW)).toBe(
      "5-hour limit reached · resets in 40m"
    );
  });

  test("windows sort whole-plan first, five-hour before weekly; other Harnesses left out", () => {
    const all = [
      limit({ kind: "weekly" }),
      limit({ kind: "weekly", scope: "opus" }),
      limit(),
      limit({ harness: "codex" }),
    ];

    expect(limitsFor(all, "claude").map((l) => [l.kind, l.scope])).toEqual([
      ["five-hour", null],
      ["weekly", null],
      ["weekly", "opus"],
    ]);
  });

  test("freshness reads live, else how old", () => {
    expect(freshness([limit()], NOW)).toBe("live");
    expect(freshness([limit({ observedAt: "2026-09-30T11:20:00.000Z" })], NOW)).toBe(
      "as of 40m ago"
    );
    expect(limitHint([], NOW)).toBeNull();
    expect(limitHint([limit()], NOW)).toBe("5-hour 42% · resets in 2h · live");
  });

  test("the latest value replaces its window", () => {
    expect(upsertLimit([limit()], limit({ usedPercent: 50 })).map((l) => l.usedPercent)).toEqual([
      50,
    ]);
    expect(shortDuration(3 * 24 * 3_600_000)).toBe("3d");
  });
});
