import { describe, expect, test } from "bun:test";
import {
  DomainEvent,
  HostStreamItem,
  ReviewCheckout,
  ReviewCheckoutId,
  ReviewSubject,
  SessionSummary,
} from "@polaris/protocol";
import { applyHostItems, emptyHostModel, sessionsOf, visibleWorkspaces } from "./hostModel.ts";
import {
  approval,
  envelope,
  seq,
  session,
  sessionId,
  turn,
  workspace,
} from "./fixtures.testing.ts";
import { cachedModel, toCached } from "./store.ts";

const E = DomainEvent.cases;

const H = HostStreamItem.cases;

const event = (sequence: number, e: DomainEvent) =>
  H.Event.make({ envelope: envelope(sequence, e) });

const snapshot = H.Snapshot.make({
  sequence: seq(3),
  workspaces: [workspace],
  worktrees: [],
  sessions: [
    new SessionSummary({ session, pendingApprovals: [], lastTurnPreview: null, subagents: [] }),
  ],
});

/** What the renderer really receives: values after structured clone. */
const cloned = <A>(value: A): A => structuredClone(value);

const reviewCheckout = (state: ReviewCheckout["state"]) =>
  new ReviewCheckout({
    id: ReviewCheckoutId.make("rc1"),
    workspaceId: workspace.id,
    subject: ReviewSubject.cases.SessionTurns.make({
      sessionId,
      firstTurnId: null,
      lastTurnId: null,
    }),
    path: "/repo/.review/session-1",
    state,
    blocked: null,
    head: null,
    mergeBase: null,
    latestHead: "",
    latestBase: "",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  });

describe("host model", () => {
  test("Review Checkouts arrive in the Snapshot and follow their events", () => {
    const withCheckout = H.Snapshot.make({
      ...snapshot,
      reviewCheckouts: [reviewCheckout("fetching")],
    });

    const opened = applyHostItems(emptyHostModel, cloned([withCheckout]));

    expect(opened.reviewCheckouts.get("rc1")?.state).toBe("fetching");

    const ready = applyHostItems(
      opened,
      cloned([event(4, E.ReviewCheckoutChanged.make({ checkout: reviewCheckout("ready") }))])
    );

    expect(ready.reviewCheckouts.get("rc1")?.state).toBe("ready");

    const removed = applyHostItems(
      ready,
      cloned([
        event(
          5,
          E.ReviewCheckoutRemoved.make({
            checkoutId: ReviewCheckoutId.make("rc1"),
            workspaceId: workspace.id,
          })
        ),
      ])
    );

    expect(removed.reviewCheckouts.size).toBe(0);
  });

  test("a Snapshot resets the model; Synchronized marks it live", () => {
    const model = applyHostItems(
      emptyHostModel,
      cloned([snapshot, H.Synchronized.make({ sequence: seq(3) })])
    );

    expect(model.sequence).toBe(seq(3));
    expect(model.synchronized).toBe(true);
    expect(visibleWorkspaces(model).map((w) => w.name)).toEqual(["proof"]);
    expect(sessionsOf(model, workspace.id).map((e) => e.session.title)).toEqual(["Proof session"]);
  });

  test("events fold as the Daemon folds them", () => {
    const model = applyHostItems(
      emptyHostModel,
      cloned([
        snapshot,
        event(4, E.SessionStateChanged.make({ sessionId, state: "working", reason: null })),
        event(5, E.TurnStarted.make({ turn })),
        event(6, E.ApprovalRequested.make({ request: approval })),
        event(7, E.SessionRenamed.make({ sessionId, title: "Renamed" })),
      ])
    );

    const entry = model.sessions.get(sessionId);

    expect(model.sequence).toBe(seq(7));
    expect(entry?.session.state).toBe("working");
    expect(entry?.session.turnCount).toBe(1);
    expect(entry?.session.title).toBe("Renamed");
    expect(entry?.lastTurnPreview).toBe("count to three");
    expect(entry?.pendingApprovals.map((r) => r.id)).toEqual([approval.id]);

    const resolved = applyHostItems(
      model,
      cloned([
        event(
          8,
          E.ApprovalWithdrawn.make({
            sessionId,
            requestId: approval.id,
            withdrawnBy: "harness",
            reason: "turn ended",
          })
        ),
        event(9, E.SessionStateChanged.make({ sessionId, state: "failed", reason: "boom" })),
      ])
    );

    expect(resolved.sessions.get(sessionId)?.pendingApprovals).toEqual([]);
    expect(resolved.sessions.get(sessionId)?.session.lastError).toBe("boom");
  });

  test("an event at or below the model's sequence is ignored", () => {
    const model = applyHostItems(emptyHostModel, cloned([snapshot]));

    const replayed = applyHostItems(
      model,
      cloned([event(3, E.SessionRenamed.make({ sessionId, title: "stale" }))])
    );

    expect(replayed).toBe(model);
  });

  test("removing a Workspace drops its Worktrees; archived sessions are hidden", () => {
    const model = applyHostItems(
      emptyHostModel,
      cloned([
        snapshot,
        event(4, E.SessionStateChanged.make({ sessionId, state: "archived", reason: null })),
      ])
    );

    expect(sessionsOf(model, workspace.id)).toEqual([]);

    const removed = applyHostItems(
      model,
      cloned([event(5, E.WorkspaceRemoved.make({ workspaceId: workspace.id }))])
    );

    expect(visibleWorkspaces(removed)).toEqual([]);
  });

  test("the cache holds only synchronized live models and paints them marked as cached", () => {
    const live = applyHostItems(emptyHostModel, cloned([snapshot]));

    expect(toCached("local", live)).toBeNull();

    const synced = applyHostItems(live, [H.Synchronized.make({ sequence: seq(3) })]);
    const cached = toCached("local", synced);

    expect(cached?.sequence).toBe(seq(3));

    const painted = cachedModel(cloned(cached!));

    expect(painted.fromCache).toBe(true);
    expect(painted.synchronized).toBe(false);
    expect(painted.sessions.get(sessionId)?.session.title).toBe("Proof session");
    expect(toCached("local", painted)).toBeNull();
  });
});
