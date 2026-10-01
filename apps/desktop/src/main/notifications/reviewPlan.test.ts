import { describe, expect, test } from "bun:test";
import type { PullListView, PullRowView } from "../../shared/github.ts";
import { BURST, emptyReviewState, planReviewNotifications } from "./reviewPlan.ts";

const row = (id: string, number = 1): PullRowView => ({
  id,
  number,
  title: `Pull ${id}`,
  url: `https://github.com/acme/widgets/pull/${number}`,
  repo: "acme/widgets",
  isDraft: false,
  author: { login: "octocat", avatarUrl: "" },
  headRefName: "feature",
  headRefOid: "abc",
  baseRefName: "main",
  additions: 3,
  deletions: 1,
  updatedAt: "2026-09-30T09:00:00Z",
  reviewDecision: "review-required",
  viewerLatestReview: null,
  requestedReviewers: ["mona"],
  accountId: 1001,
  workspaces: [],
});

const list = (requested: ReadonlyArray<PullRowView>, loaded = true): PullListView => ({
  requested,
  mine: [],
  other: [],
  repos: [],
  updatedAt: loaded ? 1 : null,
  polling: "focused",
  throttledUntil: null,
  error: null,
});

describe("planReviewNotifications", () => {
  test("waits for a loaded list", () => {
    const plan = planReviewNotifications(emptyReviewState, list([row("a")], false));

    expect(plan.show).toEqual([]);
    expect(plan.state.seeded).toBe(false);
  });

  test("requests there at the first load only seed the state", () => {
    const plan = planReviewNotifications(emptyReviewState, list([row("a"), row("b")]));

    expect(plan.show).toEqual([]);
    expect([...plan.state.notified]).toEqual(["a", "b"]);
  });

  test("one notification per new request, never twice", () => {
    const seeded = planReviewNotifications(emptyReviewState, list([row("a")])).state;
    const first = planReviewNotifications(seeded, list([row("a"), row("b", 7)]));

    expect(first.show.map((n) => n.key)).toEqual(["b"]);
    expect(first.show[0]?.subtitle).toBe("acme/widgets #7");
    expect(first.show[0]?.body).toBe("Pull b\noctocat");

    const again = planReviewNotifications(first.state, list([row("a"), row("b", 7)]));

    expect(again.show).toEqual([]);
  });

  test("a request that goes closes its notification, and a new request for it notifies again", () => {
    const seeded = planReviewNotifications(emptyReviewState, list([row("a")])).state;
    const gone = planReviewNotifications(seeded, list([]));

    expect(gone.close).toEqual(["a"]);

    const back = planReviewNotifications(gone.state, list([row("a")]));

    expect(back.show.map((n) => n.key)).toEqual(["a"]);
  });

  test("a burst of new requests makes one notification", () => {
    const seeded = planReviewNotifications(emptyReviewState, list([])).state;
    const many = Array.from({ length: BURST + 1 }, (_, i) => row(`p${i}`, i + 1));
    const plan = planReviewNotifications(seeded, list(many));

    expect(plan.show).toHaveLength(1);
    expect(plan.show[0]?.title).toBe(`${BURST + 1} reviews requested`);
    expect(plan.show[0]?.pull).toBeNull();
  });
});
