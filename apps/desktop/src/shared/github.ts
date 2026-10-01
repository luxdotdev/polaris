/**
 * The GitHub client's views as the renderer sees them, plus the pure helpers it
 * may call directly (remote and pull request URL parsing). No Effect code here:
 * the renderer imports this file at runtime.
 */

/** The Polaris OAuth App (ENG-226). Public: the device flow needs no secret. */
export const GITHUB_CLIENT_ID = "Ov23lix8h2ldBZFwXqek";

/** Asked for at every sign-in (ENG-219): `repo` reaches private repos, `read:org` team requests. */
export const GITHUB_SCOPES: ReadonlyArray<string> = ["repo", "read:org"];

/** A repository by owner and name, as `nameWithOwner` spells it. */
export interface RepoRef {
  readonly owner: string;
  readonly name: string;
}

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
  /** GitHub's numeric user id: logins can be renamed. */
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly avatarUrl: string;
  readonly scopes: ReadonlyArray<string>;
  /** Requested scopes the user didn't grant; reviews of private repos need `repo`. */
  readonly missingScopes: ReadonlyArray<string>;
  /** `signed-out`: the token was revoked or its refresh token expired; sign in again. */
  readonly state: AccountState;
}

export type SignInFailure = "expired" | "denied" | "disabled" | "network" | "unavailable";

/** A device flow in progress: show `userCode`, open `verificationUri`. */
export interface SignInView {
  readonly flowId: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresAt: number;
  readonly state: "waiting" | "failed";
  readonly failure: SignInFailure | null;
}

export interface GitHubAccountsView {
  /** In the user's order: routing tries them first to last. */
  readonly accounts: ReadonlyArray<GitHubAccountView>;
  readonly signIn: SignInView | null;
  /** Owner or org login → account id. */
  readonly owners: Readonly<Record<string, number>>;
  /** `hostKey/workspaceId` → account id: a Workspace's override. */
  readonly workspaces: Readonly<Record<string, number>>;
  /** False when this machine can't encrypt tokens (no keychain); sign-in is refused. */
  readonly storageAvailable: boolean;
  /** Where the user reviews or revokes Polaris on GitHub. */
  readonly manageUrl: string;
}

/**
 * How Polaris reaches a repository. `blocked`: an organization's repo the
 * accounts can't see, most likely OAuth App restrictions or SSO.
 */
export type RepoAccessState = "checking" | "ok" | "blocked" | "not-found" | "no-account";

export interface RepoAccessView {
  readonly repo: string;
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
}

export interface PullRowView {
  /** The pull request's node id: stable across renames. */
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repo: string;
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
}

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
}

export interface ReviewThreadView {
  readonly id: string;
  readonly path: string;
  readonly isResolved: boolean;
  readonly isOutdated: boolean;
  readonly anchor: ThreadAnchor;
  readonly comments: ReadonlyArray<ReviewCommentView>;
}

export interface PendingReviewView {
  readonly id: string;
  readonly commitOid: string | null;
  readonly comments: number;
}

export interface PullDetailView {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly url: string;
  readonly repo: string;
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
  readonly files: ReadonlyArray<PullFileView>;
  readonly threads: ReadonlyArray<ReviewThreadView>;
  readonly pendingReview: PendingReviewView | null;
  readonly accountId: number;
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

export interface CheckoutStateView {
  readonly key: string;
  readonly pullId: string;
  readonly state: PullState;
  readonly headRefOid: string | null;
  /** When it was merged or closed; a closed one may reopen, so removal can wait. */
  readonly closedAt: string | null;
}

const REMOTE_FORMS: ReadonlyArray<RegExp> = [
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^ssh:\/\/git@github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^(?:https?|git):\/\/(?:[^@/\s]+@)?github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

/** A github.com repository from a git remote URL (SSH, scp-like or HTTPS); null for any other host. */
export const parseGitHubRemote = (url: string): RepoRef | null => {
  const trimmed = url.trim();

  for (const form of REMOTE_FORMS) {
    const match = form.exec(trimmed);

    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { owner: match[1], name: match[2] };
    }
  }

  return null;
};

const PULL_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/;

/** "Review PR by URL": `https://github.com/<owner>/<repo>/pull/<n>[/files…]`. */
export const parsePullUrl = (url: string): PullRef | null => {
  const match = PULL_URL.exec(url.trim());

  if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) return null;

  return { repo: { owner: match[1], name: match[2] }, number: Number(match[3]) };
};

/** `owner/name`, GitHub's `nameWithOwner`; compare case-insensitively. */
export const repoKey = (repo: RepoRef) => `${repo.owner}/${repo.name}`.toLowerCase();

export const workspaceKey = (workspace: WorkspaceRef) =>
  `${workspace.hostKey}/${workspace.workspaceId}`;
