/**
 * What Review shows: the pull request list with no subject open, or one subject. The PR
 * list, Needs You's Reviews group, the jump menu and review-request notifications open a
 * pull request with `openPull`; the Review view (`PullReview` slot) reads `useReviewSubject`.
 */
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { OpenPull } from "../../shared/api.ts";
import type { ShellActions } from "./navigation.ts";

export interface PullSubject {
  readonly kind: "pull";
  readonly pull: OpenPull;
}

export type ReviewSubject = PullSubject;

export interface ReviewRoute {
  readonly subject: ReviewSubject | null;
}

export const reviewRoute = createStore<ReviewRoute>(() => ({ subject: null }));

export const useReviewSubject = (): ReviewSubject | null => useStore(reviewRoute, (s) => s.subject);

/** Opens a pull request in Review (⌘2); Settings, if open, closes. */
export const openPull = (actions: Pick<ShellActions, "setMode">, pull: OpenPull) => {
  reviewRoute.setState({ subject: { kind: "pull", pull } });
  actions.setMode("review");
};

/** Back to the pull request list. */
export const closeReviewSubject = () => reviewRoute.setState({ subject: null });

/** A review-request notification: its pull request, or the list for a burst. */
export const onOpenPullEvent = (pull: OpenPull | null, actions: Pick<ShellActions, "setMode">) => {
  if (pull === null) {
    closeReviewSubject();
    actions.setMode("review");
  } else openPull(actions, pull);
};
