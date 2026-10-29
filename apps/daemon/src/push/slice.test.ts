import { expect, test } from "bun:test";
import {
  AgentSession,
  DomainEvent,
  HostStreamItem,
  RequestId,
  Sequence,
  SessionSummary,
  TurnId,
  TurnItem,
} from "@polaris/protocol";
import { Schema } from "effect";
import { approval, approvalRequested, event, SESSION_ID, session } from "./push.testing.ts";
import { emptySlice, opensNeed, renderSlice, sliceItem } from "./slice.ts";

const host = { hostId: "host-1", hostName: "studio" };

const STARTED = "2026-10-27T11:00:00.000Z";

const encoded = Schema.encodeSync(AgentSession)(session);

const sessionWith = (fields: Partial<typeof encoded>) =>
  Schema.decodeSync(AgentSession)({ ...encoded, ...fields });

const reviewer = sessionWith({ id: "s-review", origin: "reviewer" });

const snapshotWith = () =>
  HostStreamItem.cases.Snapshot.make({
    sequence: Sequence.make(1),
    workspaces: [],
    worktrees: [],
    sessions: [
      new SessionSummary({
        session: sessionWith({ currentUserTurn: { turnId: "t1", number: 1, startedAt: STARTED } }),
        pendingApprovals: [approval("r0")],
        lastTurnPreview: null,
        subagents: [],
      }),
      new SessionSummary({
        session: reviewer,
        pendingApprovals: [],
        lastTurnPreview: null,
        subagents: [],
      }),
    ],
  });

const item = (turnItem: TurnItem, sessionId = SESSION_ID) =>
  event(
    DomainEvent.cases.TurnItemCompleted.make({
      sessionId,
      turnId: TurnId.make("t1"),
      item: turnItem,
      subagentId: null,
    })
  );

const command = (text: string) =>
  TurnItem.cases.CommandExecution.make({
    id: text,
    startedAt: null,
    command: text,
    cwd: "/repo",
    output: "",
    exitCode: 0,
    status: "completed",
  });

const fold = (items: ReadonlyArray<HostStreamItem>) => items.reduce(sliceItem, emptySlice);

test("a working session counts from its user Turn's start; the Daemon's own sessions don't count", () => {
  const slice = renderSlice(fold([snapshotWith()]), host);

  expect([slice.working, slice.since]).toEqual([1, Date.parse(STARTED) / 1000]);
  expect(slice.need).toMatchObject({ requestId: "r0", session: session.title, kind: "approval" });
});

test("the newest tool step shows, not reasoning or another session's", () => {
  const state = fold([
    snapshotWith(),
    item(command("bun test")),
    item(TurnItem.cases.Reasoning.make({ id: "r", text: "hmm", startedAt: null, endedAt: null })),
    item(command("rm -rf /"), reviewer.id),
  ]);

  expect(renderSlice(state, host).step).toMatchObject({ line: "bun test", session: session.title });
});

test("the oldest open request shows while it is open, and a new one counts as opening a Needs You", () => {
  const before = fold([snapshotWith()]);
  const after = sliceItem(before, approvalRequested("r1", "question"));

  expect(opensNeed(new Set(before.needs.keys()), after)).toBe(true);
  expect(renderSlice(after, host)).toMatchObject({ needs: 2, need: { requestId: "r0" } });

  const resolved = sliceItem(
    after,
    event(
      DomainEvent.cases.ApprovalWithdrawn.make({
        sessionId: SESSION_ID,
        requestId: RequestId.make("r0"),
        withdrawnBy: "harness",
        reason: "ended",
      })
    )
  );

  expect(renderSlice(resolved, host)).toMatchObject({
    needs: 1,
    need: { requestId: "r1", kind: "question" },
  });
});

test("a session stops counting when its Turn ends", () => {
  const ended = sliceItem(
    fold([snapshotWith()]),
    event(
      DomainEvent.cases.SessionStateChanged.make({
        sessionId: SESSION_ID,
        state: "idle",
        reason: null,
      })
    )
  );

  expect(renderSlice(ended, host)).toMatchObject({ working: 0, since: null });
});
