import { describe, expect, test } from "bun:test";
import type { HostStreamItem } from "@polaris/protocol";
import type { PushMessage } from "@polaris/protocol/relay";
import { emptyPlan, nextSettle, type PlanState, planItem, planSettled, SETTLE_MS } from "./plan.ts";
import {
  approvalRequested,
  backgroundTasks,
  snapshot,
  synchronized,
  turnEnded,
  turnStarted,
} from "./push.testing.ts";

const host = { hostId: "host-1", hostName: "studio" };

/** Feeds items at `now`, collecting what they push; then lets settles run until `until`. */
const run = (items: ReadonlyArray<readonly [number, HostStreamItem]>, until: number) => {
  let state: PlanState = emptyPlan;
  const sent: Array<PushMessage & { readonly sentAt: number }> = [];

  const settleUpTo = (now: number) => {
    for (let next = nextSettle(state); next !== null && next <= now; next = nextSettle(state)) {
      const planned = planSettled(state, { ...host, now: next });
      state = planned.state;
      sent.push(...planned.send.map((m) => ({ ...m, sentAt: next })));
    }
  };

  for (const [now, item] of items) {
    settleUpTo(now);
    const planned = planItem(state, item, { ...host, now });
    state = planned.state;
    sent.push(...planned.send.map((m) => ({ ...m, sentAt: now })));
  }

  settleUpTo(until);

  return sent;
};

const start = [
  [0, snapshot()],
  [0, synchronized()],
] as const;

describe("push plan", () => {
  test("a new approval pushes Needs You at once with what it asks, as the Desktop App words it", () => {
    const [push, ...rest] = run([...start, [10, approvalRequested("r1")]], 10_000);

    expect(rest).toEqual([]);
    expect(push).toMatchObject({
      kind: "needs-you",
      hostId: "host-1",
      sessionId: "s1",
      requestId: "r1",
      category: "approval",
      title: "Claude Code needs you",
      subtitle: "Fix the flaky test · studio",
      body: "Run bun test\nbun test apps/daemon",
      sentAt: 10,
    });
  });

  test("a question has the question category: no Approve or Deny buttons", () => {
    expect(run([...start, [10, approvalRequested("q1", "question")]], 0)[0]?.category).toBe(
      "question"
    );
  });

  test("nothing from before Synchronized pushes", () => {
    expect(
      run(
        [
          [0, snapshot()],
          [1, approvalRequested("r0")],
          [2, turnEnded("t0", "x")],
        ],
        10_000
      )
    ).toEqual([]);
  });

  test("a finished Turn pushes once its session stays settled for SETTLE_MS", () => {
    const sent = run([...start, [100, turnEnded("t1", "All green")]], 100_000);

    expect(sent.map((m) => [m.kind, m.title, m.body, m.sentAt])).toEqual([
      ["turn-ended", "Claude Code finished a turn", "All green", 100 + SETTLE_MS],
    ]);
  });

  test("a Turn that starts within the settle (a continuation) cancels it; its own end pushes", () => {
    const sent = run(
      [
        ...start,
        [100, turnEnded("t1", "early")],
        [100 + SETTLE_MS - 1, turnStarted("t2")],
        [5_000, turnEnded("t2", "final")],
      ],
      100_000
    );

    expect(sent.map((m) => [m.body, m.sentAt])).toEqual([["final", 5_000 + SETTLE_MS]]);
  });

  test("with background tasks live the settle waits for the last one to finish", () => {
    const sent = run(
      [
        ...start,
        [50, backgroundTasks(1)],
        [100, turnEnded("t1", "waiting")],
        [20_000, backgroundTasks(0)],
      ],
      100_000
    );

    expect(sent.map((m) => m.sentAt)).toEqual([20_000 + SETTLE_MS]);
  });
});
