import { describe, expect, test } from "bun:test";
import { stoppedWithoutClaiming } from "./stopped.ts";

const NUDGED = "2026-10-02T10:00:00.000Z";

const attempt = { state: "working" as const, nudgedAt: NUDGED };

const session = (state: "idle" | "dormant" | "working", updatedAt: string) => ({
  state,
  updatedAt,
});

describe("stoppedWithoutClaiming", () => {
  test("nudged, then the session ended a Turn again", () => {
    expect(stoppedWithoutClaiming(attempt, session("idle", "2026-10-02T10:03:00.000Z"))).toBe(true);
    expect(stoppedWithoutClaiming(attempt, session("dormant", "2026-10-02T10:03:00.000Z"))).toBe(
      true
    );
  });

  test("not while the nudged Turn runs or before the nudge was answered", () => {
    expect(stoppedWithoutClaiming(attempt, session("working", "2026-10-02T10:03:00.000Z"))).toBe(
      false
    );
    expect(stoppedWithoutClaiming(attempt, session("idle", "2026-10-02T09:58:00.000Z"))).toBe(
      false
    );
    expect(stoppedWithoutClaiming(attempt, session("idle", NUDGED))).toBe(false);
  });

  test("never without the nudge, a session, or a working Attempt", () => {
    const ended = session("idle", "2026-10-02T10:03:00.000Z");

    expect(stoppedWithoutClaiming({ ...attempt, nudgedAt: null }, ended)).toBe(false);
    expect(stoppedWithoutClaiming(attempt, null)).toBe(false);
    expect(stoppedWithoutClaiming({ ...attempt, state: "review" }, ended)).toBe(false);
  });
});
