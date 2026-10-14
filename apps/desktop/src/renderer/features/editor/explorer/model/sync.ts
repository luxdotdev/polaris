/**
 * Pull and push (DESIGN.md, Editor → Sync with the remote): the branch's
 * standing against its upstream and the last run, as the controls show them.
 */
import type {
  ConnectionState,
  GitSyncAction,
  GitSyncFailure,
  GitSyncStep,
  GitTracking,
} from "@polaris/protocol";

/** `git.status`'s branch facts (explorer `GitFacts`). */
export interface SyncFacts {
  readonly branch: string | null;
  readonly head: string | null;
  readonly ahead: number;
  readonly behind: number;
  readonly tracking: GitTracking | null;
}

/** "lost": the feed ended with the Host's link, not with git's answer. */
export type SyncFailure = GitSyncFailure | "lost";

export type SyncRun =
  | { readonly kind: "idle" }
  | {
      readonly kind: "running";
      readonly action: GitSyncAction;
      readonly step: GitSyncStep | null;
      readonly remote: string | null;
      readonly startedAt: number;
    }
  | {
      readonly kind: "failed";
      readonly action: GitSyncAction;
      readonly reason: SyncFailure;
      readonly exitCode: number | null;
      readonly output: string;
    };

export const IDLE_RUN: SyncRun = { kind: "idle" };

export type SyncStanding =
  | "detached"
  | "no-remote"
  | "unpublished"
  | "up-to-date"
  | "behind"
  | "ahead"
  | "diverged";

/** What a failure offers next: run an action, show Changes, or open a terminal on the Host. */
export type SyncNext =
  | { readonly kind: "action"; readonly action: GitSyncAction; readonly label: string }
  | { readonly kind: "changes"; readonly label: string }
  | { readonly kind: "terminal"; readonly label: string };

export interface SyncMenuItem {
  readonly action: GitSyncAction;
  readonly label: string;
  readonly enabled: boolean;
}

export interface SyncView {
  readonly standing: SyncStanding;
  readonly branch: string | null;
  /** The upstream ("origin/main"), or the remote Publish pushes to. */
  readonly target: string | null;
  readonly ahead: number;
  readonly behind: number;
  /** The one button: pull when behind, push when ahead, sync when both; null when none applies. */
  readonly primary: {
    readonly action: GitSyncAction;
    readonly label: string;
    readonly hint: string;
  } | null;
  readonly menu: ReadonlyArray<SyncMenuItem>;
  /** A sentence for the standings without a primary action. */
  readonly note: string | null;
  readonly running: { readonly label: string } | null;
  readonly failure: {
    readonly headline: string;
    readonly detail: string;
    readonly output: string;
    readonly next: SyncNext | null;
  } | null;
  /** Why the controls are off: the Host isn't connected. */
  readonly away: string | null;
}

export interface SyncInput {
  readonly facts: SyncFacts;
  readonly run: SyncRun;
  readonly host: string;
  readonly connection: ConnectionState;
}

const commits = (n: number) => `${n} commit${n === 1 ? "" : "s"}`;

/** The remote part of "origin/main", for sentences that name the remote. */
const remoteOf = (facts: SyncFacts) =>
  facts.tracking?.upstream?.split("/")[0] ?? facts.tracking?.remote ?? "the remote";

export const standingOf = (facts: SyncFacts, tracking: GitTracking): SyncStanding => {
  if (facts.branch === null) return "detached";

  if (tracking.upstream === null && tracking.remote === null) return "no-remote";

  if (tracking.upstream === null || tracking.gone) return "unpublished";

  if (facts.ahead > 0 && facts.behind > 0) return "diverged";

  if (facts.behind > 0) return "behind";

  return facts.ahead > 0 ? "ahead" : "up-to-date";
};

const primaryOf = (
  standing: SyncStanding,
  facts: SyncFacts,
  target: string
): SyncView["primary"] => {
  const { ahead, behind, branch } = facts;

  switch (standing) {
    case "behind":
      return {
        action: "pull",
        label: `Pull ${commits(behind)}`,
        hint: `Pull ${commits(behind)} from ${target}`,
      };
    case "ahead":
      return {
        action: "push",
        label: `Push ${commits(ahead)}`,
        hint: `Push ${commits(ahead)} to ${target}`,
      };
    case "diverged":
      return {
        action: "sync",
        label: `Pull ${behind}, then push ${ahead}`,
        hint: `Pull ${commits(behind)} from ${target}, then push ${commits(ahead)}`,
      };
    case "up-to-date":
      return { action: "sync", label: "Sync", hint: `Pull anything new from ${target}` };
    case "unpublished":
      return facts.head === null
        ? null
        : { action: "publish", label: "Publish branch", hint: `Push ${branch} to ${target}` };
    default:
      return null;
  }
};

const NOTES: Partial<Record<SyncStanding, string>> = {
  detached: "Check out a branch to pull or push.",
  "no-remote": "No remote · add one with git remote add",
};

const menuOf = (standing: SyncStanding, facts: SyncFacts, idle: boolean): SyncView["menu"] => {
  const tracked = standing !== "detached" && standing !== "no-remote" && standing !== "unpublished";

  const fetch = {
    action: "fetch" as const,
    label: "Fetch",
    enabled: idle && standing !== "no-remote",
  };

  const pull = { action: "pull" as const, label: "Pull", enabled: idle && tracked };

  if (standing === "unpublished")
    return [
      fetch,
      pull,
      { action: "publish", label: "Publish branch", enabled: idle && facts.head !== null },
    ];

  return [fetch, pull, { action: "push", label: "Push", enabled: idle && tracked }];
};

const STEP_LABELS: Record<GitSyncStep, string> = {
  fetch: "Fetching from",
  pull: "Pulling from",
  push: "Pushing to",
};

const ACTION_LABELS: Record<GitSyncAction, string> = {
  fetch: "Fetching",
  pull: "Pulling",
  push: "Pushing",
  publish: "Publishing",
  sync: "Syncing",
};

const runningLabel = (run: Extract<SyncRun, { kind: "running" }>) =>
  run.step === null || run.remote === null
    ? `${ACTION_LABELS[run.action]}…`
    : `${STEP_LABELS[run.step]} ${run.remote}`;

const VERBS: Record<GitSyncAction, string> = {
  fetch: "Fetch",
  pull: "Pull",
  push: "Push",
  publish: "Publish",
  sync: "Sync",
};

interface FailureContext {
  readonly run: Extract<SyncRun, { kind: "failed" }>;
  readonly facts: SyncFacts;
  readonly target: string;
  readonly remote: string;
  readonly host: string;
}

type FailureCopy = Omit<NonNullable<SyncView["failure"]>, "output">;

const retry = (c: FailureContext): SyncNext => ({
  kind: "action",
  action: c.run.action,
  label: "Try again",
});

const terminal: SyncNext = { kind: "terminal", label: "Open terminal" };

const FAILURES: Record<SyncFailure, (c: FailureContext) => FailureCopy> = {
  rejected: (c) => ({
    headline: "Push rejected",
    detail: `${c.target} has commits this branch doesn't. Pull them, then push.`,
    next: { kind: "action", action: "pull", label: "Pull" },
  }),
  diverged: (c) => ({
    headline: "Can't fast-forward",
    detail: `${c.facts.branch ?? "This branch"} and ${c.target} both have new commits. Rebase or merge them in a terminal.`,
    next: terminal,
  }),
  conflicts: () => ({
    headline: "Pull stopped on conflicts",
    detail: "Resolve the conflicted files in changes, then commit.",
    next: { kind: "changes", label: "Show changes" },
  }),
  "local-changes": () => ({
    headline: "Local changes in the way",
    detail: "Pulling would overwrite files you changed. Commit or stash them, then pull.",
    next: { kind: "changes", label: "Show changes" },
  }),
  auth: (c) => ({
    headline: `Couldn't sign in to ${c.remote}`,
    detail: `${c.host} has no credentials for ${c.remote} that work without a prompt. Sign in with git in a terminal there.`,
    next: terminal,
  }),
  network: (c) => ({
    headline: `Couldn't reach ${c.remote}`,
    detail: `Check ${c.host}'s network, then try again.`,
    next: retry(c),
  }),
  timeout: (c) => ({
    headline: `${VERBS[c.run.action]} timed out`,
    detail: `No answer from ${c.remote} for 10 minutes.`,
    next: retry(c),
  }),
  lost: (c) => ({
    headline: `Lost ${c.host}`,
    detail: `The connection dropped during the ${VERBS[c.run.action].toLowerCase()}. Check the branch once it's back.`,
    next: retry(c),
  }),
  "no-remote": () => ({
    headline: "No remote",
    detail: "Add one with git remote add.",
    next: terminal,
  }),
  "no-upstream": () => ({
    headline: "No upstream",
    detail: "Publish the branch to push it.",
    next: { kind: "action", action: "publish", label: "Publish branch" },
  }),
  detached: () => ({
    headline: "Detached HEAD",
    detail: "Check out a branch to pull or push.",
    next: null,
  }),
  failed: (c) => ({
    headline: `${VERBS[c.run.action]} failed${c.run.exitCode === null ? "" : ` (exit ${c.run.exitCode})`}`,
    detail: c.run.output === "" ? "Git gave no reason." : "",
    next: retry(c),
  }),
};

const AWAY: Record<Exclude<ConnectionState, "connected">, (host: string) => string> = {
  reconnecting: (host) => `Reconnecting to ${host}`,
  offline: (host) => `${host} is offline`,
  "needs-attention": (host) => `${host} needs attention`,
};

const failureOf = (input: SyncInput, target: string): SyncView["failure"] => {
  const { run, facts, host } = input;

  if (run.kind !== "failed") return null;
  const copy = FAILURES[run.reason]({ run, facts, target, remote: remoteOf(facts), host });

  return { ...copy, output: run.output };
};

/**
 * The controls for one Workspace's branch, in the status bar and the changes
 * tab alike; null from a Daemon without `git.sync` (no `tracking`).
 */
export const syncView = (input: SyncInput): SyncView | null => {
  const { facts, run, connection } = input;
  const tracking = facts.tracking;

  if (tracking === null) return null;
  const standing = standingOf(facts, tracking);
  const unpublished = tracking.upstream === null || tracking.gone;
  const target = (unpublished ? tracking.remote : tracking.upstream) ?? remoteOf(facts);
  const away = connection === "connected" ? null : AWAY[connection](input.host);
  const idle = run.kind !== "running" && away === null;

  return {
    standing,
    branch: facts.branch,
    target: standing === "no-remote" || standing === "detached" ? null : target,
    ahead: facts.ahead,
    behind: facts.behind,
    primary: primaryOf(standing, facts, target),
    menu: menuOf(standing, facts, idle),
    note: NOTES[standing] ?? null,
    running: run.kind === "running" ? { label: runningLabel(run) } : null,
    failure: failureOf(input, target),
    away,
  };
};
