import { describe, expect, test } from "bun:test";
import type { NeedsYouSession, NeedsYouSummary, NeedsYouTurn } from "../../shared/needsYou.ts";
import { emptyTurnState, planTurnNotifications, type TurnState, turnKey } from "./turnPlan.ts";

const START = "2026-10-19T09:00:00.000Z";

/** `minutes` after the user's prompt, on the Host's clock. */
const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60_000).toISOString();

interface TurnPatch {
  readonly sessionId?: string;
  readonly minutes?: number;
  readonly tasks?: number;
  /** The user Turn's id; null for one not seen live (a snapshot). */
  readonly userTurnId?: string | null;
}

const turn = (
  state: NeedsYouTurn["state"],
  { sessionId = "s1", minutes = 0, tasks = 0, userTurnId = "t1" }: TurnPatch = {}
): NeedsYouTurn => ({
  hostKey: "local",
  hostLabel: "This Mac",
  sessionId,
  title: "Fix the flaky test",
  harness: "Claude Code",
  state,
  prompt: "make the retry test deterministic",
  backgroundTasks: tasks,
  userTurn:
    userTurnId === null
      ? null
      : { id: userTurnId, startedAt: START, prompt: "make the retry test deterministic" },
  updatedAt: at(minutes),
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

const of = (...turns: ReadonlyArray<NeedsYouTurn>) => summary({ turns });

interface Run {
  readonly windowFocused?: boolean;
  readonly minMinutes?: number;
}

/** Feeds summaries in order and collects every plan. */
const run = (
  summaries: ReadonlyArray<NeedsYouSummary>,
  { windowFocused = false, minMinutes }: Run = {}
) => {
  let state: TurnState = emptyTurnState;

  return summaries.map((s) => {
    const plan = planTurnNotifications({
      state,
      summary: s,
      windowFocused,
      minDurationMs: minMinutes === undefined ? null : minMinutes * 60_000,
    });

    state = plan.state;

    return plan;
  });
};

const shown = (plans: ReturnType<typeof run>) => plans.map((p) => p.show.length);

describe("planTurnNotifications", () => {
  test("Working then Idle notifies once, with the Harness, session and prompt", () => {
    const plans = run([of(turn("working")), of(turn("idle")), of(turn("idle"))]);

    expect(shown(plans)).toEqual([0, 1, 0]);
    expect(plans[1]?.show[0]).toMatchObject({
      key: turnKey("local", "s1"),
      title: "Claude Code finished a turn",
      subtitle: "Fix the flaky test · This Mac",
      body: "make the retry test deterministic",
    });
  });

  test("a Lead Turn Polaris started for a digest ends quietly", () => {
    const digest = { ...turn("idle"), digestStarted: true };

    expect(run([of(turn("working")), of(digest)])[1]?.show).toEqual([]);
  });

  test("a session first seen Idle (launch, a new Host) is not news", () => {
    expect(run([of(turn("idle"))])[0]?.show).toEqual([]);
  });

  test("no notification for the session the focused window shows", () => {
    const focused = { hostKey: "local", sessionId: "s1" };

    const plans = run(
      [summary({ focused, turns: [turn("working")] }), summary({ focused, turns: [turn("idle")] })],
      { windowFocused: true }
    );

    expect(plans[1]?.show).toEqual([]);
  });

  test("a Turn that needed you on the way still notifies when it ends", () => {
    const plans = run([
      of(turn("working")),
      summary({ sessions: [waiting()] }),
      of(turn("idle", { minutes: 6 })),
    ]);

    expect(shown(plans)).toEqual([0, 0, 1]);
  });

  test("a failed or archived session drops out without a notification", () => {
    expect(shown(run([of(turn("working")), summary({}), of(turn("idle"))]))).toEqual([0, 0, 0]);
  });

  test("the user's next Turn closes the last one's notification", () => {
    const plans = run([
      of(turn("working")),
      of(turn("idle")),
      of(turn("working", { userTurnId: "t2" })),
    ]);

    expect(plans[2]?.close).toEqual([turnKey("local", "s1")]);
  });

  describe("background tasks", () => {
    test("Idle with tasks live is waiting, and it notifies once they're done", () => {
      const plans = run([
        of(turn("working")),
        of(turn("idle", { tasks: 2 })),
        of(turn("idle", { tasks: 1 })),
        of(turn("idle")),
      ]);

      expect(shown(plans)).toEqual([0, 0, 0, 1]);
    });

    test("a Turn the Harness started when they reported continues the user's: one banner", () => {
      const plans = run([
        of(turn("working")),
        of(turn("idle", { tasks: 1 })),
        // Its tasks report: the Harness starts a Turn, the user Turn stays t1.
        of(turn("working")),
        of(turn("idle")),
        of(turn("working")),
        of(turn("idle")),
      ]);

      expect(shown(plans)).toEqual([0, 0, 0, 1, 0, 0]);
      expect(plans.flatMap((p) => p.close)).toEqual([]);
    });

    test("the focused session held back at completion stays quiet through a continuation", () => {
      const focused = { hostKey: "local", sessionId: "s1" };

      const plans = run(
        [
          of(turn("working")),
          summary({ focused, turns: [turn("idle")] }),
          of(turn("working")),
          of(turn("idle")),
        ],
        { windowFocused: true }
      );

      expect(shown(plans)).toEqual([0, 0, 0, 0]);
    });
  });

  describe("only turns longer than 5 minutes", () => {
    const ended = (minutes: number, extra: ReadonlyArray<NeedsYouSummary> = []) =>
      shown(
        run([of(turn("working", { minutes: 0 })), ...extra, of(turn("idle", { minutes }))], {
          minMinutes: 5,
        })
      ).at(-1);

    test.each([
      ["under", 4.9, 0],
      ["exactly", 5, 0],
      ["over", 5.1, 1],
    ])("%s: a %d-minute turn", (_, minutes, count) => {
      expect(ended(minutes)).toBe(count);
    });

    test("timed from the user's prompt, not from the continuation the Harness started", () => {
      const plans = run(
        [
          of(turn("working", { minutes: 1 })),
          of(turn("idle", { minutes: 2, tasks: 1 })),
          of(turn("working", { minutes: 5 })),
          of(turn("idle", { minutes: 6 })),
        ],
        { minMinutes: 5 }
      );

      expect(shown(plans)).toEqual([0, 0, 0, 1]);
    });

    test("a turn not seen from its prompt is timed from when it was first seen under way", () => {
      const unknown = (state: NeedsYouTurn["state"], minutes: number) =>
        turn(state, { minutes, userTurnId: null });

      const short = run([of(unknown("working", 3)), of(unknown("idle", 7))], { minMinutes: 5 });
      const long = run([of(unknown("working", 3)), of(unknown("idle", 9))], { minMinutes: 5 });

      expect([shown(short)[1], shown(long)[1]]).toEqual([0, 1]);
    });

    test("the focused session is still held back", () => {
      const focused = { hostKey: "local", sessionId: "s1" };

      const plans = run(
        [
          summary({ focused, turns: [turn("working")] }),
          summary({ focused, turns: [turn("idle", { minutes: 30 })] }),
        ],
        { windowFocused: true, minMinutes: 5 }
      );

      expect(plans[1]?.show).toEqual([]);
    });
  });
});
