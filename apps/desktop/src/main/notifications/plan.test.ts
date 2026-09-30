import { describe, expect, test } from "bun:test";
import type {
  NeedsYouAction,
  NeedsYouRequest,
  NeedsYouSession,
  NeedsYouSummary,
} from "../../shared/needsYou.ts";
import { NOTIFICATION_BUTTONS, notificationHandlers } from "./actions.ts";
import { emptyNotificationState, notificationKey, planNotifications } from "./plan.ts";

const req = (requestId: string, kind: NeedsYouRequest["kind"] = "command"): NeedsYouRequest => ({
  requestId,
  kind,
  title: kind === "question" ? "Monthly or annually?" : "Run bun test",
  detail: kind === "question" ? null : "bun test --coverage",
  options: [],
});

const session = (
  sessionId: string,
  requests: ReadonlyArray<NeedsYouRequest>,
  hostKey = "local"
): NeedsYouSession => ({
  hostKey,
  hostLabel: hostKey === "local" ? "Mac Studio" : "Linux VM",
  workspace: "polaris",
  sessionId,
  title: `Session ${sessionId}`,
  harness: "Codex",
  requests,
});

const summary = (
  sessions: ReadonlyArray<NeedsYouSession>,
  focused: NeedsYouSummary["focused"] = null
): NeedsYouSummary => ({ count: sessions.length, sessions, focused });

const plan = (s: NeedsYouSummary, state = emptyNotificationState, windowFocused = false) =>
  planNotifications({ state, summary: s, windowFocused });

describe("notification plan", () => {
  test("one notification per new request, never repeated", () => {
    const first = plan(summary([session("a", [req("r1")])]));

    expect(first.show.map((n) => [n.title, n.subtitle, n.body, n.actions])).toEqual([
      ["Codex needs you", "Session a · Mac Studio", "Run bun test\nbun test --coverage", true],
    ]);

    const again = plan(summary([session("a", [req("r1")])]), first.state);

    expect(again.show).toEqual([]);
    expect(again.close).toEqual([]);
  });

  test("grouped per session: a second request replaces it, without buttons", () => {
    const first = plan(summary([session("a", [req("r1")])]));
    const second = plan(summary([session("a", [req("r1"), req("r2")])]), first.state);

    expect(second.show.map((n) => [n.key, n.title, n.request.requestId, n.actions])).toEqual([
      [notificationKey("local", "a"), "Codex needs you · 2 waiting", "r2", false],
    ]);
  });

  test("questions offer a reply, not Approve / Deny", () => {
    const [shown] = plan(summary([session("q", [req("r1", "question")])])).show;

    expect(shown).toMatchObject({ actions: false, reply: true, body: "Monthly or annually?" });
  });

  test("suppressed for the session the focused window shows, and not shown later", () => {
    const focused = { hostKey: "local", sessionId: "a" };

    const suppressed = plan(
      summary([session("a", [req("r1")])], focused),
      emptyNotificationState,
      true
    );

    expect(suppressed.show).toEqual([]);
    // Once the user looks away, the same request doesn't pop up late.
    expect(plan(summary([session("a", [req("r1")])]), suppressed.state).show).toEqual([]);
    // With the window in the background, the selected session still notifies.
    expect(
      plan(summary([session("a", [req("r1")])], focused), emptyNotificationState, false).show
    ).toHaveLength(1);
  });

  test("closes a notification once its requests are answered", () => {
    const first = plan(summary([session("a", [req("r1")]), session("b", [req("r2")], "vm")]));
    const answered = plan(summary([session("b", [req("r2")], "vm")]), first.state);

    expect(answered.close).toEqual([notificationKey("local", "a")]);
    expect(answered.show).toEqual([]);
    expect([...answered.state.notified]).toEqual(["r2"]);
  });

  test("an Interrupted Turn (no requests) doesn't notify", () => {
    expect(plan(summary([session("i", [])])).show).toEqual([]);
  });
});

describe("notification actions", () => {
  const acted = (drive: (on: ReturnType<typeof notificationHandlers>) => void) => {
    const content = plan(summary([session("a", [req("r1")])])).show[0]!;
    const actions: Array<NeedsYouAction> = [];

    drive(notificationHandlers(content, (a) => actions.push(a)));

    return actions;
  };

  test("the buttons are Approve then Deny, and answer the notified request", () => {
    expect(NOTIFICATION_BUTTONS).toEqual(["Approve", "Deny"]);
    const where = { hostKey: "local", sessionId: "a", requestId: "r1" };

    expect(acted((on) => on.action(0))).toEqual([{ action: "approve", ...where }]);
    expect(acted((on) => on.action(1))).toEqual([{ action: "deny", ...where }]);
    expect(acted((on) => on.reply("Monthly"))).toEqual([
      { action: "answer", ...where, text: "Monthly" },
    ]);
    expect(acted((on) => on.click())).toEqual([
      { action: "open", hostKey: "local", sessionId: "a" },
    ]);
  });
});
