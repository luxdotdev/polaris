/** GitHub views as main sends them, for renderer tests. */
import type {
  PullDetailView,
  PullListView,
  PullRowView,
  RepoAccessView,
} from "../../shared/github.ts";

/** A row of `acme/atlas#7` in the PR list; `patch` sets what a test needs. */
export const pullRow = (patch: Partial<PullRowView> = {}): PullRowView => ({
  id: "PR_7",
  number: 7,
  title: "Serve on one port",
  url: "",
  repo: "acme/atlas",
  isDraft: false,
  author: null,
  headRefName: "serve",
  headRefOid: "head1",
  baseRefName: "main",
  additions: 1,
  deletions: 0,
  updatedAt: "2026-10-01T00:00:00.000Z",
  reviewDecision: null,
  viewerLatestReview: null,
  requestedReviewers: [],
  accountId: 1,
  workspaces: [],
  ...patch,
});

/** The PR list with `requested` rows and repository access, idle and without errors. */
export const pullList = (
  requested: ReadonlyArray<PullRowView>,
  repos: ReadonlyArray<RepoAccessView> = []
): PullListView => ({
  requested,
  mine: [],
  other: [],
  repos,
  updatedAt: null,
  polling: "idle",
  throttledUntil: null,
  error: null,
  errorKind: null,
});

/** An open pull request `acme/atlas#7` with nothing on it; `patch` sets what a test needs. */
export const pullDetail = (patch: Partial<PullDetailView> = {}): PullDetailView => ({
  id: "PR_7",
  number: 7,
  title: "Serve on one port",
  body: "",
  url: "",
  repo: "acme/atlas",
  state: "open",
  isDraft: false,
  author: { login: "mchen", avatarUrl: "" },
  viewerLogin: "mona",
  viewerCanApprove: true,
  headRefName: "serve",
  headRefOid: "head1",
  baseRefName: "main",
  baseRefOid: "base1",
  commits: 1,
  files: [],
  threads: [],
  pendingReview: null,
  accountId: 1,
  ...patch,
});
