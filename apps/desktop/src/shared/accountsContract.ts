/**
 * The `accounts.*` IPC (ENG-944): Polaris accounts for sharing, kept by the main process.
 * Session tokens never cross the bridge; avatars arrive as data URLs (the CSP blocks remote images).
 */
import { Schema } from "effect";

const AccountId = Schema.String.check(Schema.isPattern(/^[a-z0-9]{1,64}$/));

const WorkspaceRef = Schema.Struct({ hostKey: Schema.String, workspaceId: Schema.String });

export const AccountsRequestInputs = {
  /** Signs in through the system browser; `server` is the Account Server, Polaris Cloud's when absent. */
  "accounts.signIn.start": Schema.Struct({ server: Schema.optionalKey(Schema.String) }),
  /** Signs in with a code typed on any signed-in browser instead; the code arrives on `accounts`. */
  "accounts.signIn.device": Schema.Struct({ server: Schema.optionalKey(Schema.String) }),
  "accounts.signIn.cancel": Schema.Struct({}),
  /** Signs out on the Account Server and forgets the Account here. */
  "accounts.signOut": Schema.Struct({ accountId: AccountId }),
  "accounts.commitEmail.set": Schema.Struct({ accountId: AccountId, commitEmail: Schema.String }),
  /** The Account a Workspace is shared as; null forgets it. */
  "accounts.workspace.set": Schema.Struct({
    workspace: WorkspaceRef,
    accountId: Schema.NullOr(AccountId),
  }),
} as const;

export interface PolarisAccountView {
  readonly id: string;
  /** The Account Server's origin. */
  readonly server: string;
  /** "Polaris Cloud", or the server's host. */
  readonly serverLabel: string;
  readonly isPolarisCloud: boolean;
  readonly login: string;
  readonly name: string | null;
  /** A data URL the main process fetched, or null until then (or without an avatar). */
  readonly avatar: string | null;
  readonly commitEmail: string;
  readonly commitEmails: ReadonlyArray<string>;
  readonly signedInAt: number;
  /** Epoch ms when the Account Server ended the session; null while signed in. */
  readonly signedOutAt: number | null;
}

/** A sign-in in progress: in the browser, or with a code. */
export type AccountSignInView =
  | { readonly kind: "browser"; readonly server: string }
  | {
      readonly kind: "device";
      readonly server: string;
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresAt: number;
      readonly failure: string | null;
    };

export interface PolarisAccountsView {
  readonly storageAvailable: boolean;
  readonly accounts: ReadonlyArray<PolarisAccountView>;
  /** `hostKey/workspaceId` to the id of the Account it is shared as. */
  readonly workspaces: Readonly<Record<string, string>>;
  readonly signIn: AccountSignInView | null;
  /** Why the last sign-in failed, until the next one starts. */
  readonly failure: { readonly server: string; readonly message: string } | null;
}

export interface AccountsRequestOutputs {
  "accounts.signIn.start": null;
  "accounts.signIn.device": null;
  "accounts.signIn.cancel": null;
  "accounts.signOut": null;
  "accounts.commitEmail.set": null;
  "accounts.workspace.set": null;
}

export const AccountsSubscriptionInputs = {
  /** The Accounts for Settings, with any sign-in in progress; the whole view on every change. */
  accounts: Schema.Struct({}),
} as const;

export interface AccountsSubscriptionItems {
  accounts: PolarisAccountsView;
}
