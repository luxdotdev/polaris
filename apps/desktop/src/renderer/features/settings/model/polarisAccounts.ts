/** Settings → Polaris accounts (DESIGN.md, Shared Sessions; Paper SS5): rows from the main process's view. */
import type {
  PolarisAccountsView,
  PolarisAccountView,
} from "../../../../shared/accountsContract.ts";
import { timeAgo } from "./github.ts";
import type { WorkspaceOption } from "./workspaces.ts";

export interface PolarisAccountRow {
  readonly id: string;
  readonly handle: string;
  /** Two letters for the avatar until its image loads. */
  readonly initials: string;
  readonly avatar: string | null;
  readonly badge: "Polaris Cloud" | "Own server";
  /** The server's host for Polaris Cloud, its whole URL (mono) for one of your own. */
  readonly server: string;
  readonly serverIsUrl: boolean;
  /** "signed in 12 days ago", or why it's signed out. */
  readonly status: string;
  readonly signedOut: boolean;
  /** "Workspaces: polaris, dotfiles"; null when no Workspace is shared as it. */
  readonly workspaces: string | null;
  readonly commitEmail: string;
  readonly commitEmails: ReadonlyArray<string>;
}

const initialsOf = (login: string) =>
  login
    .replaceAll(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();

const workspacesOf = (
  account: PolarisAccountView,
  workspaces: PolarisAccountsView["workspaces"],
  options: ReadonlyArray<WorkspaceOption>
) => {
  const names = Object.entries(workspaces)
    .filter(([, id]) => id === account.id)
    .map(([key]) => options.find((o) => o.key === key)?.name)
    .filter((name) => name !== undefined);

  return names.length === 0 ? null : `Workspaces: ${[...new Set(names)].join(", ")}`;
};

export const polarisAccountRows = (
  view: PolarisAccountsView,
  options: ReadonlyArray<WorkspaceOption>,
  now: number
): ReadonlyArray<PolarisAccountRow> =>
  view.accounts.map((account) => ({
    id: account.id,
    handle: `@${account.login}`,
    initials: initialsOf(account.login),
    avatar: account.avatar,
    badge: account.isPolarisCloud ? "Polaris Cloud" : "Own server",
    server: account.isPolarisCloud ? new URL(account.server).host : account.server,
    serverIsUrl: !account.isPolarisCloud,
    status:
      account.signedOutAt === null
        ? `signed in ${timeAgo(now - account.signedInAt)}`
        : `Signed out · the server ended its session ${timeAgo(now - account.signedOutAt)}`,
    signedOut: account.signedOutAt !== null,
    workspaces: workspacesOf(account, view.workspaces, options),
    commitEmail: account.commitEmail,
    commitEmails: account.commitEmails,
  }));

/** "2 signed in on this Mac" / "1 signed in · 1 signed out". */
export const accountsSummary = (view: PolarisAccountsView, machine: string) => {
  const out = view.accounts.filter((a) => a.signedOutAt !== null).length;
  const signedIn = view.accounts.length - out;

  return out === 0
    ? `${signedIn} signed in on ${machine}`
    : `${signedIn} signed in · ${out} signed out`;
};

/** "4:59 left" for a device code. */
export const codeExpiry = (expiresAt: number, now: number) => {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));

  return seconds === 0
    ? "The code expired"
    : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} left`;
};
