/**
 * `PullActions`' answer turned into what Review shows: why a merge is blocked, the methods
 * the repository allows, whether the head branch may go afterwards, and who reviews. Pure.
 */
import {
  type BranchKeep,
  type CheckCounts,
  MERGE_METHODS,
  type MergeBlock,
  type MergeMethod,
  type MergeView,
  type ReviewedByView,
  type ReviewersView,
  type ReviewerView,
  type ReviewState,
} from "../../shared/githubActions.ts";
import type { ActionsPull, ActionsRepo, CheckContext } from "./actionQueries.ts";

/** Permissions that may merge, and the ones that may also ask for reviews. */
const WRITE: ReadonlySet<string> = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

const TRIAGE: ReadonlySet<string> = new Set([...WRITE, "TRIAGE"]);

export const canWrite = (permission: string | null | undefined) =>
  permission !== null && permission !== undefined && WRITE.has(permission);

const FAILED_RUNS: ReadonlySet<string> = new Set([
  "FAILURE",
  "TIMED_OUT",
  "CANCELLED",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
]);

const contextFails = (c: CheckContext) =>
  c.__typename === "CheckRun"
    ? FAILED_RUNS.has(c.conclusion ?? "")
    : c.state === "FAILURE" || c.state === "ERROR";

const contextPending = (c: CheckContext) =>
  c.__typename === "CheckRun"
    ? c.status !== "COMPLETED"
    : c.state === "PENDING" || c.state === "EXPECTED";

export const checkCounts = (pull: ActionsPull): CheckCounts => {
  const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup ?? null;

  if (rollup === null) return { total: 0, failing: 0, pending: 0 };
  const nodes = rollup.contexts.nodes;

  return {
    total: rollup.contexts.totalCount,
    failing: nodes.filter(contextFails).length,
    pending: nodes.filter(contextPending).length,
  };
};

/** What GitHub's BLOCKED means here: reviews, checks, or a rule Polaris can't name. */
const blockedBy = (pull: ActionsPull, checks: CheckCounts): ReadonlyArray<MergeBlock> => {
  const found: Array<MergeBlock> = [];

  if (pull.reviewDecision === "CHANGES_REQUESTED") found.push({ kind: "changes-requested" });
  else if (pull.reviewDecision === "REVIEW_REQUIRED") found.push({ kind: "approval-required" });

  if (checks.failing > 0) found.push({ kind: "checks-failing", count: checks.failing });
  else if (checks.pending > 0) found.push({ kind: "checks-pending", count: checks.pending });

  return found.length === 0 ? [{ kind: "blocked" }] : found;
};

const statusBlocks = (pull: ActionsPull, checks: CheckCounts): ReadonlyArray<MergeBlock> => {
  switch (pull.mergeStateStatus) {
    case "BLOCKED":
      return blockedBy(pull, checks);
    case "BEHIND":
      return [{ kind: "behind", base: pull.baseRefName }];
    case "UNKNOWN":
      return pull.mergeable === "UNKNOWN" ? [{ kind: "checking" }] : [];
    default:
      return [];
  }
};

/** Why GitHub won't merge it now, most pressing first; empty when it would. */
export const mergeBlocks = (pull: ActionsPull, checks: CheckCounts): ReadonlyArray<MergeBlock> => {
  if (pull.state === "MERGED") return [{ kind: "merged" }];

  if (pull.state === "CLOSED") return [{ kind: "closed" }];
  const blocks: Array<MergeBlock> = [];

  if (pull.isDraft) blocks.push({ kind: "draft" });

  const conflicts = pull.mergeable === "CONFLICTING" || pull.mergeStateStatus === "DIRTY";

  if (conflicts) blocks.push({ kind: "conflicts" });

  if (pull.isDraft || conflicts) return blocks;

  return statusBlocks(pull, checks);
};

const ALLOWED: Readonly<Record<MergeMethod, (repo: ActionsRepo) => boolean>> = {
  merge: (repo) => repo.mergeCommitAllowed,
  squash: (repo) => repo.squashMergeAllowed,
  rebase: (repo) => repo.rebaseMergeAllowed,
};

export const allowedMethods = (repo: ActionsRepo): ReadonlyArray<MergeMethod> =>
  MERGE_METHODS.filter((m) => ALLOWED[m](repo));

export const methodOf = (value: string): MergeMethod | null =>
  MERGE_METHODS.find((m) => m === value.toLowerCase()) ?? null;

const defaultMethodOf = (repo: ActionsRepo, methods: ReadonlyArray<MergeMethod>): MergeMethod => {
  const preferred = methodOf(repo.viewerDefaultMergeMethod);

  return preferred !== null && methods.includes(preferred) ? preferred : (methods[0] ?? "merge");
};

/**
 * Why the head branch stays after a merge, before asking GitHub about its protection
 * (`protectedBranch`: GitHub's answer, null when unasked or unknown).
 */
export const branchKeep = (
  repo: ActionsRepo,
  pull: ActionsPull,
  protectedBranch: boolean | null
): BranchKeep | null => {
  const head = pull.headRepository;

  if (pull.headRef === null || head === null) return "gone";

  const defaults = [repo.defaultBranchRef?.name, head.defaultBranchRef?.name];

  if (defaults.includes(pull.headRefName)) return "default";

  if (pull.isCrossRepository && !canWrite(head.viewerPermission)) return "fork";

  if (protectedBranch === true) return "protected";

  return repo.deleteBranchOnMerge && !pull.isCrossRepository ? "auto" : null;
};

/** Whether GitHub must be asked if the head branch is protected: nothing else keeps it. */
export const needsProtectionCheck = (repo: ActionsRepo, pull: ActionsPull) =>
  branchKeep(repo, pull, null) === null;

const PULL_STATES = new Map<string, MergeView["state"]>([
  ["OPEN", "open"],
  ["CLOSED", "closed"],
  ["MERGED", "merged"],
]);

export const mergeView = (
  viewer: string,
  repo: ActionsRepo,
  pull: ActionsPull,
  host: string,
  protectedBranch: boolean | null
): MergeView => {
  const checks = checkCounts(pull);
  const methods = allowedMethods(repo);
  const auto = pull.autoMergeRequest;
  const open = pull.state === "OPEN";

  return {
    pullId: pull.id,
    number: pull.number,
    repo: repo.nameWithOwner,
    host,
    state: PULL_STATES.get(pull.state) ?? "open",
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    baseRefName: pull.baseRefName,
    viewerLogin: viewer,
    viewerCanMerge: canWrite(repo.viewerPermission),
    blocks: mergeBlocks(pull, checks),
    checks,
    methods,
    defaultMethod: defaultMethodOf(repo, methods),
    autoMerge: {
      available: open && repo.autoMergeAllowed && pull.viewerCanEnableAutoMerge && auto === null,
      enabled:
        auto === null
          ? null
          : { method: methodOf(auto.mergeMethod) ?? "merge", by: auto.enabledBy?.login ?? null },
    },
    messages: {
      merge: { title: pull.mergeTitle, body: pull.mergeBody },
      squash: { title: pull.squashTitle, body: pull.squashBody },
    },
    branch: { name: pull.headRefName, keep: branchKeep(repo, pull, protectedBranch) },
  };
};

const STATES = new Map<string, ReviewState>([
  ["APPROVED", "approved"],
  ["CHANGES_REQUESTED", "changes-requested"],
  ["COMMENTED", "commented"],
  ["DISMISSED", "dismissed"],
  ["PENDING", "pending"],
]);

const requestedOf = (pull: ActionsPull): ReadonlyArray<ReviewerView> =>
  pull.reviewRequests.nodes.flatMap(({ requestedReviewer: r }): ReadonlyArray<ReviewerView> => {
    if (r === null) return [];

    if (r.__typename === "Team" && r.slug !== undefined)
      return [{ kind: "team", login: r.slug, name: r.name ?? null }];

    return r.login === undefined ? [] : [{ kind: "user", login: r.login, name: r.name ?? null }];
  });

const reviewedOf = (pull: ActionsPull): ReadonlyArray<ReviewedByView> =>
  pull.latestReviews.nodes
    .flatMap((r) =>
      r.author === null || r.state === "PENDING"
        ? []
        : [{ login: r.author.login, state: STATES.get(r.state) ?? "commented", at: r.submittedAt }]
    )
    .toSorted((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

export const reviewersView = (repo: ActionsRepo, pull: ActionsPull): ReviewersView => {
  const requested = requestedOf(pull);
  const asked = new Set(requested.map((r) => r.login.toLowerCase()));
  const author = pull.author?.login ?? null;

  return {
    requested,
    reviewed: reviewedOf(pull),
    suggested: pull.suggestedReviewers
      .map(({ reviewer }) => ({
        kind: "user" as const,
        login: reviewer.login,
        name: reviewer.name,
      }))
      .filter((r) => !asked.has(r.login.toLowerCase()) && r.login !== author),
    canRequest: repo.viewerPermission !== null && TRIAGE.has(repo.viewerPermission),
    author,
  };
};
