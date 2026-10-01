/**
 * What Review shows: the pull request list with no subject open, or one subject. The PR
 * list, Needs You's Reviews group, the jump menu and review-request notifications open a
 * pull request with `openPull`; ⌘↵ in the jump menu opens an Agent Session's Turns with
 * `openSessionReview`. The Review view (`PullReview` slot) reads `useReviewSubject`.
 */
import type { SessionId } from "@polaris/protocol";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { OpenPull } from "../../shared/api.ts";
import type { ShellActions } from "./navigation.ts";

export interface PullSubject {
  readonly kind: "pull";
  readonly pull: OpenPull;
}

/** An Agent Session's Turns; the view picks which (those since the last accept by default). */
export interface SessionSubject {
  readonly kind: "session";
  readonly hostKey: string;
  readonly sessionId: SessionId;
}

export type ReviewSubject = PullSubject | SessionSubject;

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

/** Opens an Agent Session's Turns in Review (⌘2). */
export const openSessionReview = (
  actions: Pick<ShellActions, "setMode">,
  hostKey: string,
  sessionId: SessionId
) => {
  reviewRoute.setState({ subject: { kind: "session", hostKey, sessionId } });
  actions.setMode("review");
};

/**
 * ⌃1…⌃9 while a Review is open: its queue's rows in visible order. Set by the queue while it
 * is mounted (only in Review); true when the digit picked a row.
 */
export interface ReviewDigits {
  pick: ((index: number) => boolean) | null;
}

export const reviewDigits: ReviewDigits = { pick: null };

/** Back to the pull request list. */
export const closeReviewSubject = () => reviewRoute.setState({ subject: null });

/** A review-request notification: its pull request, or the list for a burst. */
export const onOpenPullEvent = (pull: OpenPull | null, actions: Pick<ShellActions, "setMode">) => {
  if (pull === null) {
    closeReviewSubject();
    actions.setMode("review");
  } else openPull(actions, pull);
};
