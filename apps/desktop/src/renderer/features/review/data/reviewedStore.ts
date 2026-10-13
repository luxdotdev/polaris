/**
 * Reviews submitted from this Mac and whether the queue's Reviewed group is open, kept in
 * this window's `localStorage`. GitHub keeps the viewer's reviews too; these count at once,
 * before its next poll, and survive a restart while its search catches up.
 */
import { Option, Schema } from "effect";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PullRowView, SubmittedReview } from "../../../../shared/github.ts";
import { type LocalReview, type LocalReviews, snapshotOf } from "../model/reviewed.ts";

const REVIEWS_KEY = "polaris.review.reviewed.v1";

const OPEN_KEY = "polaris.review.reviewedOpen.v1";

/** Kept this long, and at most this many. */
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const KEEP = 200;

const Snapshot = Schema.Struct({
  id: Schema.String,
  number: Schema.Number,
  title: Schema.String,
  url: Schema.String,
  repo: Schema.String,
  host: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  headRefOid: Schema.String,
  updatedAt: Schema.String,
});

const Saved = Schema.Record(
  Schema.String,
  Schema.Struct({
    at: Schema.String,
    commitOid: Schema.NullOr(Schema.String),
    row: Schema.NullOr(Snapshot),
  })
);

const decodeSaved = Schema.decodeUnknownOption(Schema.fromJsonString(Saved));

interface Reviewed {
  readonly reviews: LocalReviews;
  /** The queue's Reviewed group; closed by default. */
  readonly open: boolean;
}

const storage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Drops the old and the excess, newest kept. */
export const pruned = (reviews: LocalReviews, now: number): LocalReviews =>
  Object.fromEntries(
    Object.entries(reviews)
      .filter(([, r]) => now - Date.parse(r.at) <= KEEP_MS)
      .toSorted(([, a], [, b]) => b.at.localeCompare(a.at))
      .slice(0, KEEP)
  );

const readReviews = (): LocalReviews => {
  try {
    return pruned(
      Option.getOrElse(decodeSaved(storage()?.getItem(REVIEWS_KEY) ?? "{}"), () => ({})),
      Date.now()
    );
  } catch {
    return {};
  }
};

const readOpen = (): boolean => {
  try {
    return storage()?.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
};

export const reviewedStore = createStore<Reviewed>(() => ({
  reviews: readReviews(),
  open: readOpen(),
}));

export const useLocalReviews = (): LocalReviews => useStore(reviewedStore, (s) => s.reviews);

export const useReviewedOpen = (): boolean => useStore(reviewedStore, (s) => s.open);

const write = (key: string, value: string) => {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Not remembered this time; it still holds in this window.
  }
};

export const setReviewedOpen = (open: boolean) => {
  reviewedStore.setState({ open });
  write(OPEN_KEY, String(open));
};

/** A review GitHub just took: on its commit, or the head the row last showed. */
export const recordReview = (
  pullId: string,
  submitted: SubmittedReview,
  row: PullRowView | null,
  now: number = Date.now()
) => {
  const review: LocalReview = {
    at: submitted.at ?? new Date(now).toISOString(),
    commitOid: submitted.commitOid ?? row?.headRefOid ?? null,
    row: row === null ? null : snapshotOf(row),
  };

  const reviews = pruned({ ...reviewedStore.getState().reviews, [pullId]: review }, now);

  reviewedStore.setState({ reviews });
  write(REVIEWS_KEY, JSON.stringify(reviews));
};
