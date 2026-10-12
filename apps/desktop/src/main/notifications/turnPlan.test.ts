import { describe, expect, test } from "bun:test";
import type { NeedsYouSession, NeedsYouSummary, NeedsYouTurn } from "../../shared/needsYou.ts";
import { emptyTurnState, planTurnNotifications, type TurnState, turnKey } from "./turnPlan.ts";

const turn = (state: NeedsYouTurn["state"], sessionId = "s1"): NeedsYouTurn => ({
  hostKey: "local",
  hostLabel: "This Mac",
  sessionId,
  title: "Fix the flaky test",
  harness: "Claude Code",
  state,
  prompt: "make the retry test deterministic",
});

const waiting = (sessionId = "s1"): NeedsYouSession => ({
  hostKey: "local",
  hostLabel: "This Mac",
  workspace: null,
  sessionId,
  title: "Fix the flaky test",
  harness: "Claude Code",
  requests: [],
});

const summary = (patch: Partial<NeedsYouSummary>): NeedsYouSummary => ({
  count: 0,
  sessions: [],
  focused: null,
  turns: [],
  ...patch,
});

/** Feeds summaries in order and collects every plan. */
const run = (summaries: ReadonlyArray<NeedsYouSummary>, windowFocused = false) => {
  let state: TurnState = emptyTurnState;

  return summaries.map((s) => {
    const plan = planTurnNotifications({ state, summary: s, windowFocused });

    state = plan.state;

    return plan;
  });
};

describe("planTurnNotifications", () => {
  test("Working then Idle notifies once, with the Harness, session and prompt", () => {
    const plans = run([
      summary({ turns: [turn("working")] }),
      summary({ turns: [turn("idle")] }),
      summary({ turns: [turn("idle")] }),
    ]);

    expect(plans.map((p) => p.show.length)).toEqual([0, 1, 0]);
    expect(plans[1]?.show[0]).toMatchObject({
      key: turnKey("local", "s1"),
      title: "Claude Code finished a turn",
      subtitle: "Fix the flaky test · This Mac",
      body: "make the retry test deterministic",
    });
  });

  test("a session first seen Idle (launch, a new Host) is not news", () => {
    expect(run([summary({ turns: [turn("idle")] })])[0]?.show).toEqual([]);
  });

  test("no notification for the session the focused window shows", () => {
    const focused = { hostKey: "local", sessionId: "s1" };

    const plans = run(
      [summary({ focused, turns: [turn("working")] }), summary({ focused, turns: [turn("idle")] })],
      true
    );

    expect(plans[1]?.show).toEqual([]);
  });

  test("a Turn that needed you on the way still notifies when it ends", () => {
    const plans = run([
      summary({ turns: [turn("working")] }),
      summary({ sessions: [waiting()] }),
      summary({ turns: [turn("idle")] }),
    ]);

    expect(plans.map((p) => p.show.length)).toEqual([0, 0, 1]);
  });

  test("a failed or archived session drops out without a notification", () => {
    const plans = run([
      summary({ turns: [turn("working")] }),
      summary({}),
      summary({ turns: [turn("idle")] }),
    ]);

    expect(plans.map((p) => p.show.length)).toEqual([0, 0, 0]);
  });

  test("the next Turn closes the last one's notification", () => {
    const plans = run([
      summary({ turns: [turn("working")] }),
      summary({ turns: [turn("idle")] }),
      summary({ turns: [turn("working")] }),
    ]);

    expect(plans[2]?.close).toEqual([turnKey("local", "s1")]);
  });
});
