import { describe, expect, test } from "bun:test";
import {
  AgentSession,
  ApprovalDecision,
  ApprovalRequest,
  DomainEvent,
  EventEnvelope,
  HostStreamItem,
  RequestId,
  SessionId,
  SessionSummary,
  Worktree,
  WorktreeId,
} from "@polaris/protocol";
import type { HostView } from "../../../../shared/api.ts";
import { at, seq, session, turnId, workspace } from "../../../store/fixtures.testing.ts";
import { applyHostItems, emptyHostModel, type HostModel } from "../../../store/hostModel.ts";
import { ANSWERED_FOR_MS, buildInbox } from "./inbox.ts";
import { quietFact } from "./quiet.ts";
import { toSummary } from "./summary.ts";

const H = HostStreamItem.cases;

const E = DomainEvent.cases;

const minutes = (n: number) => new Date(Date.parse(at) + n * 60_000).toISOString();

const request = (
  id: string,
  sessionId: string,
  openedAt: string,
  kind: ApprovalRequest["kind"] = "command"
) =>
  new ApprovalRequest({
    title: "Run bun test",
    detail: null,
    options: [],
    id: RequestId.make(id),
    sessionId: SessionId.make(sessionId),
    turnId,
    kind,
    openedAt,
  });

const sessionWith = (id: string, patch: Partial<AgentSession> = {}) =>
  new AgentSession({
    id: SessionId.make(id),
    workspaceId: workspace.id,
    harness: session.harness,
    title: `Session ${id}`,
    cwd: session.cwd,
    worktreeId: null,
    state: "starting",
    permissionMode: "auto",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 0,
    lastError: null,
    createdAt: at,
    updatedAt: at,
    ...patch,
  });

interface Seed {
  readonly session: AgentSession;
  readonly pending?: ReadonlyArray<ApprovalRequest>;
}

const hostModel = (seeds: ReadonlyArray<Seed>): HostModel =>
  applyHostItems(emptyHostModel, [
    H.Snapshot.make({
      sequence: seq(1),
      workspaces: [workspace],
      worktrees: [],
      sessions: seeds.map(
        (s) =>
          new SessionSummary({
            session: s.session,
            pendingApprovals: [...(s.pending ?? [])],
            lastTurnPreview: null,
            subagents: [],
          })
      ),
    }),
  ]);

const host = (key: string, label: string): HostView => ({
  key,
  label,
  colour: null,
  alias: null,
  proofHarness: false,
  status: {
    state: "connected",
    failure: null,
    attempt: 0,
    since: 0,
    nextAttemptAt: null,
    host: null,
    capabilities: [],
    epoch: 0,
    latencyMs: null,
  },
});

const now = Date.parse(minutes(60));

const inbox = (models: Record<string, HostModel>, answeredHere: ReadonlySet<string> = new Set()) =>
  buildInbox({
    hosts: [host("local", "Mac Studio"), host("vm", "Linux VM")],
    models,
    now,
    answeredHere,
  });

describe("Needs You inbox", () => {
  test("waiting sessions across Hosts, oldest request first, one card per session", () => {
    const local = hostModel([
      {
        session: sessionWith("a", { state: "needs-you" }),
        pending: [request("r2", "a", minutes(20)), request("r1", "a", minutes(5))],
      },
      { session: sessionWith("b", { state: "working" }) },
    ]);

    const vm = hostModel([
      {
        session: sessionWith("c", { state: "needs-you" }),
        pending: [request("r3", "c", minutes(1), "question")],
      },
    ]);

    const result = inbox({ local, vm });

    expect(result.waiting.map((w) => `${w.hostKey}/${w.entry.session.id}`)).toEqual([
      "vm/c",
      "local/a",
    ]);
    expect(result.waiting[1]?.requests.map((r) => String(r.id))).toEqual(["r1", "r2"]);
    expect(result.waiting[1]).toMatchObject({ hostLabel: "Mac Studio", workspace: "proof" });
    expect(result.count).toBe(2);
  });

  test("the same session id on two Hosts is two sessions", () => {
    const seed = [
      { session: sessionWith("s", { state: "needs-you" }), pending: [request("r", "s", at)] },
    ];

    const result = inbox({ local: hostModel(seed), vm: hostModel(seed) });

    expect(new Set(result.waiting.map((w) => w.key)).size).toBe(2);
    expect(result.count).toBe(2);
  });

  test("also waiting: Failed, In Terminal, and an Interrupted Turn after a restart", () => {
    const local = hostModel([
      {
        session: sessionWith("f", {
          state: "failed",
          lastError: "out of memory",
          updatedAt: minutes(3),
        }),
      },
      { session: sessionWith("t", { state: "in-terminal", updatedAt: minutes(2) }) },
      { session: sessionWith("i", { state: "needs-you", updatedAt: minutes(1) }) },
      { session: sessionWith("x", { state: "archived" }) },
    ]);

    const result = inbox({ local });

    expect(result.also.map((a) => `${a.entry.session.id}:${a.kind}`)).toEqual([
      "f:failed",
      "i:interrupted",
      "t:in-terminal",
    ]);
    expect(result.waiting).toEqual([]);
    // Only Needs You counts: the Interrupted Turn, not Failed or In Terminal.
    expect(result.count).toBe(1);
  });

  test("an answer from another device shows for a minute; one from here doesn't", () => {
    const pending = request("r1", "a", minutes(59));

    const base = hostModel([
      { session: sessionWith("a", { state: "needs-you" }), pending: [pending] },
    ]);

    const resolve = (resolvedBy: string, occurredAt: string) =>
      applyHostItems(base, [
        H.Event.make({
          envelope: new EventEnvelope({
            sequence: seq(2),
            occurredAt,
            commandId: null,
            event: E.ApprovalResolved.make({
              sessionId: SessionId.make("a"),
              requestId: RequestId.make("r1"),
              decision: ApprovalDecision.cases.Allow.make({ remember: false }),
              resolvedBy,
            }),
          }),
        }),
      ]);

    const elsewhere = inbox({ local: resolve("Mac mini", minutes(59.5)) });

    expect(elsewhere.waiting).toEqual([]);
    expect(elsewhere.answered.map((a) => [a.resolution.resolvedBy, a.resolution.decision])).toEqual(
      [["Mac mini", "Allow"]]
    );
    expect(inbox({ local: resolve("Mac mini", minutes(59.5)) }, new Set(["r1"])).answered).toEqual(
      []
    );
    expect(inbox({ local: resolve("Daemon", minutes(59.5)) }).answered).toEqual([]);
    expect(
      inbox({ local: resolve("Mac mini", new Date(now - ANSWERED_FOR_MS - 1).toISOString()) })
        .answered
    ).toEqual([]);
  });

  test("the summary for the main process lists waiting and interrupted sessions", () => {
    const local = hostModel([
      {
        session: sessionWith("a", { state: "needs-you" }),
        pending: [request("r1", "a", at, "question")],
      },
      { session: sessionWith("i", { state: "needs-you" }) },
      { session: sessionWith("f", { state: "failed" }) },
    ]);

    const summary = toSummary({ inbox: inbox({ local }), focused: null });

    expect(summary.count).toBe(2);
    expect(summary.sessions.map((s) => [s.sessionId, s.requests.length, s.harness])).toEqual([
      ["a", 1, "Claude Code"],
      ["i", 0, "Claude Code"],
    ]);
  });
});

describe("the quiet inbox", () => {
  test("says what is running, without a trailing period", () => {
    const working = hostModel([{ session: sessionWith("w", { state: "working" }) }]);
    const idle = hostModel([{ session: sessionWith("i", { state: "idle" }) }]);

    expect(quietFact({ hosts: 2, models: [working, idle] })).toBe("1 session working on 2 hosts");
    expect(quietFact({ hosts: 1, models: [idle] })).toBe("1 session on 1 host, none waiting");
    expect(quietFact({ hosts: 1, models: [] })).toBe("No agent sessions yet");
  });
});

describe("where a waiting session runs", () => {
  test("names its Worktree's branch, else the main checkout's", () => {
    const withBranch = applyHostItems(emptyHostModel, [
      H.Snapshot.make({
        sequence: seq(1),
        workspaces: [workspace],
        worktrees: [
          new Worktree({
            id: WorktreeId.make("main"),
            workspaceId: workspace.id,
            path: workspace.path,
            branch: "main",
            head: "abc1234",
            createdBySessionId: null,
            isMain: true,
          }),
        ],
        sessions: [
          new SessionSummary({
            session: sessionWith("a", { state: "needs-you" }),
            pendingApprovals: [request("r1", "a", at)],
            lastTurnPreview: null,
            subagents: [],
          }),
        ],
      }),
    ]);

    expect(inbox({ local: withBranch }).waiting[0]?.branch).toBe("main");
  });
});
