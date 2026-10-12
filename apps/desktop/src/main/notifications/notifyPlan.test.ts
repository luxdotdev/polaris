import { describe, expect, test } from "bun:test";
import type { NeedsYouNotification, NeedsYouSummary } from "../../shared/needsYou.ts";
import {
  agentKey,
  emptyNotifyState,
  type NotifyState,
  planAgentNotifications,
} from "./notifyPlan.ts";

const note = (id: string, sessionId = "s1"): NeedsYouNotification => ({
  hostKey: "local",
  hostLabel: "This Mac",
  sessionId,
  sessionTitle: "Fix the flaky test",
  id,
  title: "Tests pass",
  body: "Ready for review",
});

const summary = (
  notifications: ReadonlyArray<NeedsYouNotification>,
  focused: NeedsYouSummary["focused"] = null
): NeedsYouSummary => ({ count: 0, sessions: [], focused, notifications });

const run = (summaries: ReadonlyArray<NeedsYouSummary>, windowFocused = false) => {
  let state: NotifyState = emptyNotifyState;

  return summaries.map((s) => {
    const plan = planAgentNotifications({ state, summary: s, windowFocused });

    state = plan.state;

    return plan.show.map((n) => n.notification.id);
  });
};

describe("planAgentNotifications", () => {
  test("shows each new notification once, with the agent's words and the session", () => {
    const { state } = planAgentNotifications({
      state: emptyNotifyState,
      summary: summary([]),
      windowFocused: false,
    });

    const plan = planAgentNotifications({
      state,
      summary: summary([note("n1")]),
      windowFocused: false,
    });

    expect(plan.show).toEqual([
      {
        key: agentKey("local", "s1"),
        notification: note("n1"),
        title: "Tests pass",
        subtitle: "Fix the flaky test · This Mac",
        body: "Ready for review",
      },
    ]);
    expect(
      run([summary([]), summary([note("n1")]), summary([note("n1")]), summary([note("n2")])])
    ).toEqual([[], ["n1"], [], ["n2"]]);
  });

  test("what the first summary holds is history, not news", () => {
    expect(run([summary([note("n1")]), summary([note("n1")])])).toEqual([[], []]);
  });

  test("not for the session the focused window shows; still for others", () => {
    const focused = { hostKey: "local", sessionId: "s1" };

    expect(
      run([summary([], focused), summary([note("n1"), note("n2", "s2")], focused)], true)
    ).toEqual([[], ["n2"]]);
    expect(run([summary([], focused), summary([note("n1")], focused)], false)).toEqual([
      [],
      ["n1"],
    ]);
  });
});
