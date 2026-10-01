/** Settings → Sessions' defaults, shared by main (the settings file) and the renderer. */
import type { SessionPrefs } from "./api.ts";

/** A branch prefix git accepts: empty, or no spaces, `..`, `~^:?*[\\` or `@{`, not starting with "-" or "/". */
export const BRANCH_PREFIX = /^(?![-/])(?!.*\.\.)(?!.*@\{)[^\s~^:?*[\\]{0,64}$/;

export const isBranchPrefix = (prefix: string) => BRANCH_PREFIX.test(prefix);

export const DEFAULT_SESSION_PREFS: SessionPrefs = {
  newWorktree: false,
  branchPrefix: "polaris/",
  openOutputOnEdit: true,
  notifyNeedsYou: true,
  notifyReviewRequests: true,
  deleteMergedBranch: false,
  spinnerVerbs: null,
  acceptBranch: "auto",
  workspaceAcceptBranch: {},
};
