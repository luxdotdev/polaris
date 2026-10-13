/**
 * Review's queue with a Reviewed group (`#review/queue-reviewed`, `#review/queue-done`):
 * made-up repositories only. #88 is open; #91 came back after three new commits; three
 * pull requests sit in Reviewed.
 */
import { ReviewCheckout, type ReviewSubject } from "@polaris/protocol";
import { Data } from "effect";
import type { OpenPull } from "../../../../shared/api.ts";
import type {
  CompareView,
  PullDetailView,
  PullListView,
  PullRowView,
} from "../../../../shared/github.ts";
import { CHECKOUT, PULL_DETAIL } from "./fixtures.ts";

const Subjects = Data.taggedEnum<ReviewSubject>();

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const REVIEWED_ON = "7b3e91c04d2a";

const pull = (
  number: number,
  title: string,
  repo: string,
  by: string,
  minutes: number,
  patch: Partial<PullRowView> = {}
): PullRowView => ({
  id: `PR_${number}`,
  number,
  title,
  url: `https://github.com/${repo}/pull/${number}`,
  repo,
  host: "github.com",
  isDraft: false,
  author: { login: by, avatarUrl: "" },
  headRefName: `${by}/branch`,
  headRefOid: "4f2c1a9e3b7d",
  baseRefName: "main",
  additions: 12,
  deletions: 3,
  updatedAt: ago(minutes),
  reviewDecision: "review-required",
  viewerLatestReview: null,
  viewerReview: null,
  viewerRequested: true,
  requestedReviewers: ["you"],
  accountId: 1,
  workspaces: [],
  ...patch,
});

/** GitHub's record of the viewer's review at `oid`, `minutes` ago; no longer asked by name. */
const reviewed = (oid: string, minutes: number): Partial<PullRowView> => ({
  viewerLatestReview: "APPROVED",
  viewerReview: { at: ago(minutes), commitOid: oid },
  viewerRequested: false,
});

export const QUEUE_PULL: OpenPull = {
  repo: { host: "github.com", owner: "acme", name: "atlas" },
  number: 88,
  pullId: "PR_88",
};

export const QUEUE_DETAIL: PullDetailView = {
  ...PULL_DETAIL,
  url: "https://github.com/acme/atlas/pull/88",
  repo: "acme/atlas",
  host: "github.com",
  viewerLogin: "you",
};

export const QUEUE_CHECKOUT = new ReviewCheckout({
  id: CHECKOUT.id,
  workspaceId: CHECKOUT.workspaceId,
  state: CHECKOUT.state,
  blocked: CHECKOUT.blocked,
  head: CHECKOUT.head,
  mergeBase: CHECKOUT.mergeBase,
  latestHead: CHECKOUT.latestHead,
  latestBase: CHECKOUT.latestBase,
  reviewedHead: CHECKOUT.reviewedHead,
  reviewedMergeBase: CHECKOUT.reviewedMergeBase,
  openedAt: CHECKOUT.openedAt,
  updatedAt: CHECKOUT.updatedAt,
  subject: Subjects.PullRequest({
    pullRequest: { repo: { host: "github.com", owner: "acme", name: "atlas" }, number: 88 },
    baseRef: "nightly",
  }),
  path: "/Users/you/code/atlas.worktrees/.review/pr-88",
});

export const QUEUE_LIST: PullListView = {
  requested: [
    pull(88, "Eligibility: annual income field", "acme/atlas", "mchen", 12),
    pull(84, "Retry webhook deliveries with backoff", "acme/harbor", "ppatel", 95),
  ],
  mine: [pull(90, "Cache the tariff tables", "acme/atlas", "you", 30, { viewerRequested: false })],
  other: [
    // Reviewed at REVIEWED_ON; three commits landed since.
    pull(91, "Split the billing worker", "acme/harbor", "jnakamura", 8, {
      ...reviewed(REVIEWED_ON, 240),
      headRefOid: "c51d02e8aa41",
    }),
    pull(77, "Docs: deploy checklist", "acme/atlas", "ppatel", 400, { viewerRequested: false }),
  ],
  reviewed: [
    pull(
      86,
      "Typed event names for analytics",
      "acme/atlas",
      "mchen",
      60,
      reviewed("4f2c1a9e3b7d", 50)
    ),
    pull(
      83,
      "Move fixtures under testdata",
      "acme/harbor",
      "ppatel",
      300,
      reviewed("4f2c1a9e3b7d", 290)
    ),
    pull(
      79,
      "Drop the legacy CSV export",
      "acme/atlas",
      "jnakamura",
      900,
      reviewed("4f2c1a9e3b7d", 880)
    ),
  ],
  repos: [],
  updatedAt: Date.now() - 60_000,
  polling: "focused",
  throttledUntil: null,
  error: null,
  errorKind: null,
};

/** Just after #88's review: the last request, now in Reviewed. */
export const QUEUE_DONE_LIST: PullListView = {
  ...QUEUE_LIST,
  requested: [],
  other: QUEUE_LIST.other.filter((r) => r.number !== 91),
  reviewed: [
    pull(
      88,
      "Eligibility: annual income field",
      "acme/atlas",
      "mchen",
      1,
      reviewed("4f2c1a9e3b7d", 0)
    ),
    ...(QUEUE_LIST.reviewed ?? []),
  ],
};

/** #91's three commits since the review, for its "3 new commits". */
export const QUEUE_COMPARE: CompareView = {
  status: "ahead",
  total: 3,
  commits: [
    { oid: "c51d02e8aa41", headline: "Drain the queue on shutdown", date: ago(8) },
    { oid: "a8e4c2d1f093", headline: "Name the worker pools", date: ago(30) },
    { oid: "5d7f1b3c9e20", headline: "Split invoices from payouts", date: ago(60) },
  ],
};
