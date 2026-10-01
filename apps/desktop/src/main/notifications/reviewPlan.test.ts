import { describe, expect, test } from "bun:test";
import type { PullListView, PullRowView } from "../../shared/github.ts";
import { BURST, emptyReviewState, planReviewNotifications } from "./reviewPlan.ts";

const row = (
  id: string,
  number = 1,
  updatedAt = "2026-09-30T09:00:00Z",
  accountId = 1001
): PullRowView => ({
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
  updatedAt,
  reviewDecision: "review-required",
  viewerLatestReview: null,
  requestedReviewers: ["mona"],
  accountId,
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

const LAUNCH = Date.parse("2026-10-01T09:00:00Z");

/** Account 1001 seen at launch; any other not yet. */
const since = (accountId: number) => (accountId === 1001 ? LAUNCH : null);

const after = (minutes: number) => new Date(LAUNCH + minutes * 60_000).toISOString();

const plan = (
  state: typeof emptyReviewState,
  requested: ReadonlyArray<PullRowView>,
  loaded = true
) => planReviewNotifications(state, list(requested, loaded), since);

describe("planReviewNotifications", () => {
  test("waits for a loaded list", () => {
    const result = plan(emptyReviewState, [row("a", 1, after(5))], false);

    expect(result.show).toEqual([]);
    expect(result.state).toBe(emptyReviewState);
  });

  test("requests there before Polaris saw the account are marked without a banner", () => {
    const result = plan(emptyReviewState, [row("a"), row("b", 2, after(-0.5))]);

    expect(result.show.map((n) => n.key)).toEqual(["b"]);
    expect([...result.state.notified]).toEqual(["a", "b"]);
  });

  test("an account Polaris hasn't seen yet gets no banners", () => {
    expect(plan(emptyReviewState, [row("a", 1, after(5), 2002)]).show).toEqual([]);
  });

  test("one notification per new request, never twice", () => {
    const seeded = plan(emptyReviewState, [row("a")]).state;
    const first = plan(seeded, [row("a"), row("b", 7, after(5))]);

    expect(first.show.map((n) => n.key)).toEqual(["b"]);
    expect(first.show[0]?.subtitle).toBe("acme/widgets #7");
    expect(first.show[0]?.body).toBe("Pull b\noctocat");
    expect(plan(first.state, [row("a"), row("b", 7, after(5))]).show).toEqual([]);
  });

  test("a request that goes closes its notification; a new request for it notifies again", () => {
    const shown = plan(emptyReviewState, [row("a", 1, after(5))]);
    const gone = plan(shown.state, []);

    expect(gone.close).toEqual(["a"]);
    expect(plan(gone.state, [row("a", 1, after(9))]).show.map((n) => n.key)).toEqual(["a"]);
  });

  test("a burst of new requests makes one notification", () => {
    const many = Array.from({ length: BURST + 1 }, (_, i) => row(`p${i}`, i + 1, after(5)));
    const result = plan(emptyReviewState, many);

    expect(result.show).toHaveLength(1);
    expect(result.show[0]?.title).toBe(`${BURST + 1} reviews requested`);
    expect(result.show[0]?.pull).toBeNull();
  });
});
