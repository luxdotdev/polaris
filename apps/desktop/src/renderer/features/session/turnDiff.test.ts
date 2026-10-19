import { describe, expect, test } from "bun:test";
import { TurnId } from "@polaris/protocol";
import { hostView } from "../../routes/fixtures.testing.ts";
import { spanDiffable } from "./turnDiff.ts";

const older = hostView("devbox");

const current = {
  ...older,
  status: { ...older.status, capabilities: ["git.diff-turns" as const] },
};

const one = { first: TurnId.make("t1"), last: TurnId.make("t1") };

const merged = { first: TurnId.make("t1"), last: TurnId.make("t3") };

describe("a Turn's diff on the host's daemon", () => {
  test("a Turn the Harness continued needs git.diff-turns, so an older daemon isn't asked", () => {
    expect(spanDiffable(merged, older)).toBe(false);
    expect(spanDiffable(merged, current)).toBe(true);
  });

  test("a single Turn diffs on any daemon", () => {
    expect(spanDiffable(one, older)).toBe(true);
  });
});
