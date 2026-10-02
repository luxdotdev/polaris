import { describe, expect, test } from "bun:test";
import { AgentSession, SessionId, TurnItem } from "@polaris/protocol";
import { approval, session, turnWith } from "../../../../store/fixtures.testing.ts";
import type { SessionEntry } from "../../../../store/hostModel.ts";
import { emptySessionModel, type SessionModel } from "../../../../store/sessionModel.ts";
import { agentMarks, watchedSessions } from "./agents.ts";

const ROOT = "/tmp/proof";

const entry = (patch: Partial<AgentSession>, approvals = false): SessionEntry => ({
  session: new AgentSession({
    id: session.id,
    workspaceId: session.workspaceId,
    harness: session.harness,
    title: session.title,
    cwd: session.cwd,
    worktreeId: null,
    state: session.state,
    permissionMode: session.permissionMode,
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    contextUsage: null,
    lastError: null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...patch,
  }),
  pendingApprovals: approvals ? [approval] : [],
  lastTurnPreview: null,
  subagents: [],
});

const change = (id: string, path: string, status: "running" | "completed" | "declined") =>
  TurnItem.cases.FileChange.make({ id, changes: [{ path, kind: "modify" }], status });

const model = (
  items: ReadonlyArray<TurnItem>,
  live: ReadonlyArray<TurnItem> = [],
  status: "working" | "completed" = "working"
): SessionModel => ({
  ...emptySessionModel,
  turns: [
    {
      turn: turnWith({ status }),
      items,
      live: new Map(live.map((item) => [item.id, { item, text: "", output: "" }])),
      subagents: [],
    },
  ],
});

describe("watchedSessions", () => {
  test("working or needs-you sessions working inside the root", () => {
    const sessions = [
      entry({ id: SessionId.make("a"), state: "working" }),
      entry({ id: SessionId.make("b"), state: "idle" }),
      entry({ id: SessionId.make("c"), state: "needs-you" }),
      entry({ id: SessionId.make("d"), state: "working", cwd: "/tmp/proof.worktrees/x" }),
    ];

    expect(watchedSessions(sessions, session.workspaceId, ROOT).map((e) => e.session.id)).toEqual([
      SessionId.make("a"),
      SessionId.make("c"),
    ]);
  });
});

describe("agentMarks", () => {
  test("a working session's file changes this turn, relative paths resolved", () => {
    const marks = agentMarks({
      root: ROOT,
      sessions: [entry({ state: "working", cwd: "/tmp/proof/src", harness: "codex" })],
      feed: () =>
        model(
          [change("1", "a.ts", "completed"), change("2", "/tmp/proof/b.ts", "declined")],
          [change("3", "../c.ts", "running")]
        ),
    });

    expect([...marks.editing]).toEqual([
      ["/tmp/proof/src/a.ts", "codex"],
      ["/tmp/proof/c.ts", "codex"],
    ]);
    expect(marks.edits.get("/tmp/proof/c.ts")).toMatchObject({
      sessionId: session.id,
      harness: "codex",
      turnIndex: 1,
      live: true,
    });
    expect(marks.edits.get("/tmp/proof/src/a.ts")?.live).toBe(false);
  });

  test("a finished turn marks nothing; paths outside the root are left out", () => {
    const sessions = [entry({ state: "working" })];

    expect(
      agentMarks({
        root: ROOT,
        sessions,
        feed: () => model([change("1", "a.ts", "completed")], [], "completed"),
      }).editing.size
    ).toBe(0);
    expect(
      agentMarks({
        root: ROOT,
        sessions,
        feed: () => model([change("1", "/etc/hosts", "completed")]),
      }).editing.size
    ).toBe(0);
  });

  test("a blocked session: its open file change, else what the turn changed", () => {
    const sessions = [entry({ state: "needs-you" }, true)];

    const open = agentMarks({
      root: ROOT,
      sessions,
      feed: () =>
        model([change("1", "done.ts", "completed")], [change("2", "x/wait.ts", "running")]),
    });

    expect([...open.blocked]).toEqual(["/tmp/proof/x/wait.ts"]);
    expect(open.editing.size).toBe(0);

    const before = agentMarks({
      root: ROOT,
      sessions,
      feed: () => model([change("1", "done.ts", "completed")]),
    });

    expect([...before.blocked]).toEqual(["/tmp/proof/done.ts"]);
  });
});
