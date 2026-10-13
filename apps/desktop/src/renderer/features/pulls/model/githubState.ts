/**
 * Where GitHub stands for Review's list, and what the page shows for it. Agent Sessions
 * never wait on GitHub: a missing sign-in or an unreachable GitHub is a notice above them.
 */
import type {
  GitHubAccountsView,
  GitHubAccountView,
  PullListView,
} from "../../../../shared/github.ts";

/** What GitHub's state needs of the accounts view. */
export interface AccountsFacts {
  readonly accounts: ReadonlyArray<Pick<GitHubAccountView, "state">>;
  readonly storageAvailable: GitHubAccountsView["storageAvailable"];
}

export type GitHubState = "loading" | "no-keychain" | "signed-out" | "unreachable" | "ok";

export const githubStateOf = (
  accounts: AccountsFacts | null,
  list: PullListView | null
): GitHubState => {
  if (accounts === null) return "loading";

  const signedIn = accounts.accounts.some((a) => a.state === "ok");

  if (!signedIn) return accounts.storageAvailable ? "signed-out" : "no-keychain";

  if (list?.error != null && list.updatedAt === null) return "unreachable";

  return list === null || list.updatedAt === null ? "loading" : "ok";
};

/** Nothing to list yet: the pane that stands in for the groups. */
export type EmptyKind = "signed-out" | "no-keychain" | "none" | "loading";

/** The pane in place of the groups, or null when there are rows (or a notice says it all). */
export const emptyOf = (state: GitHubState, rows: number): EmptyKind | null => {
  if (rows > 0) return null;

  if (state === "ok") return "none";

  // The failed poll's notice already says why nothing is listed.
  return state === "unreachable" ? null : state;
};

/** The notice above rows that GitHub isn't part of. */
export const githubNoticeOf = (state: GitHubState, rows: number) =>
  rows > 0 && (state === "signed-out" || state === "no-keychain") ? state : null;

/** The header's caption: none while GitHub can't be asked or hasn't answered. */
export const showsCaption = (state: GitHubState) => state === "ok" || state === "loading";

/** Review's list before GitHub has answered (or with nobody signed in): no pull requests. */
export const EMPTY_LIST: PullListView = {
  requested: [],
  mine: [],
  other: [],
  repos: [],
  updatedAt: null,
  polling: "idle",
  throttledUntil: null,
  error: null,
  errorKind: null,
};
