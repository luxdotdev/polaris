import { describe, expect, test } from "bun:test";
import type { PullListView, PullRowView } from "../../../../shared/github.ts";
import { advanceFrom, queueGroups, visibleRows, withoutPulls } from "./queue.ts";
import { LOCAL_GRACE_MS, type LocalReviews, placeOf, placePulls, snapshotOf } from "./reviewed.ts";

const AT = "2026-10-13T10:00:00Z";

const LATER = "2026-10-13T11:00:00Z";

const row = (number: number, patch: Partial<PullRowView> = {}): PullRowView => ({
  id: `PR_${number}`,
  number,
  title: `PR ${number}`,
  url: `https://github.com/acme/atlas/pull/${number}`,
  repo: "acme/atlas",
  isDraft: false,
  author: { login: "mchen", avatarUrl: "" },
  headRefName: "feature",
  headRefOid: "head1",
  baseRefName: "main",
  additions: 1,
  deletions: 0,
  updatedAt: `2026-10-13T0${number % 10}:00:00Z`,
  reviewDecision: "review-required",
  viewerLatestReview: null,
  viewerReview: null,
  viewerRequested: true,
  requestedReviewers: ["me"],
  accountId: 1,
  workspaces: [],
  ...patch,
});

const list = (patch: Partial<PullListView>): PullListView => ({
  requested: [],
  mine: [],
  other: [],
  reviewed: [],
  repos: [],
  updatedAt: 1,
  polling: "focused",
  throttledUntil: null,
  error: null,
  errorKind: null,
  ...patch,
});

/** GitHub's record after the viewer reviewed at `oid`: no longer asked by name. */
const reviewedOn = (oid: string, at = AT): Partial<PullRowView> => ({
  viewerReview: { at, commitOid: oid },
  viewerRequested: false,
});

const ids = (rows: ReadonlyArray<{ readonly id: string }>) => rows.map((r) => r.id);

describe("placeOf", () => {
  test("never reviewed: requested when GitHub asks, otherwise where it was", () => {
    expect(placeOf(row(1), true, undefined)).toEqual({ kind: "requested", since: null });
    expect(placeOf(row(1), false, undefined)).toEqual({ kind: "stay" });
  });

  test("reviewed at the head and no longer asked: Reviewed", () => {
    const place = placeOf(row(1, reviewedOn("head1")), true, undefined);

    expect(place).toEqual({ kind: "reviewed", review: { at: AT, commitOid: "head1" } });
  });

  test("new commits since the review: back to requested, saying since when", () => {
    const place = placeOf(row(1, { ...reviewedOn("old"), headRefOid: "head2" }), false, undefined);

    expect(place).toEqual({ kind: "requested", since: { at: AT, commitOid: "old" } });
  });

  test("GitHub asks again by name, no new commits: back to requested", () => {
    const asked = row(1, { ...reviewedOn("head1"), viewerRequested: true });

    expect(placeOf(asked, true, undefined)).toEqual({ kind: "requested", since: null });
  });

  test("submitted here, GitHub's list not caught up: Reviewed at once", () => {
    // The row still says requested and has no review: it predates the submit.
    const place = placeOf(row(1, { headRefOid: "head0" }), true, {
      at: LATER,
      commitOid: "head1",
      row: null,
    });

    expect(place).toEqual({ kind: "reviewed", review: { at: LATER, commitOid: "head1" } });
  });

  test("a newer GitHub review wins over an older one from this Mac", () => {
    const place = placeOf(row(1, { ...reviewedOn("head2", LATER), headRefOid: "head3" }), false, {
      at: AT,
      commitOid: "head1",
      row: null,
    });

    expect(place).toEqual({ kind: "requested", since: { at: LATER, commitOid: "head2" } });
  });
});

describe("placePulls", () => {
  test("requested, re-requested after a push, reviewed and other open", () => {
    const placed = placePulls(
      list({
        requested: [row(1), row(2, reviewedOn("head1"))],
        other: [
          row(3, { ...reviewedOn("old"), headRefOid: "new" }),
          row(4, { viewerRequested: false }),
        ],
        reviewed: [row(5, reviewedOn("head1"))],
        mine: [row(6, reviewedOn("head1"))],
      }),
      {},
      Date.parse(LATER)
    );

    expect(ids(placed.requested.map((p) => p.row))).toEqual(["PR_3", "PR_1"]);
    expect(placed.requested[0]?.since).toEqual({ at: AT, commitOid: "old" });
    expect(ids(placed.other)).toEqual(["PR_4"]);
    expect(ids(placed.reviewed.map((r) => r.row))).toEqual(["PR_2", "PR_5"]);
  });

  test("a review from this Mac keeps a pull request no list has yet, for a while", () => {
    const local: LocalReviews = {
      PR_9: { at: AT, commitOid: "head1", row: snapshotOf(row(9)) },
    };

    const soon = placePulls(list({}), local, Date.parse(AT) + 1000);
    const later = placePulls(list({}), local, Date.parse(AT) + LOCAL_GRACE_MS + 1000);

    expect(ids(soon.reviewed.map((r) => r.row))).toEqual(["PR_9"]);
    expect(soon.reviewed[0]?.row.url).toBe("https://github.com/acme/atlas/pull/9");
    expect(later.reviewed).toEqual([]);
  });
});

describe("the queue's Reviewed group and advancing", () => {
  const groups = queueGroups(
    list({
      requested: [row(3), row(2), row(1, reviewedOn("head1"))],
      other: [row(4, { viewerRequested: false })],
    }),
    []
  );

  test("Reviewed comes last, folds, and keeps its rows out of ⌃1…⌃9 while closed", () => {
    expect(groups.map((g) => g.id)).toEqual(["requested", "other", "reviewed"]);
    expect(groups.at(-1)?.collapsible).toBe(true);
    expect(ids(visibleRows(groups, false))).toEqual(["PR_3", "PR_2", "PR_4"]);
    expect(ids(visibleRows(groups, true))).toEqual(["PR_3", "PR_2", "PR_4", "PR_1"]);
  });

  test("rows carry their GitHub page", () => {
    const first = groups[0]?.rows[0];

    expect(first?.kind === "pull" ? first.url : null).toBe("https://github.com/acme/atlas/pull/3");
  });

  test("after a review: the next row of its group, else the first left, else done", () => {
    expect(advanceFrom(groups, "PR_3")).toMatchObject({ kind: "open", row: { id: "PR_2" } });
    expect(advanceFrom(groups, "PR_2")).toMatchObject({ kind: "open", row: { id: "PR_3" } });
    expect(advanceFrom(groups, "PR_4")).toEqual({ kind: "done", group: "other" });
  });

  test("a pull request in Reviewed, Mine or no group stays put", () => {
    expect(advanceFrom(groups, "PR_1")).toEqual({ kind: "stay" });
    expect(advanceFrom(groups, "PR_404")).toEqual({ kind: "stay" });

    const mine = queueGroups(list({ mine: [row(7)] }), []);

    expect(advanceFrom(mine, "PR_7")).toEqual({ kind: "stay" });
  });

  test("after a merge it leaves any group, Mine and Reviewed too", () => {
    const mine = queueGroups(list({ mine: [row(7), row(8)] }), []);

    expect(advanceFrom(mine, "PR_7", "merged")).toMatchObject({
      kind: "open",
      row: { id: "PR_8" },
    });
    expect(advanceFrom(groups, "PR_1", "merged")).toEqual({ kind: "done", group: "reviewed" });
  });

  test("merged pull requests leave the lists until GitHub's catch up", () => {
    const shown = queueGroups(
      withoutPulls(list({ requested: [row(3), row(2)] }), new Set(["PR_3"])),
      []
    );

    expect(ids(visibleRows(shown, true))).toEqual(["PR_2"]);
  });
});
