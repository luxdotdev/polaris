/**
 * Polaris accounts as React state (ENG-944): one `Accounts` from `@polaris/client/accounts` for
 * the app's life, its tokens in the Keychain. Each action resolves with the failure's copy, or null.
 */
import { Accounts, type AccountsError, type AccountsState } from "@polaris/client/accounts";
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import { Effect, Fiber, ManagedRuntime, Stream, SubscriptionRef } from "effect";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { authSession } from "./authorizer.ts";
import { secureStoreKeychain } from "./keychain.ts";
import { keychainAccountStore } from "./store.ts";

export interface PolarisAccounts {
  /** Null until the Keychain was read. */
  readonly state: AccountsState | null;
  /** Whether this build can sign in in a browser sheet; without it only the code works. */
  readonly canUseBrowser: boolean;
  /** Polaris Cloud's Account Server unless `server` names another. */
  readonly signIn: (server?: string) => Promise<string | null>;
  readonly signInWithCode: (server?: string) => Promise<string | null>;
  readonly cancelCode: () => Promise<string | null>;
  readonly signOut: (id: string) => Promise<string | null>;
  readonly setCommitEmail: (id: string, email: string) => Promise<string | null>;
}

const AccountsContext = createContext<PolarisAccounts | null>(null);

const makeRuntime = () =>
  ManagedRuntime.make(
    Accounts.layer({
      store: keychainAccountStore(secureStoreKeychain),
      fetch: (url, init) => globalThis.fetch(url, init),
      clientId: "polaris-mobile",
    })
  );

/** What a failure says in Settings; a cancelled sheet says nothing. */
const failureCopy = (error: AccountsError) =>
  error.reason === "sign-in-failed" && error.message === "cancelled" ? null : error.message;

export const AccountsProvider = ({ children }: { readonly children: ReactNode }) => {
  const [runtime] = useState(makeRuntime);
  const [state, setState] = useState<AccountsState | null>(null);

  useEffect(() => {
    const fiber = runtime.runFork(
      Effect.flatMap(Accounts, (accounts) =>
        SubscriptionRef.changes(accounts.state).pipe(
          Stream.runForEach((next) => Effect.sync(() => setState(next)))
        )
      )
    );

    return () => void runtime.runFork(Fiber.interrupt(fiber));
  }, [runtime]);

  useEffect(() => () => void runtime.dispose(), [runtime]);

  const value = useMemo((): PolarisAccounts => {
    const browser = authSession;

    const act = <A,>(use: (accounts: Accounts["Service"]) => Effect.Effect<A, AccountsError>) =>
      runtime.runPromise(
        Effect.flatMap(Accounts, use).pipe(
          Effect.as(null),
          Effect.catch((error) => Effect.succeed(failureCopy(error)))
        )
      );

    return {
      state,
      canUseBrowser: authSession !== null,
      signIn: (server = POLARIS_CLOUD_ACCOUNTS_URL) =>
        browser === null
          ? Promise.resolve("This build can't open a sign-in sheet; use a code instead")
          : act((a) => a.signIn(server, browser)),
      signInWithCode: (server = POLARIS_CLOUD_ACCOUNTS_URL) =>
        act((a) => a.startDeviceSignIn(server)),
      cancelCode: () => act((a) => a.cancelDeviceSignIn),
      signOut: (id) => act((a) => a.signOut(id)),
      setCommitEmail: (id, email) => act((a) => a.setCommitEmail(id, email)),
    };
  }, [runtime, state]);

  return <AccountsContext.Provider value={value}>{children}</AccountsContext.Provider>;
};

export const usePolarisAccounts = (): PolarisAccounts => {
  const accounts = useContext(AccountsContext);

  if (accounts === null) throw new Error("usePolarisAccounts outside AccountsProvider");

  return accounts;
};
