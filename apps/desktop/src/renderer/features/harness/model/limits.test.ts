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
