/**
 * Where a pull request sits in Review's queue once the viewer has reviewed it (DESIGN.md,
 * Review → Queue): Reviewed while their review is on the head, back in Review requested
 * when new commits land or GitHub asks again. GitHub's own record of the viewer's latest
 * review is the truth; a review submitted from this Mac counts at once, before the next poll.
 * Why: docs/adr/0038-reviewed-pull-requests.md.
 */
import type { PullListView, PullRowView, ViewerReview } from "../../../../shared/github.ts";

/** What the queue shows of a pull request no list has yet. */
export interface PullSnapshot {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  readonly host: string | null;
  readonly author: string | null;
  readonly headRefOid: string;
  readonly updatedAt: string;
}

export const snapshotOf = (row: PullRowView): PullSnapshot => ({
  id: row.id,
  number: row.number,
  title: row.title,
  url: row.url,
  repo: row.repo,
  host: row.host ?? null,
  author: row.author?.login ?? null,
  headRefOid: row.headRefOid,
  updatedAt: row.updatedAt,
});

const rowOfSnapshot = (s: PullSnapshot): PullRowView => {
  const row = snapshotRow(s);

  return s.host === null ? row : { ...row, host: s.host };
};

const snapshotRow = (s: PullSnapshot): PullRowView => ({
  id: s.id,
  number: s.number,
  title: s.title,
  url: s.url,
  repo: s.repo,
  isDraft: false,
  author: s.author === null ? null : { login: s.author, avatarUrl: "" },
  headRefName: "",
  headRefOid: s.headRefOid,
  baseRefName: "",
  additions: 0,
  deletions: 0,
  updatedAt: s.updatedAt,
  reviewDecision: null,
  viewerLatestReview: null,
  requestedReviewers: [],
  accountId: 0,
  workspaces: [],
});

/** A review submitted from this Mac, kept until GitHub's list has caught up (and after). */
export interface LocalReview extends ViewerReview {
  /** The pull request as it was, so it stays listed while GitHub's search catches up. */
  readonly row: PullSnapshot | null;
}

export type LocalReviews = Readonly<Record<string, LocalReview>>;

/** How long a submitted review stands in for a pull request no list has yet. */
export const LOCAL_GRACE_MS = 15 * 60 * 1000;

export type Place =
  | { readonly kind: "stay" }
  | { readonly kind: "requested"; readonly since: ViewerReview | null }
  | { readonly kind: "reviewed"; readonly review: ViewerReview };

const STAY: Place = { kind: "stay" };

/** The later of this Mac's record and GitHub's; GitHub's wins a tie. */
export const latestReview = (
  local: ViewerReview | undefined,
  github: ViewerReview | null
): ViewerReview | null => {
  if (local === undefined) return github;
  const mine = { at: local.at, commitOid: local.commitOid };

  if (github === null) return mine;

  return mine.at > github.at ? mine : github;
};

/**
 * `asked`: the row came from GitHub's review-requested search. A row is fresh when GitHub's
 * record already holds the latest review; until then it can't say anything newer.
 */
export const placeOf = (
  row: PullRowView,
  asked: boolean,
  local: LocalReview | undefined
): Place => {
  const github = row.viewerReview ?? null;
  const review = latestReview(local, github);

  if (review === null) return asked ? { kind: "requested", since: null } : STAY;

  const fresh = github !== null && github.at >= review.at;

  if (!fresh) return { kind: "reviewed", review };

  if (review.commitOid !== null && review.commitOid !== row.headRefOid)
    return { kind: "requested", since: review };

  if (asked && row.viewerRequested !== false) return { kind: "requested", since: null };

  return { kind: "reviewed", review };
};

export interface PlacedRow {
  readonly row: PullRowView;
  /** Back in Review requested after new commits: the review they came after. */
  readonly since: ViewerReview | null;
}

export interface ReviewedRow {
  readonly row: PullRowView;
  readonly review: ViewerReview;
}

export interface Placed {
  readonly requested: ReadonlyArray<PlacedRow>;
  readonly other: ReadonlyArray<PullRowView>;
  /** Most recently reviewed first. */
  readonly reviewed: ReadonlyArray<ReviewedRow>;
}

const byUpdated = (a: PlacedRow, b: PlacedRow) => b.row.updatedAt.localeCompare(a.row.updatedAt);

/** Review requested, Other open and Reviewed from GitHub's lists and this Mac's reviews. */
export const placePulls = (list: PullListView | null, local: LocalReviews, now: number): Placed => {
  const requested: Array<PlacedRow> = [];
  const other: Array<PullRowView> = [];
  const reviewed: Array<ReviewedRow> = [];
  const seen = new Set<string>(list?.mine.map((r) => r.id) ?? []);

  const sort = (row: PullRowView, asked: boolean, fallback: "other" | "reviewed") => {
    seen.add(row.id);
    const place = placeOf(row, asked, local[row.id]);

    if (place.kind === "requested") requested.push({ row, since: place.since });
    else if (place.kind === "reviewed") reviewed.push({ row, review: place.review });
    else if (fallback === "other") other.push(row);
  };

  for (const row of list?.requested ?? []) sort(row, true, "other");

  for (const row of list?.other ?? []) sort(row, false, "other");

  for (const row of list?.reviewed ?? []) sort(row, false, "reviewed");

  // Submitted here moments ago, and in no list yet: GitHub's search is behind.
  for (const [id, review] of Object.entries(local)) {
    if (seen.has(id) || review.row === null || now - Date.parse(review.at) > LOCAL_GRACE_MS)
      continue;

    reviewed.push({ row: rowOfSnapshot(review.row), review });
  }

  return {
    requested: requested.toSorted(byUpdated),
    other,
    reviewed: reviewed.toSorted((a, b) => b.review.at.localeCompare(a.review.at)),
  };
};
