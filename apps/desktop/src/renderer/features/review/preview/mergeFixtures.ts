/**
 * Reviewers and merging on #88 in acme/atlas (`#review/merge-…`, `#review/reviewers…`):
 * made-up repositories and people only. Each scene is #88's actions as GitHub would say
 * them, and the popover it opens with.
 */
import type {
  MergeView,
  PullActionsView,
  ReviewersView,
  ReviewerView,
} from "../../../../shared/githubActions.ts";
import { QUEUE_DETAIL } from "./queueFixtures.ts";

const MERGE: MergeView = {
  pullId: "PR_88",
  number: 88,
  repo: "acme/atlas",
  host: "github.com",
  state: "open",
  headRefName: QUEUE_DETAIL.headRefName,
  headRefOid: QUEUE_DETAIL.headRefOid,
  baseRefName: QUEUE_DETAIL.baseRefName,
  viewerLogin: "you",
  viewerCanMerge: true,
  blocks: [],
  checks: { total: 6, failing: 0, pending: 0 },
  methods: ["merge", "squash", "rebase"],
  defaultMethod: "squash",
  autoMerge: { available: false, enabled: null },
  messages: {
    merge: {
      title: `Merge pull request #88 from mchen/${QUEUE_DETAIL.headRefName}`,
      body: QUEUE_DETAIL.title,
    },
    squash: {
      title: `${QUEUE_DETAIL.title} (#88)`,
      body: "* Add the annual income field\n* Validate it against the household size\n* Show it on the summary",
    },
  },
  branch: { name: QUEUE_DETAIL.headRefName, keep: null },
};

const SUGGESTED: ReadonlyArray<ReviewerView> = [
  { kind: "user", login: "ppatel", name: "Priya Patel" },
  { kind: "user", login: "okafor", name: "Ada Okafor" },
  { kind: "user", login: "jlund", name: "Jonas Lund" },
];

const REVIEWERS: ReviewersView = {
  requested: [
    { kind: "user", login: "ppatel", name: "Priya Patel" },
    { kind: "team", login: "eligibility", name: "Eligibility" },
  ],
  reviewed: [
    { login: "you", state: "approved", at: "2026-10-13T09:40:00Z" },
    { login: "rkim", state: "changes-requested", at: "2026-10-12T16:05:00Z" },
  ],
  suggested: SUGGESTED,
  canRequest: true,
  author: "mchen",
};

export const SEARCH_RESULTS: ReadonlyArray<ReviewerView> = [
  { kind: "user", login: "okafor", name: "Ada Okafor" },
  { kind: "team", login: "platform", name: "Platform" },
];

/** What each scene opens: the merge popover, the reviewers popover, or neither. */
export type MergeScene = {
  readonly view: PullActionsView;
  readonly open: "merge" | "reviewers" | null;
};

const scene = (
  merge: Partial<MergeView>,
  reviewers: Partial<ReviewersView>,
  open: MergeScene["open"]
): MergeScene => ({
  view: { merge: { ...MERGE, ...merge }, reviewers: { ...REVIEWERS, ...reviewers } },
  open,
});

const BLOCKED: Partial<MergeView> = {
  blocks: [{ kind: "checks-failing", count: 4 }, { kind: "approval-required" }],
  checks: { total: 9, failing: 4, pending: 0 },
};

export const MERGE_SCENES = new Map<string, MergeScene>([
  /** Approved by you, nothing blocks it: Merge leads the header. */
  ["merge-header", scene({}, {}, null)],
  ["merge-ready", scene({}, {}, "merge")],
  /** Not yours, not approved by you: Merge sits beside Submit review, which stays primary. */
  ["merge-blocked-header", scene(BLOCKED, { reviewed: [] }, null)],
  ["merge-blocked", scene(BLOCKED, { reviewed: [] }, "merge")],
  [
    "merge-auto",
    scene(
      {
        blocks: [{ kind: "checks-pending", count: 3 }],
        checks: { total: 6, failing: 0, pending: 3 },
        autoMerge: { available: true, enabled: null },
      },
      {},
      "merge"
    ),
  ],
  [
    "merge-auto-on",
    scene(
      {
        blocks: [{ kind: "checks-pending", count: 3 }],
        checks: { total: 6, failing: 0, pending: 3 },
        autoMerge: { available: false, enabled: { method: "squash", by: "you" } },
      },
      {},
      "merge"
    ),
  ],
  /** A protected head branch stays; only merge commits allowed. */
  [
    "merge-kept",
    scene(
      {
        methods: ["merge"],
        defaultMethod: "merge",
        branch: { name: "release/2026.10", keep: "protected" },
      },
      {},
      "merge"
    ),
  ],
  ["reviewers", scene({}, {}, "reviewers")],
  ["reviewers-empty", scene({}, { requested: [], reviewed: [] }, "reviewers")],
  ["reviewers-readonly", scene({ viewerCanMerge: false }, { canRequest: false }, "reviewers")],
]);
