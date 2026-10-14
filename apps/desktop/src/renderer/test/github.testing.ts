/** GitHub views as main sends them, for renderer tests. */
import type { PullDetailView } from "../../shared/github.ts";

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
