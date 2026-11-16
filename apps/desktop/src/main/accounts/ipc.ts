/** The `accounts.*` requests and feed behind the typed bridge. Session tokens never cross it. */
import { Effect, Stream, SubscriptionRef } from "effect";
import type {
  AccountsRequestInputs,
  AccountsSubscriptionInputs,
} from "../../shared/accountsContract.ts";
import { toIpcError } from "../hosts.ts";
import type { Feed } from "../ipc/feeds.ts";
import type { Handler } from "../ipc/requests.ts";
import { DesktopAccounts } from "./index.ts";

const use = <A, E extends { readonly _tag: string; readonly message: string }>(
  run: (accounts: DesktopAccounts["Service"]) => Effect.Effect<A, E>
) => DesktopAccounts.use(run).pipe(Effect.mapError(toIpcError), Effect.as(null));

type AccountsHandlers = { readonly [M in keyof typeof AccountsRequestInputs]: Handler<M> };

export const accountsHandlers: AccountsHandlers = {
  "accounts.signIn.start": ({ server }) => use((a) => a.signIn(server)),
  "accounts.signIn.device": ({ server }) => use((a) => a.signInWithCode(server)),
  "accounts.signIn.cancel": () => use((a) => a.cancel),
  "accounts.signOut": ({ accountId }) => use((a) => a.signOut(accountId)),
  "accounts.commitEmail.set": ({ accountId, commitEmail }) =>
    use((a) => a.setCommitEmail(accountId, commitEmail)),
  "accounts.workspace.set": ({ workspace, accountId }) =>
    use((a) => a.setWorkspace(workspace.hostKey, workspace.workspaceId, accountId)),
};

type AccountsOpeners = {
  readonly [K in keyof typeof AccountsSubscriptionInputs]: () => Feed<K>;
};

export const accountsOpeners: AccountsOpeners = {
  accounts: () => Stream.unwrap(DesktopAccounts.useSync((a) => SubscriptionRef.changes(a.view))),
};
