/**
 * `accounts.json` as data: the hosts (github.com built in, Enterprise hosts added),
 * the accounts on them, and the view Settings gets. Pure; `accounts.ts` persists it.
 */
import {
  GITHUB_CLIENT_ID,
  GITHUB_HOST,
  type GitHubAccountsView,
  type GitHubHostView,
  type SignInView,
} from "../../shared/github.ts";
import { type EndpointConfig, endpointsFor, manageUrl } from "./config.ts";
import { missingScopes } from "./deviceFlow.ts";
import { type AccountRecord, type AccountsFile, type HostRecord, userIdOf } from "./store.ts";

/** The hosts accounts can sign in to: github.com first, then the Enterprise hosts. */
export const hostsOf = (file: AccountsFile): ReadonlyArray<HostRecord> => [
  { host: GITHUB_HOST, clientId: GITHUB_CLIENT_ID },
  ...file.hosts,
];

export const hostView = (config: EndpointConfig, record: HostRecord): GitHubHostView => ({
  host: record.host,
  removable: record.host !== GITHUB_HOST,
  clientId: record.clientId,
  manageUrl: manageUrl(endpointsFor(config, record.host), record.clientId),
});

export interface ViewInput {
  readonly file: AccountsFile;
  readonly signIn: SignInView | null;
  readonly storageAvailable: boolean;
  readonly config: EndpointConfig;
}

export const viewOf = ({
  file,
  signIn,
  storageAvailable,
  config,
}: ViewInput): GitHubAccountsView => ({
  hosts: hostsOf(file).map((h) => hostView(config, h)),
  accounts: file.accounts.map((a) => ({
    id: a.id,
    host: a.host,
    userId: userIdOf(a),
    login: a.login,
    name: a.name,
    avatarUrl: a.avatarUrl,
    scopes: a.scopes,
    missingScopes: missingScopes(a.scopes),
    state: a.signedOut ? "signed-out" : "ok",
    signedInAt: a.signedInAt,
    signedOutAt: a.signedOutAt,
  })),
  signIn,
  owners: file.owners,
  workspaces: file.workspaces,
  storageAvailable,
  manageUrl: manageUrl(endpointsFor(config, GITHUB_HOST)),
});

/**
 * Polaris's id for a user on a host: the one they already have, GitHub's user id on
 * github.com (as before Enterprise), else a fresh negative number no account uses.
 */
export const idFor = (file: AccountsFile, host: string, userId: number) => {
  const existing = file.accounts.find((a) => a.host === host && userIdOf(a) === userId);

  if (existing !== undefined) return existing.id;

  if (host === GITHUB_HOST && !file.accounts.some((a) => a.id === userId)) return userId;

  return Math.min(0, ...file.accounts.map((a) => a.id)) - 1;
};

export const withAccount = (file: AccountsFile, record: AccountRecord): AccountsFile => ({
  ...file,
  accounts: file.accounts.some((a) => a.id === record.id)
    ? file.accounts.map((a) => (a.id === record.id ? record : a))
    : [...file.accounts, record],
});

const dropValue = (map: Readonly<Record<string, number>>, ids: ReadonlyArray<number>) =>
  Object.fromEntries(Object.entries(map).filter(([, v]) => !ids.includes(v)));

/** Without these accounts, and without any routing that pointed at them. */
export const withoutAccounts = (file: AccountsFile, ids: ReadonlyArray<number>): AccountsFile => ({
  hosts: file.hosts,
  accounts: file.accounts.filter((a) => !ids.includes(a.id)),
  owners: dropValue(file.owners, ids),
  workspaces: dropValue(file.workspaces, ids),
});
