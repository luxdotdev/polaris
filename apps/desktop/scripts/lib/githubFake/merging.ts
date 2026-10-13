/**
 * The fake's merge world: each repository's merge settings and branch rules (all methods
 * allowed, `main` the default, nothing protected until a test says so), its branches (a
 * pull request's head and base exist until deleted), review approvals, and GitHub's
 * `mergeable` / `mergeStateStatus` worked out from them. Also the REST it answers:
 * requested reviewers, branches and refs.
 */
import { Schema } from "effect";
import { type FakeRequest, type FakeResponse, json, notFound } from "./http.ts";
import {
  type FakePull,
  type FakeRepo,
  type FakeRepoSettings,
  type FakeUser,
  type World,
  findRepo,
  permissionOf,
  repoName,
} from "./world.ts";

const WRITE = new Set(["ADMIN", "MAINTAIN", "WRITE"]);

const TRIAGE = new Set([...WRITE, "TRIAGE"]);

export const canWrite = (permission: string | null) => permission !== null && WRITE.has(permission);

const key = (repo: string) => repo.toLowerCase();

export const settingsOf = (world: World, repo: string): FakeRepoSettings => {
  const found = world.settings.get(key(repo));

  if (found !== undefined) return found;

  const made: FakeRepoSettings = {
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: true,
    autoMergeAllowed: false,
    deleteBranchOnMerge: false,
    defaultBranch: "main",
    defaultMethod: "MERGE",
    protection: {},
  };

  world.settings.set(key(repo), made);

  return made;
};

/** Where a pull request's head lives: its repository, or the author's fork. */
export const headRepoOf = (pull: FakePull) =>
  pull.isCrossRepository === true ? `${pull.author}/${pull.repo.split("/")[1] ?? ""}` : pull.repo;

/** A branch exists if a pull request names it (or it is the default) and nobody deleted it. */
export const branchExists = (world: World, repo: string, branch: string) => {
  if (world.deletedBranches.has(`${key(repo)}:${branch}`)) return false;

  if (settingsOf(world, repo).defaultBranch === branch) return true;

  return world.pulls.some(
    (p) =>
      (key(headRepoOf(p)) === key(repo) && p.headRefName === branch) ||
      (key(p.repo) === key(repo) && p.baseRefName === branch)
  );
};

export const deleteBranch = (world: World, repo: string, branch: string) =>
  world.deletedBranches.add(`${key(repo)}:${branch}`);

/** Each reviewer's latest submitted review of `pull`. */
export const latestReviews = (world: World, pull: FakePull) => {
  const latest = new Map<string, (typeof world.reviews)[number]>();

  for (const review of world.reviews)
    if (review.pullId === pull.id && review.state !== "PENDING") latest.set(review.author, review);

  return [...latest.values()];
};

const decisionOf = (world: World, pull: FakePull) => {
  const latest = latestReviews(world, pull).filter((r) => r.author !== pull.author);
  const approvals = latest.filter((r) => r.state === "APPROVED").length;

  return {
    // The fixture's decision stands in for reviews it doesn't list.
    approvals: approvals === 0 && pull.reviewDecision === "APPROVED" ? 1 : approvals,
    changesRequested: latest.some((r) => r.state === "CHANGES_REQUESTED"),
  };
};

/** The head's checks: `setChecks`' counts, else the fixture's rollup, all one state. */
export const checkCountsOf = (pull: FakePull) => {
  if (pull.checkCounts !== undefined) return pull.checkCounts;
  const { state = "SUCCESS", total = 0 } = pull.checks ?? {};

  return {
    passing: state === "SUCCESS" ? total : 0,
    failing: state === "FAILURE" || state === "ERROR" ? total : 0,
    pending: state === "PENDING" ? total : 0,
  };
};

/** GitHub's review decision under the base branch's rule (the stored one without a rule). */
export const reviewDecisionOf = (world: World, pull: FakePull) => {
  const rule = settingsOf(world, pull.repo).protection[pull.baseRefName];

  if (rule === undefined || rule.requiredApprovals === 0) return pull.reviewDecision;
  const { approvals, changesRequested } = decisionOf(world, pull);

  if (changesRequested) return "CHANGES_REQUESTED";

  return approvals >= rule.requiredApprovals ? "APPROVED" : "REVIEW_REQUIRED";
};

const ruleBlocks = (world: World, pull: FakePull) => {
  const rule = settingsOf(world, pull.repo).protection[pull.baseRefName];

  if (rule === undefined) return false;
  const { approvals, changesRequested } = decisionOf(world, pull);
  const checks = checkCountsOf(pull);

  const reviews =
    rule.requiredApprovals > 0 && (changesRequested || approvals < rule.requiredApprovals);

  return reviews || (rule.requiredChecks && checks.failing + checks.pending > 0);
};

/** `mergeable` and `mergeStateStatus` as GitHub would say them now. */
export const mergeStateOf = (world: World, pull: FakePull) => {
  const mergeable = pull.conflicting === true ? "CONFLICTING" : "MERGEABLE";
  const checks = checkCountsOf(pull);

  if (pull.isDraft) return { mergeable, status: "DRAFT" };

  if (pull.conflicting === true) return { mergeable, status: "DIRTY" };

  if (ruleBlocks(world, pull)) return { mergeable, status: "BLOCKED" };

  return { mergeable, status: checks.failing + checks.pending > 0 ? "UNSTABLE" : "CLEAN" };
};

/** Merges it as `by`: closed, its branch gone when the repository says so. */
export const completeMerge = (
  world: World,
  pull: FakePull,
  merged: NonNullable<FakePull["mergedWith"]>
) => {
  const at = new Date().toISOString();

  pull.state = "MERGED";
  pull.mergedAt = at;
  pull.closedAt = at;
  pull.updatedAt = at;
  pull.autoMerge = null;
  pull.mergedWith = merged;

  if (settingsOf(world, pull.repo).deleteBranchOnMerge && pull.isCrossRepository !== true)
    deleteBranch(world, pull.repo, pull.headRefName);
};

// ── REST ────────────────────────────────────────────────────────────────────

const Reviewers = Schema.Struct({
  reviewers: Schema.optionalKey(Schema.Array(Schema.String)),
  team_reviewers: Schema.optionalKey(Schema.Array(Schema.String)),
});

const NewRef = Schema.Struct({ ref: Schema.String, sha: Schema.String });

const decode = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  body: string
) => Schema.decodeUnknownSync(Schema.fromJsonString(schema))(body === "" ? "{}" : body);

const unprocessable = (message: string) => json(422, { message });

interface RestContext {
  readonly world: World;
  readonly user: FakeUser;
  readonly request: FakeRequest;
}

/** A known repository the user can see, with their permission. */
const visible = ({ world, user }: RestContext, owner: string, name: string) => {
  const repo = findRepo(world, owner, name);
  const permission = repo === undefined ? null : permissionOf(world, user, repo);

  return repo === undefined || permission === null ? null : { repo, permission };
};

const unknownReviewer = (
  world: World,
  repo: FakeRepo,
  pull: FakePull,
  users: ReadonlyArray<string>,
  teams: ReadonlyArray<string>
) => {
  const collaborator = (login: string) => {
    const user = world.users.find((u) => u.login.toLowerCase() === login.toLowerCase());

    return user !== undefined && permissionOf(world, user, repo) !== null;
  };

  const orgTeams = world.teams.get(repo.owner.toLowerCase()) ?? [];

  if (users.some((u) => u === pull.author))
    return "Review cannot be requested from pull request author.";

  return users.every(collaborator) && teams.every((t) => orgTeams.some((o) => o.slug === t))
    ? null
    : `Reviews may only be requested from collaborators. One or more of the users or teams you specified is not a collaborator of the ${repoName(repo)} repository.`;
};

const requestedReviewers = (context: RestContext, match: RegExpExecArray) => {
  const [, owner = "", name = "", number = ""] = match;
  const found = visible(context, owner, name);

  const pull = context.world.pulls.find(
    (p) => key(p.repo) === key(`${owner}/${name}`) && p.number === Number(number)
  );

  if (found === null || pull === undefined) return notFound();

  if (!TRIAGE.has(found.permission))
    return json(403, { message: "Must have triage access to request reviews." });
  const { reviewers = [], team_reviewers: teams = [] } = decode(Reviewers, context.request.body);

  if (context.request.method === "DELETE") {
    pull.reviewRequests = pull.reviewRequests.filter((login) => !reviewers.includes(login));
    pull.teamRequests = (pull.teamRequests ?? []).filter((slug) => !teams.includes(slug));

    return json(200, { number: pull.number });
  }

  const problem = unknownReviewer(context.world, found.repo, pull, reviewers, teams);

  if (problem !== null) return unprocessable(problem);
  pull.reviewRequests = [...new Set([...pull.reviewRequests, ...reviewers])];
  pull.teamRequests = [...new Set([...(pull.teamRequests ?? []), ...teams])];

  return json(201, { number: pull.number });
};

const branch = (context: RestContext, match: RegExpExecArray) => {
  const [, owner = "", name = "", raw = ""] = match;
  const repo = `${owner}/${name}`;
  const branchName = decodeURIComponent(raw);

  if (visible(context, owner, name) === null || !branchExists(context.world, repo, branchName))
    return notFound();

  const rule = settingsOf(context.world, repo).protection[branchName];

  return json(200, { name: branchName, protected: rule !== undefined });
};

const deleteRef = (context: RestContext, match: RegExpExecArray) => {
  const [, owner = "", name = "", raw = ""] = match;
  const repo = `${owner}/${name}`;
  const found = visible(context, owner, name);
  const branchName = raw.split("/").map(decodeURIComponent).join("/");
  const settings = settingsOf(context.world, repo);

  if (found === null) return notFound();

  if (!canWrite(found.permission))
    return json(403, { message: "Resource not accessible by integration" });

  if (!branchExists(context.world, repo, branchName))
    return unprocessable("Reference does not exist");

  if (settings.protection[branchName] !== undefined || settings.defaultBranch === branchName)
    return unprocessable("Cannot delete protected branch");
  deleteBranch(context.world, repo, branchName);

  return { status: 204, headers: {}, body: "" };
};

const createRef = (context: RestContext, match: RegExpExecArray) => {
  const [, owner = "", name = ""] = match;
  const repo = `${owner}/${name}`;
  const found = visible(context, owner, name);
  const { ref, sha } = decode(NewRef, context.request.body);
  const branchName = ref.replace(/^refs\/heads\//, "");

  if (found === null) return notFound();

  if (!canWrite(found.permission))
    return json(403, { message: "Resource not accessible by integration" });

  if (!context.world.deletedBranches.delete(`${key(repo)}:${branchName}`))
    return unprocessable("Reference already exists");

  return json(201, { ref, object: { sha } });
};

const ROUTES: ReadonlyArray<
  readonly [string, RegExp, (c: RestContext, m: RegExpExecArray) => FakeResponse]
> = [
  ["POST", /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/requested_reviewers$/, requestedReviewers],
  ["DELETE", /^\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)\/requested_reviewers$/, requestedReviewers],
  ["GET", /^\/repos\/([^/]+)\/([^/]+)\/branches\/(.+)$/, branch],
  ["DELETE", /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/, deleteRef],
  ["POST", /^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/, createRef],
];

/** Null when the path isn't one of these. */
export const mergingRest = (context: RestContext): FakeResponse | null => {
  for (const [method, pattern, route] of ROUTES) {
    const match = pattern.exec(context.request.path);

    if (match !== null && context.request.method === method) return route(context, match);
  }

  return null;
};
