import { expect, test } from "bun:test";
import { answerOf, PushAction } from "../push/answer.ts";
import { Option } from "effect";
import { applyHostItem, emptyHostFeed } from "../home/feed/fold.ts";
import { commandApproval, session, snapshot, summary } from "../home/fixtures.testing.ts";
import { confirmedBy, decodeLiveAnswer, liveAnswerOf } from "./answer.ts";

const target = { hostId: "studio", sessionId: "s1", requestId: "r1", line: "git push" };

test.each([
  ["approve", PushAction.approve],
  ["always", PushAction.always],
  ["deny", PushAction.deny],
] as const)(
  "the takeover's %s is the notification's answer, sent once from either",
  (decision, action) => {
    const notification = answerOf({
      actionIdentifier: action,
      userInfo: [{ polaris: { kind: "needs-you", ...target } }],
    });

    const answer = Option.getOrThrow(decodeLiveAnswer({ ...target, decision }));

    expect(notification?.dispatch).toEqual(liveAnswerOf(answer).dispatch);
  }
);

test("anything the intent didn't send is no answer", () => {
  expect(Option.isNone(decodeLiveAnswer({ ...target, decision: "maybe" }))).toBe(true);
  expect(Option.isNone(decodeLiveAnswer({ hostId: "studio" }))).toBe(true);
});

const feed = applyHostItem(
  emptyHostFeed,
  snapshot({
    sessions: [
      summary(session({ id: "s1", state: "needs-you" }), [
        commandApproval("s1", "r1", "git push origin main"),
      ]),
    ],
  })
);

test.each([
  ["the line it shows, cut", { line: "git push or…" }, true],
  ["the whole line", { line: "git push origin main" }, true],
  ["other words for the request", { line: "ls" }, false],
  ["a request open on another session", { sessionId: "s2", line: "git push origin main" }, false],
  [
    "a request the Host doesn't have open",
    { requestId: "r9", line: "git push origin main" },
    false,
  ],
] as const)("the Host's own feed confirms %s: %p", (_, change, confirmed) => {
  const answer = Option.getOrThrow(decodeLiveAnswer({ ...target, decision: "approve", ...change }));

  expect(confirmedBy(feed, answer)).toBe(confirmed);
});
