/**
 * The fake's GraphQL for reviewer requests and merging: `PullActions` (merge state, branch,
 * reviewers), `ReviewerSearch`, and the merge and auto-merge mutations, refusing what
 * GitHub refuses (no write access, a method the repository disallows, a moved head, a
 * pull request that isn't mergeable).
 */
import { Schema } from "effect";
import type { JsonValue } from "./http.ts";
import { fail, inputOf, pullById, type Resolver, vars, type Variables } from "./graphql.ts";
import {
  branchExists,
  canWrite,
  checkCountsOf,
  completeMerge,
  headRepoOf,
  latestReviews,
  mergeStateOf,
  reviewDecisionOf,
  settingsOf,
} from "./merging.ts";
import { type FakePull, type FakeUser, type World, findRepo, permissionOf } from "./world.ts";

const contextsOf = (pull: FakePull) => {
  const { passing, failing, pending } = checkCountsOf(pull);

  const run = (status: string, conclusion: string | null) => ({
    __typename: "CheckRun",
    status,
    conclusion,
  });

  return [
    ...Array.from({ length: failing }, () => run("COMPLETED", "FAILURE")),
    ...Array.from({ length: pending }, () => run("IN_PROGRESS", null)),
    ...Array.from({ length: passing }, () => run("COMPLETED", "SUCCESS")),
  ];
};

const rollupOf = (pull: FakePull) => {
  const nodes = contextsOf(pull);
  const { failing, pending } = checkCountsOf(pull);

  if (nodes.length === 0) return null;

  return {
    state: failing > 0 ? "FAILURE" : pending > 0 ? "PENDING" : "SUCCESS",
    contexts: { totalCount: nodes.length, nodes },
  };
};

const nameOf = (world: World, login: string) =>
  world.users.find((u) => u.login === login)?.name ?? null;

const requestsOf = (world: World, pull: FakePull) => {
  const org = pull.repo.split("/")[0]?.toLowerCase() ?? "";
  const teams = world.teams.get(org) ?? [];

  return [
    ...pull.reviewRequests.map((login) => ({
      requestedReviewer: { __typename: "User", login, name: nameOf(world, login) },
    })),
    ...(pull.teamRequests ?? []).map((slug) => ({
      requestedReviewer: {
        __typename: "Team",
        slug,
        name: teams.find((t) => t.slug === slug)?.name ?? slug,
      },
    })),
  ];
};

/** Writers other than the author, as GitHub's suggestions (it reads blame; the fake can't). */
const suggestionsOf = (world: World, pull: FakePull) => {
  const [owner = "", name = ""] = pull.repo.split("/");
  const repo = findRepo(world, owner, name);

  return world.users
    .filter(
      (u) => u.login !== pull.author && repo !== undefined && canWrite(permissionOf(world, u, repo))
    )
    .map((u) => ({ reviewer: { login: u.login, name: u.name } }));
};

const autoMergeAllowedNow = (world: World, pull: FakePull, permission: string | null) =>
  settingsOf(world, pull.repo).autoMergeAllowed &&
  canWrite(permission) &&
  pull.state === "OPEN" &&
  (pull.autoMerge ?? null) === null &&
  mergeStateOf(world, pull).status !== "CLEAN";

const headRepositoryOf = (
  world: World,
  pull: FakePull,
  viewer: FakeUser,
  permission: string | null
) => {
  if (pull.isCrossRepository !== true)
    return {
      nameWithOwner: pull.repo,
      viewerPermission: permission,
      defaultBranchRef: { name: settingsOf(world, pull.repo).defaultBranch },
    };

  return {
    nameWithOwner: headRepoOf(pull),
    viewerPermission: pull.author === viewer.login ? "ADMIN" : null,
    defaultBranchRef: { name: "main" },
  };
};

const actionsPull = (world: World, pull: FakePull, viewer: FakeUser, permission: string | null) => {
  const state = mergeStateOf(world, pull);
  const title = `Merge pull request #${pull.number} from ${pull.headRefName}`;

  return {
    id: pull.id,
    number: pull.number,
    state: pull.state,
    isDraft: pull.isDraft,
    mergeable: state.mergeable,
    mergeStateStatus: state.status,
    reviewDecision: reviewDecisionOf(world, pull),
    headRefName: pull.headRefName,
    headRefOid: pull.headRefOid,
    baseRefName: pull.baseRefName,
    isCrossRepository: pull.isCrossRepository ?? false,
    author: { login: pull.author },
    headRepository: headRepositoryOf(world, pull, viewer, permission),
    headRef: branchExists(world, headRepoOf(pull), pull.headRefName)
      ? { name: pull.headRefName }
      : null,
    viewerCanEnableAutoMerge: autoMergeAllowedNow(world, pull, permission),
    autoMergeRequest:
      (pull.autoMerge ?? null) === null
        ? null
        : {
            mergeMethod: pull.autoMerge?.method ?? "MERGE",
            enabledBy: { login: pull.autoMerge?.by ?? "" },
          },
    mergeTitle: title,
    mergeBody: pull.title,
    squashTitle: `${pull.title} (#${pull.number})`,
    squashBody: `* ${pull.title}`,
    commits: { nodes: [{ commit: { statusCheckRollup: rollupOf(pull) } }] },
    reviewRequests: { nodes: requestsOf(world, pull) },
    latestReviews: {
      nodes: latestReviews(world, pull).map((r) => ({
        author: { login: r.author },
        state: r.state,
        submittedAt: r.submittedAt,
      })),
    },
    suggestedReviewers: suggestionsOf(world, pull),
  };
};

const OwnerNameNumber = Schema.Struct({
  owner: Schema.String,
  name: Schema.String,
  number: Schema.Number,
});

const pullActions: Resolver = (world, viewer, variables) => {
  const { owner, name, number } = vars(OwnerNameNumber, variables);
  const repo = findRepo(world, owner, name);
  const permission = repo === undefined ? null : permissionOf(world, viewer, repo);

  if (repo === undefined || permission === null)
    return fail("NOT_FOUND", `Could not resolve to a Repository with the name '${owner}/${name}'.`);

  const full = `${repo.owner}/${repo.name}`;
  const settings = settingsOf(world, full);

  const pull = world.pulls.find(
    (p) => p.repo.toLowerCase() === full.toLowerCase() && p.number === number
  );

  return {
    viewer: { login: viewer.login },
    repository: {
      nameWithOwner: full,
      viewerPermission: permission,
      viewerDefaultMergeMethod: settings.defaultMethod,
      mergeCommitAllowed: settings.mergeCommitAllowed,
      squashMergeAllowed: settings.squashMergeAllowed,
      rebaseMergeAllowed: settings.rebaseMergeAllowed,
      autoMergeAllowed: settings.autoMergeAllowed,
      deleteBranchOnMerge: settings.deleteBranchOnMerge,
      defaultBranchRef: { name: settings.defaultBranch },
      pullRequest: pull === undefined ? null : actionsPull(world, pull, viewer, permission),
    },
  };
};

const reviewerSearch: Resolver = (world, viewer, variables) => {
  const { owner, name, q } = vars(
    Schema.Struct({ owner: Schema.String, name: Schema.String, q: Schema.String }),
    variables
  );

  const repo = findRepo(world, owner, name);

  if (repo === undefined || permissionOf(world, viewer, repo) === null)
    return fail("NOT_FOUND", `Could not resolve to a Repository with the name '${owner}/${name}'.`);

  const matches = (...texts: ReadonlyArray<string | null>) =>
    texts.some((t) => t !== null && t.toLowerCase().includes(q.toLowerCase()));

  const org = world.orgs.some((o) => o.login.toLowerCase() === repo.owner.toLowerCase());

  const teams = (world.teams.get(repo.owner.toLowerCase()) ?? []).filter((t) =>
    matches(t.slug, t.name)
  );

  return {
    repository: {
      assignableUsers: {
        nodes: world.users
          .filter((u) => permissionOf(world, u, repo) !== null && matches(u.login, u.name))
          .map((u) => ({ login: u.login, name: u.name })),
      },
      owner: org
        ? {
            __typename: "Organization",
            teams: { nodes: teams.map((t) => ({ slug: t.slug, name: t.name })) },
          }
        : { __typename: "User" },
    },
  };
};

const MergeArgs = Schema.Struct({
  pullRequestId: Schema.String,
  mergeMethod: Schema.optionalKey(Schema.Literals(["MERGE", "SQUASH", "REBASE"])),
  commitHeadline: Schema.optionalKey(Schema.NullOr(Schema.String)),
  commitBody: Schema.optionalKey(Schema.NullOr(Schema.String)),
  expectedHeadOid: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

const ALLOWED = {
  MERGE: "mergeCommitAllowed",
  SQUASH: "squashMergeAllowed",
  REBASE: "rebaseMergeAllowed",
} as const;

/** The pull request a merge mutation names, checked as GitHub checks it. */
const mergeTarget = (world: World, viewer: FakeUser, variables: Variables) => {
  const args = inputOf(MergeArgs, variables);
  const pull = pullById(world, viewer, args.pullRequestId);
  const [owner = "", name = ""] = pull.repo.split("/");
  const repo = findRepo(world, owner, name);
  const method = args.mergeMethod ?? "MERGE";

  if (repo === undefined || !canWrite(permissionOf(world, viewer, repo)))
    return fail(
      "FORBIDDEN",
      `${viewer.login} does not have the correct permissions to execute \`MergePullRequest\``
    );

  if (pull.state !== "OPEN") return fail("UNPROCESSABLE", "Pull request is not open");

  if (!settingsOf(world, pull.repo)[ALLOWED[method]])
    return fail(
      "UNPROCESSABLE",
      `${method.toLowerCase()} merges are not allowed on this repository`
    );

  if (args.expectedHeadOid != null && args.expectedHeadOid !== pull.headRefOid)
    return fail("UNPROCESSABLE", "Head branch was modified. Review and try the merge again.");

  return { args, pull, method };
};

const mergePullRequest: Resolver = (world, viewer, variables): JsonValue => {
  const { args, pull, method } = mergeTarget(world, viewer, variables);
  const { status } = mergeStateOf(world, pull);

  if (!["CLEAN", "UNSTABLE", "HAS_HOOKS"].includes(status))
    return fail("UNPROCESSABLE", "Pull request is not mergeable");
  completeMerge(world, pull, {
    method,
    title: args.commitHeadline ?? null,
    body: args.commitBody ?? null,
    by: viewer.login,
  });

  return {
    mergePullRequest: { pullRequest: { id: pull.id, state: pull.state, mergedAt: pull.mergedAt } },
  };
};

const enableAutoMerge: Resolver = (world, viewer, variables) => {
  const { pull, method } = mergeTarget(world, viewer, variables);

  if (!settingsOf(world, pull.repo).autoMergeAllowed)
    return fail("UNPROCESSABLE", "Auto merge is not allowed for this repository");

  if (mergeStateOf(world, pull).status === "CLEAN")
    return fail("UNPROCESSABLE", "Pull request is in clean status");
  pull.autoMerge = { method, by: viewer.login };

  return { enablePullRequestAutoMerge: { pullRequest: { id: pull.id } } };
};

const disableAutoMerge: Resolver = (world, viewer, variables) => {
  const { pullRequestId } = inputOf(Schema.Struct({ pullRequestId: Schema.String }), variables);
  const pull = pullById(world, viewer, pullRequestId);

  pull.autoMerge = null;

  return { disablePullRequestAutoMerge: { pullRequest: { id: pull.id } } };
};

export const MERGE_OPERATIONS = new Map<string, Resolver>([
  ["PullActions", pullActions],
  ["ReviewerSearch", reviewerSearch],
  ["MergePullRequest", mergePullRequest],
  ["EnablePullRequestAutoMerge", enableAutoMerge],
  ["DisablePullRequestAutoMerge", disableAutoMerge],
]);
