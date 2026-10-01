/**
 * Settings → GitHub accounts as data (Paper S5, S6): the account rows, the owner table
 * with each owner's Workspaces and access, the Workspace overrides, and the device-flow
 * card's words. The first account is the default: routing tries accounts in order.
 */
import type {
  GitHubAccountsView,
  PullListView,
  RepoAccessView,
  SignInFailure,
  SignInView,
} from "../../../../shared/github.ts";

export interface AccountRow {
  readonly id: number;
  readonly login: string;
  /** Its place in the user's order, for its mark. */
  readonly index: number;
  readonly isDefault: boolean;
  readonly signedOut: boolean;
  /** One caption line: what it's used for, or why it needs a new sign-in. */
  readonly caption: string;
  /** "signed in 3 weeks ago"; null when Polaris didn't keep the time, or signed out. */
  readonly since: string | null;
}

const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"} ago`;

/** "just now", "5 minutes ago", "2 days ago", "3 weeks ago", "4 months ago". */
export const timeAgo = (ms: number) => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "just now";

  if (hours < 1) return unit(minutes, "minute");

  if (days < 1) return unit(hours, "hour");

  if (days < 14) return unit(days, "day");

  return days < 60 ? unit(Math.floor(days / 7), "week") : unit(Math.floor(days / 30), "month");
};

const list = (names: ReadonlyArray<string>) =>
  names.length <= 3
    ? names.join(", ")
    : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;

/** After a "Name · " lead, the default's words start lowercase. */
const usedFor = (view: GitHubAccountsView, id: number, isDefault: boolean, afterLead: boolean) => {
  const owners = Object.entries(view.owners)
    .filter(([, account]) => account === id)
    .map(([owner]) => owner)
    .toSorted();

  if (isDefault) {
    return owners.length === 0
      ? `${afterLead ? "u" : "U"}sed for every owner`
      : `${list(owners)} · and every owner not listed below`;
  }

  return owners.length === 0 ? "Not used for any owner yet" : list(owners);
};

export const accountRows = (view: GitHubAccountsView, now: number): ReadonlyArray<AccountRow> =>
  view.accounts.map((account, index) => {
    const isDefault = index === 0;
    const signedOut = account.state === "signed-out";

    const lead =
      account.name === null || account.name === account.login ? "" : `${account.name} · `;

    const caption = signedOut
      ? `Signed out · GitHub refused its token${account.signedOutAt === null ? "" : ` ${timeAgo(now - account.signedOutAt)}`}`
      : account.missingScopes.length > 0
        ? `Can't see private repos (no ${account.missingScopes.join(", ")} access) · sign in again`
        : `${lead}${usedFor(view, account.id, isDefault, lead !== "")}`;

    const since =
      signedOut || account.signedInAt === null
        ? null
        : `signed in ${timeAgo(now - account.signedInAt)}`;

    return { id: account.id, login: account.login, index, isDefault, signedOut, caption, since };
  });

/** An owner's worst access problem, with what fixes it. */
export type OwnerAccess =
  | { readonly kind: "ok" }
  | {
      readonly kind: "blocked";
      readonly repo: string;
      readonly approvalUrl: string | null;
      readonly ssoUrl: string | null;
    }
  | { readonly kind: "not-found"; readonly repo: string };

export interface OwnerRow {
  readonly owner: string;
  /** "3 on 2 hosts", "2 on Mac Studio", "No workspaces". */
  readonly workspaces: string;
  /** Mapped account; null uses the default. */
  readonly accountId: number | null;
  readonly access: OwnerAccess;
}

export interface OwnerTable {
  readonly rows: ReadonlyArray<OwnerRow>;
  /** Owners neither mapped nor in trouble: they use the default. */
  readonly everyoneElse: string;
}

const ownerOf = (repo: string) => repo.split("/")[0] ?? repo;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const workspaceCount = (
  repos: ReadonlyArray<RepoAccessView>,
  hostLabel: (hostKey: string) => string
) => {
  const workspaces = new Set(
    repos.flatMap((r) => r.workspaces.map((w) => `${w.hostKey}/${w.workspaceId}`))
  );

  const hosts = new Set(repos.flatMap((r) => r.workspaces.map((w) => w.hostKey)));
  const [only] = hosts;

  if (workspaces.size === 0) return "No workspaces";

  return hosts.size === 1 && only !== undefined
    ? `${workspaces.size} on ${hostLabel(only)}`
    : `${workspaces.size} on ${plural(hosts.size, "host")}`;
};

const accessOf = (repos: ReadonlyArray<RepoAccessView>): OwnerAccess => {
  const blocked = repos.find((r) => r.state === "blocked");

  if (blocked !== undefined) {
    return {
      kind: "blocked",
      repo: blocked.repo,
      approvalUrl: blocked.approvalUrl,
      ssoUrl: blocked.ssoUrl,
    };
  }

  const missing = repos.find((r) => r.state === "not-found");

  return missing === undefined ? { kind: "ok" } : { kind: "not-found", repo: missing.repo };
};

/** Mapped owners and owners in trouble get a row, by name; the rest are "Everyone else". */
export const ownerTable = (
  view: GitHubAccountsView,
  pulls: Pick<PullListView, "repos"> | null,
  hostLabel: (hostKey: string) => string
): OwnerTable => {
  const repos = pulls?.repos ?? [];
  const byOwner = Map.groupBy(repos, (r) => ownerOf(r.repo));
  const owners = new Set([...Object.keys(view.owners), ...byOwner.keys()]);

  const rows = [...owners]
    .flatMap((owner): ReadonlyArray<OwnerRow> => {
      const own = byOwner.get(owner) ?? [];

      const row: OwnerRow = {
        owner,
        workspaces: workspaceCount(own, hostLabel),
        accountId: view.owners[owner] ?? null,
        access: accessOf(own),
      };

      return row.accountId !== null || row.access.kind !== "ok" ? [row] : [];
    })
    .toSorted((a, b) => a.owner.localeCompare(b.owner));

  const listed = new Set(rows.map((r) => r.owner));
  const rest = repos.filter((r) => !listed.has(ownerOf(r.repo)));

  return { rows, everyoneElse: workspaceCount(rest, hostLabel) };
};

export interface OverrideRow {
  readonly key: string;
  readonly accountId: number;
  /** The account its owner would use, when it differs: "instead of lmd-work". */
  readonly insteadOf: number | null;
}

/** The Workspaces that use another account than their owner's. */
export const workspaceOverrides = (
  view: GitHubAccountsView,
  pulls: Pick<PullListView, "repos"> | null
): ReadonlyArray<OverrideRow> =>
  Object.entries(view.workspaces)
    .map(([key, accountId]) => {
      const repo = pulls?.repos.find((r) =>
        r.workspaces.some((w) => `${w.hostKey}/${w.workspaceId}` === key)
      );

      const owner = repo === undefined ? undefined : view.owners[ownerOf(repo.repo)];
      const fallback = owner ?? view.accounts[0]?.id ?? null;

      return { key, accountId, insteadOf: fallback === accountId ? null : fallback };
    })
    .toSorted((a, b) => a.key.localeCompare(b.key));

const FAILURES: Readonly<Record<SignInFailure, string>> = {
  expired: "The code expired before GitHub confirmed it",
  denied: "GitHub says the sign-in was declined",
  disabled: "Device sign-in is turned off for Polaris on GitHub",
  network: "Couldn't reach GitHub",
  unavailable: "GitHub couldn't start a sign-in right now",
};

/** "14:32", never below zero. */
export const countdown = (expiresAt: number, now: number) => {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export interface SignInStatus {
  readonly waiting: boolean;
  readonly text: string;
  /** "code expires in 14:32" while waiting. */
  readonly aside: string | null;
}

export const signInStatus = (flow: SignInView, now: number): SignInStatus => {
  if (flow.state === "failed") {
    return { waiting: false, text: FAILURES[flow.failure ?? "unavailable"], aside: null };
  }

  if (flow.expiresAt <= now) return { waiting: false, text: FAILURES.expired, aside: null };

  return {
    waiting: true,
    text: "Waiting for GitHub",
    aside: `code expires in ${countdown(flow.expiresAt, now)}`,
  };
};
