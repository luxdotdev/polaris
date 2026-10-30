import { expect, test } from "bun:test";
import { answerOf, PushAction } from "../push/answer.ts";
import { Option } from "effect";
import { decodeLiveAnswer, liveAnswerOf } from "./answer.ts";

const target = { hostId: "studio", sessionId: "s1", requestId: "r1" };

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
