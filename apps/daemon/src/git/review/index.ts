/**
 * The Review Checkout's git mechanics (docs/research/review-checkout.md,
 * ENG-221, ENG-228): fetch into `refs/polaris/review/<key>/`, a detached and
 * locked worktree with hooks off, guarded moves and removal, and the interdiff.
 * The engine drives it through `ReviewCheckoutGit` (`ReviewCheckoutGit.ts`).
 */
export { type Fetched, fetchPullRequest, pinCommits, type PullRequestFetch } from "./fetch.ts";

export { type Interdiff, interdiff, type InterdiffInput, markReviewed } from "./interdiff.ts";

export {
  HOOKS_OFF,
  LOCK_REASON_PREFIX,
  lockReasonFor,
  REVIEW_REF_PREFIX,
  reviewRef,
} from "./refs.ts";

export { parseRemoteUrl, pickFetchSource } from "./remotes.ts";

export {
  type CheckoutInspection,
  ensureCheckout,
  inspectCheckout,
  isReviewCheckoutWorktree,
  moveCheckout,
  removeCheckout,
} from "./worktree.ts";
