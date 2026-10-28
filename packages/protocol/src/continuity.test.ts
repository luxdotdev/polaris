import { expect, test } from "bun:test";
import type { SessionState, TurnStatus } from "./domain.ts";
import { unreadTurns } from "./continuity.ts";

// Two Turns, nothing read: the second is the latest, in the state the Session State machine leaves it.
test.each<[string, SessionState, TurnStatus, number]>([
  ["working", "working", "working", 1],
  ["needing an approval or an answer", "needs-you", "working", 1],
  ["In Terminal", "in-terminal", "working", 1],
  ["needing the user after recovery interrupted it", "needs-you", "interrupted", 2],
  ["idle after it completed", "idle", "completed", 2],
])("a latest Turn %s counts by its own status", (_, state, status, unread) => {
  const session = { turnCount: 2, state };
  expect(unreadTurns(session, { status }, null)).toBe(unread);
});

test("Turns through the read position aren't unread", () => {
  expect(unreadTurns({ turnCount: 3 }, { status: "completed" }, { turnIndex: 1 })).toBe(1);
});
