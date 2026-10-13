/**
 * After a review goes out or a merge lands: record it (a reviewed pull request moves to
 * Reviewed, a merged one leaves the queue) and move the queue on to the next pull request
 * of its group, or to the done pane when it was the last. Only once GitHub took it; a
 * failure leaves the user where they were.
 */
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { PullListView, SubmittedReview } from "../../../../shared/github.ts";
import { pullsStore } from "../../pulls/store.ts";
import {
  advanceFrom,
  type Advance,
  type Moved,
  type QueueGroup,
  type QueueRow,
} from "../model/queue.ts";
import { recordReview } from "./reviewedStore.ts";

/** The pull request whose review or merge emptied its group, while it is still the subject. */
export interface Done {
  readonly pullId: string;
  readonly group: QueueGroup["id"];
  /** Absent for a review, from before merges moved the queue too. */
  readonly moved?: Moved;
}

export const doneStore = createStore<{ readonly done: Done | null }>(() => ({ done: null }));

export const useDone = (): Done | null => useStore(doneStore, (s) => s.done);

export const clearDone = () => doneStore.setState({ done: null });

/** Pull requests merged from this window, kept out of the queue until GitHub's lists drop them. */
export const mergedStore = createStore<{ readonly merged: ReadonlySet<string> }>(() => ({
  merged: new Set(),
}));

export const useMerged = (): ReadonlySet<string> => useStore(mergedStore, (s) => s.merged);

type Plan = (pullId: string, moved: Moved) => (() => void) | null;

interface Advancer {
  current: Plan | null;
}

/** Set by the mounted queue: where to go after reviewing a pull request it shows open. */
const advancer: Advancer = { current: null };

const rowIn = (list: PullListView | null, pullId: string) =>
  [
    ...(list?.requested ?? []),
    ...(list?.other ?? []),
    ...(list?.mine ?? []),
    ...(list?.reviewed ?? []),
  ].find((r) => r.id === pullId) ?? null;

/** GitHub took the review of `pullId`: it moves to Reviewed and the queue moves on. */
export const pullReviewed = (pullId: string, submitted: SubmittedReview) => {
  // Planned on the queue as it stood, before the pull request leaves its group.
  const go = advancer.current?.(pullId, "reviewed") ?? null;

  recordReview(pullId, submitted, rowIn(pullsStore.getState().list, pullId));
  go?.();
};

/** GitHub merged `pullId` (or will, on auto-merge it doesn't): it leaves the queue, which moves on. */
export const pullMerged = (pullId: string) => {
  const go = advancer.current?.(pullId, "merged") ?? null;

  mergedStore.setState((s) => ({ merged: new Set([...s.merged, pullId]) }));
  go?.();
};

/** Registers the queue's advance while Review shows `selected` among `groups`. */
export const useAdvance = (
  groups: ReadonlyArray<QueueGroup>,
  selected: string | null,
  open: (row: QueueRow) => void
) => {
  const latest = useRef({ groups, selected, open });

  latest.current = { groups, selected, open };

  useEffect(() => {
    const plan = (pullId: string, moved: Moved) => {
      const now = latest.current;

      if (now.selected !== pullId) return null;
      const advance: Advance = advanceFrom(now.groups, pullId, moved);

      if (advance.kind === "open") return () => now.open(advance.row);

      if (advance.kind === "done")
        return () => doneStore.setState({ done: { pullId, group: advance.group, moved } });

      return null;
    };

    advancer.current = plan;

    return () => {
      if (advancer.current === plan) advancer.current = null;
    };
  }, []);
};
