import { expect, test } from "bun:test";
import { PlanLimit } from "@polaris/protocol";
import { namesUsageLimit, usageLimitOf } from "./limits.ts";

const NOW = "2026-10-12T10:00:00.000Z";

const reached = (resetsAt: string, harness: "claude" | "codex" = "claude") =>
  PlanLimit.make({
    harness,
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent: 100,
    status: "reached",
    resetsAt,
    observedAt: NOW,
    plan: null,
  });

test("usage limits read as limits; overloads and other failures don't", () => {
  for (const text of [
    "You've hit your limit · resets 2pm (Europe/London)",
    "Claude AI usage limit reached|1760000000",
    "You've hit your usage limit. Try again at 2:00 PM.",
    "insufficient_quota",
  ])
    expect(namesUsageLimit(text)).toBe(true);

  for (const text of [
    "Selected model is at capacity. Please try a different model.",
    "API Error: 529 overloaded_error",
    "connect ECONNREFUSED 127.0.0.1:1",
    "the Turn failed",
    null,
  ])
    expect(namesUsageLimit(text)).toBe(false);
});

test("the reset is the driver's, else the Harness's latest reached window, else unknown", () => {
  const base = { harness: "claude", now: NOW } as const;

  expect(
    usageLimitOf({
      ...base,
      error: "x",
      hint: { resetsAt: "2026-10-12T14:00:00.000Z" },
      limits: [],
    })
  ).toEqual({ resetsAt: "2026-10-12T14:00:00.000Z" });
  expect(
    usageLimitOf({
      ...base,
      error: "You've hit your limit",
      hint: undefined,
      limits: [reached("2026-10-12T14:00:00.000Z"), reached("2026-10-12T18:00:00.000Z", "codex")],
    })
  ).toEqual({ resetsAt: "2026-10-12T14:00:00.000Z" });
  expect(
    usageLimitOf({ ...base, error: "You've hit your limit", hint: { resetsAt: null }, limits: [] })
  ).toEqual({ resetsAt: null });
  expect(
    usageLimitOf({ ...base, error: "the Turn failed", hint: undefined, limits: [] })
  ).toBeNull();
});
