/**
 * The GitHub client's views as the renderer sees them, plus the pure helpers it
 * may call directly (remote and pull request URL parsing). No Effect code here:
 * the renderer imports this file at runtime.
 */

/** The Polaris OAuth App (ENG-226). Public: the device flow needs no secret. */
export const GITHUB_CLIENT_ID = "Ov23lix8h2ldBZFwXqek";

/** Asked for at every sign-in (ENG-219): `repo` reaches private repos, `read:org` team requests. */
export const GITHUB_SCOPES: ReadonlyArray<string> = ["repo", "read:org"];

/** github.com: built in, with Polaris's own OAuth App. */
export const GITHUB_HOST = "github.com";

/** A repository by owner and name, as `nameWithOwner` spells it. */
export interface RepoRef {
  /** A GitHub Enterprise host (`ghe.acme.com`); absent for github.com. */
  readonly host?: string;
  readonly owner: string;
  readonly name: string;
}

export const hostOf = (repo: RepoRef) => repo.host ?? GITHUB_HOST;

/** A list row's repository (`owner/name` and its host) as a `RepoRef`; github.com stays implicit. */
export const repoOfRow = (row: { readonly repo: string; readonly host?: string }): RepoRef => {
  const [owner = "", name = ""] = row.repo.split("/");

  return row.host === undefined || row.host === GITHUB_HOST
    ? { owner, name }
    : { host: row.host, owner, name };
};

/** A Workspace on a Host: where a repository's pull requests are reviewed. */
export interface WorkspaceRef {
  readonly hostKey: string;
  readonly workspaceId: string;
}

/** A pull request by repository and number, as in its URL. */
export interface PullRef {
  readonly repo: RepoRef;
  readonly number: number;
}

export type AccountState = "ok" | "signed-out";

export interface GitHubAccountView {
  /** Polaris's key for the account: GitHub's user id on github.com, a negative number elsewhere. */
  readonly id: number;
  /** Where the account lives: `github.com` or a GitHub Enterprise host. Main always sets it. */
  readonly host?: string;
  /** The user's numeric id on its host: logins can be renamed. */
  readonly userId?: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string;
  readonly scopes: ReadonlyArray<string>;
  /** Requested scopes the user didn't grant; reviews of private repos need `repo`. */
  readonly missingScopes: ReadonlyArray<string>;
  /** `signed-out`: the token was revoked or its refresh token expired; sign in again. */
  readonly state: AccountState;
  /** Epoch ms of the last sign-in; null for accounts added before Polaris kept it. */
  readonly signedInAt: number | null;
  /** Epoch ms GitHub refused its token, while `signed-out`. */
  readonly signedOutAt: number | null;
}

export type SignInFailure = "expired" | "denied" | "disabled" | "network" | "unavailable";

/** A device flow in progress: show `userCode`, open `verificationUri`. */
export interface SignInView {
  readonly flowId: string;
  /** Main always sets it; absent means github.com. */
  readonly host?: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  readonly state: "waiting" | "failed";
  readonly failure: SignInFailure | null;
}

/** A GitHub that accounts can sign in to: github.com, or a GitHub Enterprise host the user added. */
export interface GitHubHostView {
  readonly host: string;
  /** False for github.com, which can't be removed. */
  readonly removable: boolean;
  /** The OAuth App registered on that host (an Enterprise admin creates it). */
  readonly clientId: string;
  /** Where the user reviews or revokes Polaris on that host. */
  readonly manageUrl: string;
}

export interface GitHubAccountsView {
  /** github.com first, then the Enterprise hosts in the order they were added. Main always sets it. */
  readonly hosts?: ReadonlyArray<GitHubHostView>;
  /** In the user's order: routing tries them first to last. */
  readonly accounts: ReadonlyArray<GitHubAccountView>;
  readonly signIn: SignInView | null;
  /** Owner or org login (`host/owner` off github.com, see `ownerKey`) → account id. */
  readonly owners: Readonly<Record<string, number>>;
  /** `hostKey/workspaceId` → account id: a Workspace's override. */
  readonly workspaces: Readonly<Record<string, number>>;
  /** False when this machine can't encrypt tokens (no keychain); sign-in is refused. */
  readonly storageAvailable: boolean;
  /** Where the user reviews or revokes Polaris on github.com (each host has its own). */
  readonly manageUrl: string;
}

/**
 * How Polaris reaches a repository. `blocked`: an organization's repo the
 * accounts can't see, most likely OAuth App restrictions or SSO.
 */
export type RepoAccessState = "checking" | "ok" | "blocked" | "not-found" | "no-account";

export interface RepoAccessView {
  /** `nameWithOwner`; the same name can exist on two hosts. */
  readonly repo: string;
  /** Main always sets it; absent means github.com. */
  readonly host?: string;
  readonly state: RepoAccessState;
  readonly accountId: number | null;
  readonly login: string | null;
  /** GitHub's `viewerPermission`: ADMIN, MAINTAIN, WRITE, TRIAGE or READ. */
  readonly permission: string | null;
  /** For `blocked`: request the org's approval, or start an SSO session. */
  readonly approvalUrl: string | null;
  readonly ssoUrl: string | null;
  readonly workspaces: ReadonlyArray<WorkspaceRef>;
}

export type ReviewDecision = "approved" | "changes-requested" | "review-required" | null;

export interface PullAuthor {
  readonly login: string;
  readonly avatarUrl: string;
  readonly bot?: boolean;
}

export interface PullRowView {
  /** The pull request's node id: stable across renames. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: string;
  /** Main always sets it; absent means github.com. */
  readonly host?: string;
  readonly isDraft: boolean;
  readonly author: PullAuthor | null;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
  /** Lines added and removed across the pull request. */
  readonly additions: number;
  readonly deletions: number;
  readonly updatedAt: string;
  readonly reviewDecision: ReviewDecision;
  /** The viewer's latest submitted review: APPROVED, CHANGES_REQUESTED, COMMENTED… */
  readonly viewerLatestReview: string | null;
  readonly requestedReviewers: ReadonlyArray<string>;
  /** The account that found it. */
  readonly accountId: number;
  /** The Workspaces whose remotes match its repository; empty for other repos. */
  readonly workspaces: ReadonlyArray<WorkspaceRef>;
  /** Its head is in a fork: never part of an inferred stack. Main always sets it. */
  readonly fromFork?: boolean;
  /** The head commit's checks; null when it has none. Main always sets it. */
  readonly checks?: ChecksView | null;
  /** The stack it's a layer of; null when it stands alone. Main always sets it. */
  readonly stack?: StackView | null;
}

/** Open, Draft, Merged or Closed, as the status pill says it. */
export type PullStatus = "open" | "draft" | "merged" | "closed";

/** A head commit's checks rolled up: GitHub's `statusCheckRollup`. */
export interface ChecksView {
  readonly state: "success" | "failure" | "pending";
  readonly total: number;
}

/** One layer of a stack. */
export interface StackMemberView {
  /** The pull request's node id; empty when GitHub didn't say (a member the viewer can't see). */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly headRefName: string;
  readonly status: PullStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly checks: ChecksView | null;
}

/**
 * A stack of pull requests, each targeting the one below (docs/research/github-stacks.md).
 * `github`: GitHub's own stack; `inferred`: from the open pull requests' base and head
 * branches (DESIGN.md, Review → Stacks).
 */
export interface StackView {
  readonly source: "github" | "inferred";
  /** GitHub's stack number ("Stack #635"); null for an inferred stack. */
  readonly number: number | null;
  /** The branch the bottom layer targets ("nightly"). */
  readonly trunk: string;
  /** This pull request's layer: 1 is the closest to the trunk. */
  readonly position: number;
  readonly size: number;
  /** Bottom (position 1) to top. */
  readonly members: ReadonlyArray<StackMemberView>;
}

/** The status pill's value from GitHub's state and draft flag. */
export const pullStatus = (state: string, isDraft: boolean): PullStatus => {
  const upper = state.toUpperCase();

  if (upper === "MERGED") return "merged";

  if (upper === "CLOSED") return "closed";

  return isDraft ? "draft" : "open";
};

/**
 * `background`: the window isn't focused, so polls are slower. `throttled`:
 * Polaris reached its share of the rate limit and waits for the reset.
 */
export type PollingState = "idle" | "focused" | "background" | "throttled";

export interface PullListView {
  readonly requested: ReadonlyArray<PullRowView>;
  readonly mine: ReadonlyArray<PullRowView>;
  readonly other: ReadonlyArray<PullRowView>;
  readonly repos: ReadonlyArray<RepoAccessView>;
  readonly updatedAt: number | null;
  readonly polling: PollingState;
  readonly throttledUntil: number | null;
  readonly error: string | null;
}

export type ViewedState = "viewed" | "unviewed" | "dismissed";

export interface PullFileView {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly changeType: string;
  /** `dismissed`: viewed, then changed since. */
  readonly viewed: ViewedState;
}

export type DiffSide = "left" | "right";

/**
 * Where a thread sits. `outdated`: its lines no longer exist at the head; anchor it
 * at `originalLine` in `commitOid` (the Review maps it forward or shows `diffHunk`).
 */
export type ThreadAnchor =
  | {
      readonly kind: "line";
      readonly line: number;
      readonly startLine: number | null;
      readonly side: DiffSide;
      readonly startSide: DiffSide | null;
    }
  | {
      readonly kind: "outdated";
      readonly originalLine: number | null;
      readonly originalStartLine: number | null;
      readonly side: DiffSide;
      readonly commitOid: string | null;
      readonly diffHunk: string;
    }
  | { readonly kind: "file" };

export interface ReviewCommentView {
  readonly id: string;
  readonly author: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly url: string;
  /** Pending comments are only visible to the viewer until the review is submitted. */
  readonly pending: boolean;
  readonly person?: PersonView;
}

export interface ReviewThreadView {
  readonly id: string;
  readonly path: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly resolvedBy?: string | null;
  readonly diffHunk?: string;
  readonly anchor: ThreadAnchor;
  readonly comments: ReadonlyArray<ReviewCommentView>;
}

export interface PendingReviewView {
  readonly id: string;
  readonly commitOid: string | null;
  readonly comments: number;
}

export interface PersonView {
  readonly login: string;
  readonly bot: boolean;
  readonly avatarUrl?: string;
}

export type TimelineItemView = {
  readonly id: string;
  readonly at: string;
  readonly url: string;
} & (
  | { readonly kind: "comment"; readonly author: PersonView; readonly body: string }
  | {
      readonly kind: "review";
      readonly author: PersonView;
      readonly state: "approved" | "changes-requested" | "commented" | "dismissed";
      readonly body: string;
    }
  | {
      readonly kind: "push";
      readonly author: PersonView | null;
      readonly commits: ReadonlyArray<{ readonly oid: string; readonly headline: string }>;
      readonly forced: boolean;
    }
  | {
      readonly kind: "thread";
      readonly threadId: string;
      readonly path: string;
      readonly line: number | null;
      readonly isResolved: boolean;
      readonly isOutdated: boolean;
      readonly resolvedBy: string | null;
      readonly diffHunk: string;
      readonly comments: ReadonlyArray<{
        readonly id: string;
        readonly author: PersonView;
        readonly body: string;
        readonly at: string;
        readonly url: string;
      }>;
    }
);

export interface CommitView {
  readonly oid: string;
  readonly headline: string;
  readonly body: string;
  readonly author: PersonView | null;
  readonly at: string;
  readonly checks: ChecksView | null;
}

export interface CheckRunView {
  readonly name: string;
  readonly workflow: string | null;
  readonly status: "queued" | "in-progress" | "completed";
  readonly conclusion:
    | "success"
    | "failure"
    | "neutral"
    | "skipped"
    | "cancelled"
    | "timed-out"
    | "action-required"
    | "stale"
    | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs?: number | null;
  readonly url: string | null;
}

export interface BotSummaryView {
  readonly bot: string;
  readonly commentId: string;
  readonly url: string;
  readonly body: string;
  readonly verdict: {
    readonly alert: "note" | "tip" | "important" | "warning" | "caution";
    readonly word: string;
  } | null;
  readonly reviewedHead: string | null;
  readonly reviewedBase: string | null;
  readonly updatedAt: string;
}

export interface PublishedDescriptionView {
  readonly hash: string;
  readonly head: string;
  readonly at: string;
}

export interface PullDetailView {
  readonly timeline?: ReadonlyArray<TimelineItemView>;
  readonly commitList?: ReadonlyArray<CommitView>;
  readonly checkRuns?: ReadonlyArray<CheckRunView>;
  readonly botSummary?: BotSummaryView | null;
  readonly viewerLastReview?: { readonly at: string; readonly commitOid: string | null } | null;
  readonly published?: PublishedDescriptionView | null;
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly repo: string;
  /** Main always sets it; absent means github.com. */
  readonly host?: string;
  readonly state: "open" | "closed" | "merged";
  readonly isDraft: boolean;
  readonly author: PullAuthor | null;
  readonly viewerLogin: string;
  /** Authors can't approve their own pull requests. */
  readonly viewerCanApprove: boolean;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly baseRefName: string;
  readonly baseRefOid: string;
  /** How many commits the pull request has ("wants to merge 3 commits"). */
  readonly commits: number;
  readonly files: ReadonlyArray<PullFileView>;
  readonly threads: ReadonlyArray<ReviewThreadView>;
  readonly pendingReview: PendingReviewView | null;
  readonly accountId: number;
  /** Main always sets these two; see `PullRowView`. */
  readonly checks?: ChecksView | null;
  readonly stack?: StackView | null;
}

export type ReviewEvent = "approve" | "request-changes" | "comment";

export type PullState = "open" | "closed" | "merged" | "unknown";

/** A Review Checkout's pull request, watched for merge, close and new commits. */
export interface CheckoutWatch {
  /** The caller's own key for the checkout (e.g. its Host and id). */
  readonly key: string;
  readonly pull: PullRef;
  /** The pull request's node id (`PullRowView.id`). */
  readonly pullId: string;
}

/** What `github.pull.compare` asks: the commit a Review Checkout holds, and the head. */
export interface PullCompare {
  readonly repo: RepoRef;
  readonly base: string;
  readonly head: string;
}

export interface CompareCommitView {
  readonly oid: string;
  readonly headline: string;
  /** The committer's date (ISO 8601); null when GitHub has none. */
  readonly date: string | null;
}

/** The commits `head` adds over `base`, newest first (at most 20; `total` counts them all). */
export interface CompareView {
  /** `diverged`: the branch was rewritten (a force-push), so `head` doesn't contain `base`. */
  readonly status: "ahead" | "behind" | "identical" | "diverged";
  readonly total: number;
  readonly commits: ReadonlyArray<CompareCommitView>;
}

export interface CheckoutStateView {
  readonly key: string;
  readonly pullId: string;
  readonly state: PullState;
  readonly headRefOid: string | null;
  /** When it was merged or closed; a closed one may reopen, so removal can wait. */
  readonly closedAt: string | null;
}

const HOSTNAME =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * A GitHub Enterprise host from what a user typed: `ghe.acme.com`, its URL, or
 * its API URL. Null when it isn't a hostname, or is github.com itself.
 */
export const normalizeHost = (input: string): string | null => {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:443$/, "");

  if (!HOSTNAME.test(host) || host === GITHUB_HOST || host.endsWith(`.${GITHUB_HOST}`)) return null;

  return host;
};

const REMOTE_FORMS: ReadonlyArray<RegExp> = [
  /^[^@/\s]+@([^:/\s]+):([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/[^@/\s]+@([^:/\s]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^(?:https?|git):\/\/(?:[^@/\s]+@)?([^:/\s]+)(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

/** A `RepoRef` on `host`: no `host` field for github.com. */
const repoOn = (host: string, owner: string, name: string): RepoRef =>
  host === GITHUB_HOST ? { owner, name } : { host, owner, name };

/**
 * A repository from a git remote URL (SSH, scp-like or HTTPS) on github.com or
 * one of the Enterprise `hosts`; null for any other host.
 */
export const parseGitHubRemote = (
  url: string,
  hosts: ReadonlyArray<string> = []
): RepoRef | null => {
  const known = new Set([GITHUB_HOST, ...hosts.map((h) => h.toLowerCase())]);

  for (const form of REMOTE_FORMS) {
    const match = form.exec(url.trim());
    const host = match?.[1]?.toLowerCase();

    if (
      host !== undefined &&
      known.has(host) &&
      match?.[2] !== undefined &&
      match[3] !== undefined
    ) {
      return repoOn(host, match[2], match[3]);
    }
  }

  return null;
};

const PULL_URL = /^https:\/\/([^/\s]+)\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** "Review PR by URL": `https://<github.com or an Enterprise host>/<owner>/<repo>/pull/<n>[/files…]`. */
export const parsePullUrl = (url: string): PullRef | null => {
  const match = PULL_URL.exec(url.trim());
  const host = match?.[1]?.toLowerCase();

  if (
    host === undefined ||
    match?.[2] === undefined ||
    match[3] === undefined ||
    match[4] === undefined
  ) {
    return null;
  }

  if (host !== GITHUB_HOST && normalizeHost(host) === null) return null;

  return { repo: repoOn(host, match[2], match[3]), number: Number(match[4]) };
};

/** `owner/name` (`host/owner/name` off github.com); compare case-insensitively. */
export const repoKey = (repo: RepoRef) =>
  (repo.host === undefined || repo.host === GITHUB_HOST
    ? `${repo.owner}/${repo.name}`
    : `${repo.host}/${repo.owner}/${repo.name}`
  ).toLowerCase();

/** The key of an owner mapping: the login on github.com, `host/login` elsewhere. */
export const ownerKey = (host: string, owner: string) =>
  (host === GITHUB_HOST ? owner : `${host}/${owner}`).toLowerCase();

export const workspaceKey = (workspace: WorkspaceRef) =>
  `${workspace.hostKey}/${workspace.workspaceId}`;
