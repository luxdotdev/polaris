import { expect, test } from "bun:test";
import type { SessionState } from "@polaris/sdk";
import { ConstellationId, TaskId, WorktreeSetupRun } from "@polaris/protocol";
import { canSendTurn } from "./actions.ts";
import { approval, entry } from "./fixtures.testing.ts";

const at = "2026-10-23T00:00:00.000Z";

test.each<SessionState>(["starting", "working", "in-terminal", "archived"])(
  "Send Turn is unavailable while %s",
  (state) => expect(canSendTurn(entry("s1", state, at))).toBe(false)
);

test.each<SessionState>(["idle", "dormant", "failed", "limited", "needs-you"])(
  "Send Turn is available at a %s turn boundary",
  (state) => expect(canSendTurn(entry("s1", state, at))).toBe(true)
);

test("an approval must be answered before sending another turn", () => {
  expect(canSendTurn(entry("s1", "needs-you", at, { approvals: [approval("s1", "r1", at)] }))).toBe(
    false
  );
});

test("worktree setup must finish before sending a turn", () => {
  const idle = entry("s1", "idle", at);

  const worktreeSetup = new WorktreeSetupRun({
    id: "setup",
    constellationId: ConstellationId.make("c1"),
    taskId: TaskId.make("A"),
    command: "bun install",
    cwd: "/tmp/worktree",
    status: "running",
    output: "",
    exitCode: null,
    startedAt: at,
    endedAt: null,
  });

  expect(canSendTurn({ ...idle, session: { ...idle.session, worktreeSetup } })).toBe(false);
});
