/** Settings' Polaris accounts as rows: who, on which Account Server, credited as which address. */
import { type AccountRecord, isPolarisCloud } from "@polaris/client/accounts";

export interface AccountRow {
  readonly id: string;
  readonly initial: string;
  readonly login: string;
  /** The Account Server's origin, to sign in to again. */
  readonly origin: string;
  /** "Polaris Cloud", or a self-hosted server's host name. */
  readonly server: string;
  /** "octocat@github.com", or "Signed out" once the server refused the session. */
  readonly line: string;
  readonly signedOut: boolean;
  /** Other addresses the commit email can be; empty when there's no choice. */
  readonly emails: ReadonlyArray<string>;
}

export const serverName = (server: string) =>
  isPolarisCloud(server) ? "Polaris Cloud" : URL.canParse(server) ? new URL(server).host : server;

export const accountRows = (accounts: ReadonlyArray<AccountRecord>): ReadonlyArray<AccountRow> =>
  accounts.map((account) => ({
    id: account.id,
    initial: (account.login[0] ?? "?").toUpperCase(),
    login: account.login,
    origin: account.server,
    server: serverName(account.server),
    line: account.signedOutAt === null ? account.commitEmail : "Signed out",
    signedOut: account.signedOutAt !== null,
    emails: account.commitEmails.length > 1 ? account.commitEmails : [],
  }));
