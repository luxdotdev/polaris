import { expect, test } from "bun:test";
import { Schema } from "effect";
import { SessionSummary, Turn } from "./index.ts";

const at = "2026-10-19T00:00:00.000Z";

/** A Turn as a Daemon without `session.user-turns` sends it. */
const oldTurn = {
  id: "t",
  sessionId: "s",
  index: 0,
  prompt: "hi",
  attachments: [],
  model: null,
  effort: null,
  status: "completed",
  checkpointBefore: null,
  checkpointAfter: null,
  startedAt: at,
  endedAt: at,
};

/** An Agent Session as a Daemon without `session.user-turns` sends it. */
const oldSession = {
  id: "s",
  workspaceId: "w",
  harness: "codex",
  title: "test",
  cwd: "/repo",
  worktreeId: null,
  state: "idle",
  permissionMode: "supervised",
  model: null,
  effort: null,
  parentSessionId: null,
  forkedFromTurnId: null,
  harnessCursor: null,
  turnCount: 1,
  contextUsage: null,
  lastError: null,
  createdAt: at,
  updatedAt: at,
};

test("an older Daemon's Turn decodes without a user-Turn number or reply preview", () => {
  const turn = Schema.decodeUnknownSync(Turn)(oldTurn);

  expect(turn).toMatchObject({ userTurnNumber: null, replyPreview: null });
});

test("an older Daemon's session summary decodes without a current user Turn or reply", () => {
  const summary = Schema.decodeUnknownSync(SessionSummary)({
    session: oldSession,
    pendingApprovals: [],
    lastTurnPreview: "hi",
  });

  expect(summary.session).toMatchObject({ currentUserTurn: null, lastReplyPreview: null });
});
