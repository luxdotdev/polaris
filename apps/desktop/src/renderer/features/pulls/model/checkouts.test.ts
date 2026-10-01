import { describe, expect, test } from "bun:test";
import {
  ReviewCheckout,
  ReviewCheckoutId,
  type ReviewSubject,
  SessionId,
  WorkspaceId,
} from "@polaris/protocol";
import { Data } from "effect";
import { emptyHostModel, type HostModel } from "../../../store/hostModel.ts";
import { checkoutsByPull } from "./checkouts.ts";

const Subjects = Data.taggedEnum<ReviewSubject>();

const checkout = (id: string, patch: Partial<ReviewCheckout> = {}) =>
  new ReviewCheckout({
    id: ReviewCheckoutId.make(id),
    workspaceId: WorkspaceId.make("w1"),
    subject: Subjects.PullRequest({
      pullRequest: { repo: { host: "github.com", owner: "Acme", name: "widgets" }, number: 42 },
      baseRef: "main",
    }),
    path: `/repo.worktrees/.review/${id}`,
    state: "ready",
    blocked: null,
    head: "h1",
    mergeBase: "b1",
    latestHead: "h1",
    latestBase: "b0",
    reviewedHead: null,
    reviewedMergeBase: null,
    openedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  });

const model = (checkouts: ReadonlyArray<ReviewCheckout>): HostModel => ({
  ...emptyHostModel,
  reviewCheckouts: new Map(checkouts.map((c) => [c.id, c])),
});

describe("checkoutsByPull", () => {
  test("the newest checkout of each pull request, keyed as the list keys it", () => {
    const found = checkoutsByPull({
      local: model([checkout("old")]),
      linux: model([checkout("new", { updatedAt: "2026-10-01T05:00:00.000Z" })]),
    });

    expect([...found.keys()]).toEqual(["github.com/acme/widgets#42"]);
    expect(found.get("github.com/acme/widgets#42")?.hostKey).toBe("linux");
    expect(found.get("github.com/acme/widgets#42")?.repo).toBe("github.com/acme/widgets");
    expect(found.get("github.com/acme/widgets#42")?.subjectKey).toBe("pull:acme/widgets#42");
  });

  test("a checkout being removed, or an Agent Session's, isn't one", () => {
    const session = checkout("s", {
      subject: Subjects.SessionTurns({
        sessionId: SessionId.make("x"),
        firstTurnId: null,
        lastTurnId: null,
      }),
    });

    expect(
      checkoutsByPull({ local: model([checkout("r", { state: "removing" }), session]) }).size
    ).toBe(0);
  });
});
