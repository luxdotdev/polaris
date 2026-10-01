/**
 * Which native notifications to show and close for review requests (ENG-229): one per new
 * entry in the PR list's `requested`, never twice while the request stands. A request last
 * updated before Polaris saw its account (this launch, or a sign-in) was already there: it
 * is marked without a banner. Pure, so it is unit-tested.
 */
import type { PullListView, PullRowView } from "../../shared/github.ts";

export interface ReviewNotificationState {
  /** Requested pull request ids already notified (or already there); pruned as requests go. */
  readonly notified: ReadonlySet<string>;
}

export const emptyReviewState: ReviewNotificationState = { notified: new Set() };

/** GitHub's clock and this Mac's can disagree by this much. */
export const SKEW_MS = 60_000;

/** When Polaris first saw each account signed in (ms); null for one it hasn't seen yet. */
export type SeenSince = (accountId: number) => number | null;

/** More new requests than this in one poll make one notification, not a burst. */
export const BURST = 3;

export interface ReviewNotification {
  /** The pull request's node id; a burst's key is "burst". */
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly body: string;
  /** What a click opens: the pull request, or the list for a burst. */
  readonly pull: PullRowView | null;
}

export interface ReviewPlan {
  readonly show: ReadonlyArray<ReviewNotification>;
  /** Keys of notifications whose request is gone (reviewed, withdrawn, merged). */
  readonly close: ReadonlyArray<string>;
  readonly state: ReviewNotificationState;
}

const contentOf = (row: PullRowView): ReviewNotification => ({
  key: row.id,
  title: "Review requested",
  subtitle: `${row.repo} #${row.number}`,
  body: row.author === null ? row.title : `${row.title}\n${row.author.login}`,
  pull: row,
});

const burstOf = (rows: ReadonlyArray<PullRowView>): ReviewNotification => ({
  key: "burst",
  title: `${rows.length} reviews requested`,
  subtitle: [...new Set(rows.map((r) => r.repo))].join(", "),
  body: rows.map((r) => r.title).join("\n"),
  pull: null,
});

/** Requested since Polaris saw the account: worth a banner. */
const isNew = (row: PullRowView, since: SeenSince) => {
  const seen = since(row.accountId);

  return seen !== null && Date.parse(row.updatedAt) >= seen - SKEW_MS;
};

export const planReviewNotifications = (
  state: ReviewNotificationState,
  list: PullListView,
  since: SeenSince
): ReviewPlan => {
  if (list.updatedAt === null) return { show: [], close: [], state };

  const live = new Set(list.requested.map((r) => r.id));
  const close = [...state.notified].filter((id) => !live.has(id));
  const fresh = list.requested.filter((r) => !state.notified.has(r.id) && isNew(r, since));
  const show = fresh.length > BURST ? [burstOf(fresh)] : fresh.map(contentOf);

  return { show, close, state: { notified: live } };
};
