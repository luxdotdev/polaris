import { ApprovalRequest, RequestId, SessionId, TurnId } from "@polaris/protocol";
import { expect, test } from "bun:test";
import { offersAlwaysAllow, offersRemember } from "./decide.ts";

const of = (kind: ApprovalRequest["kind"]) =>
  new ApprovalRequest({
    id: RequestId.make("r1"),
    sessionId: SessionId.make("s1"),
    turnId: TurnId.make("t1"),
    kind,
    title: "t",
    detail: null,
    options: [],
    openedAt: "2026-11-10T12:00:00.000Z",
  });

// The inbox, hover card and constellation rows offer "Always here" from this.
test("headed input is never offered Always allow; an app and a command are", () => {
  expect(offersAlwaysAllow(of("headed-input"), false)).toBe(false);
  expect(offersAlwaysAllow(of("app"), false)).toBe(true);
  expect(offersAlwaysAllow(of("command"), false)).toBe(true);
});

// The Host refuses a Teammate's remembered Allow, so no card offers one on a shared Host.
test("a Teammate is offered Approve and Deny only, on a session shared with them", () => {
  expect(
    [offersAlwaysAllow(of("command"), true), offersRemember(of("command"), true)].concat(
      offersRemember(of("command"), false)
    )
  ).toEqual([false, false, true]);
});
