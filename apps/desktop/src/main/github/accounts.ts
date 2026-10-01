/**
 * The signed-in GitHub accounts: adding one through the device flow, removing and
 * ordering them, and the owner and Workspace routing preferences. Publishes the
 * Settings view; tokens never leave the main process.
 */
import { Clock, Effect, Fiber, Option, Ref, Scope, SubscriptionRef } from "effect";
import {
  GITHUB_CLIENT_ID,
  GITHUB_SCOPES,
  type GitHubAccountsView,
  type SignInFailure,
  type SignInView,
} from "../../shared/github.ts";
import { type GitHubEndpoints, manageUrl } from "./config.ts";
import type { Credentials } from "./credentials.ts";
import { missingScopes, pollStep } from "./deviceFlow.ts";
import { GitHubStorageError } from "./errors.ts";
import type { AccountRecord, AccountsFile, Store, TokenPair } from "./store.ts";
import type { Transport } from "./transport.ts";
import { DeviceCode, TokenResponse, User } from "./wire.ts";

export interface AccountsInput {
  readonly store: Store;
  readonly transport: Transport;
  readonly endpoints: GitHubEndpoints;
  readonly scope: Scope.Scope;
}

const viewOf = (
  file: AccountsFile,
  signIn: SignInView | null,
  storageAvailable: boolean,
  endpoints: GitHubEndpoints
): GitHubAccountsView => ({
  accounts: file.accounts.map((a) => ({
    id: a.id,
    login: a.login,
    name: a.name,
    avatarUrl: a.avatarUrl,
    scopes: a.scopes,
    missingScopes: missingScopes(a.scopes),
    state: a.signedOut ? "signed-out" : "ok",
  })),
  signIn,
  owners: file.owners,
  workspaces: file.workspaces,
  storageAvailable,
  manageUrl: manageUrl(endpoints),
});

const withAccount = (file: AccountsFile, record: AccountRecord): AccountsFile => ({
  ...file,
  accounts: file.accounts.some((a) => a.id === record.id)
    ? file.accounts.map((a) => (a.id === record.id ? record : a))
    : [...file.accounts, record],
});

const dropValue = (map: Readonly<Record<string, number>>, id: number) =>
  Object.fromEntries(Object.entries(map).filter(([, v]) => v !== id));

export const openAccounts = Effect.fn("openAccounts")(function* (input: AccountsInput) {
  const { store, transport, endpoints, scope } = input;
  const file = yield* Ref.make(yield* store.readAccounts);
  const signIn = yield* Ref.make<SignInView | null>(null);
  const storageAvailable = yield* store.available;

  const view = yield* SubscriptionRef.make(
    viewOf(yield* Ref.get(file), null, storageAvailable, endpoints)
  );

  let flow: Fiber.Fiber<void> | null = null;

  const publish = Effect.gen(function* () {
    yield* SubscriptionRef.set(
      view,
      viewOf(yield* Ref.get(file), yield* Ref.get(signIn), storageAvailable, endpoints)
    );
  });

  const change = (update: (current: AccountsFile) => AccountsFile) =>
    Effect.gen(function* () {
      const next = update(yield* Ref.get(file));

      yield* Ref.set(file, next);
      yield* store.writeAccounts(next);
      yield* publish;
    });

  const setSignIn = (next: SignInView | null) => Effect.andThen(Ref.set(signIn, next), publish);

  const failSignIn = (failure: SignInFailure) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(signIn);

      if (current !== null) yield* setSignIn({ ...current, state: "failed", failure });
    });

  const signedOut = (accountId: number) =>
    change((current) => ({
      ...current,
      accounts: current.accounts.map((a) => (a.id === accountId ? { ...a, signedOut: true } : a)),
    })).pipe(Effect.ignore);

  /** Stores a new account (or signs an existing one back in) with its first tokens. */
  const welcome = (tokens: TokenPair, scopes: ReadonlyArray<string>, credentials: Credentials) =>
    Effect.gen(function* () {
      const user = yield* transport.rest({ accountId: 0, token: tokens.accessToken }, User, {
        method: "GET",
        path: "/user",
        etag: null,
        body: null,
      });

      if (user.status !== "ok")
        return yield* Effect.fail(new GitHubStorageError({ message: "no user" }));
      yield* credentials.put(user.value.id, tokens);
      yield* change((current) =>
        withAccount(current, {
          id: user.value.id,
          login: user.value.login,
          name: user.value.name,
          avatarUrl: user.value.avatar_url,
          scopes,
          signedOut: false,
        })
      );
    });

  const poll = (code: DeviceCode, credentials: Credentials) =>
    Effect.gen(function* () {
      let interval = code.interval;
      const expiresAt = (yield* Clock.currentTimeMillis) + code.expires_in * 1000;

      while ((yield* Clock.currentTimeMillis) < expiresAt) {
        yield* Effect.sleep(`${interval} seconds`);

        const response = yield* transport
          .oauth("/login/oauth/access_token", TokenResponse, {
            client_id: GITHUB_CLIENT_ID,
            device_code: code.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          })
          .pipe(Effect.orElseSucceed((): TokenResponse => ({ error: "authorization_pending" })));

        const step = pollStep(response, interval, yield* Clock.currentTimeMillis);

        if (step.kind === "fail") return yield* failSignIn(step.failure);

        if (step.kind === "done") {
          yield* welcome(step.tokens, step.scopes, credentials).pipe(
            Effect.catch(() => failSignIn("network"))
          );

          return yield* Ref.get(signIn).pipe(
            Effect.flatMap((s) => (s?.state === "failed" ? Effect.void : setSignIn(null)))
          );
        }

        interval = step.interval;
      }

      return yield* failSignIn("expired");
    });

  const cancelSignIn = Effect.gen(function* () {
    if (flow !== null) yield* Fiber.interrupt(flow);
    flow = null;
    yield* setSignIn(null);
  });

  /** Starts a device flow: the view shows its code until it succeeds, fails or is cancelled. */
  const startSignIn = (credentials: Credentials) =>
    Effect.gen(function* () {
      yield* cancelSignIn;

      if (!storageAvailable) {
        return yield* Effect.fail(
          new GitHubStorageError({ message: "this Mac can't store GitHub tokens safely" })
        );
      }

      const code = yield* transport.oauth("/login/device/code", DeviceCode, {
        client_id: GITHUB_CLIENT_ID,
        scope: GITHUB_SCOPES.join(" "),
      });

      const started: SignInView = {
        flowId: code.device_code.slice(-8),
        userCode: code.user_code,
        verificationUri: code.verification_uri,
        expiresAt: (yield* Clock.currentTimeMillis) + code.expires_in * 1000,
        state: "waiting",
        failure: null,
      };

      yield* setSignIn(started);
      flow = yield* Effect.forkIn(poll(code, credentials), scope);

      return started;
    });

  const remove = (accountId: number, credentials: Credentials) =>
    Effect.gen(function* () {
      yield* credentials.forget(accountId);
      yield* change((current) => ({
        accounts: current.accounts.filter((a) => a.id !== accountId),
        owners: dropValue(current.owners, accountId),
        workspaces: dropValue(current.workspaces, accountId),
      }));
    });

  const reorder = (ids: ReadonlyArray<number>) =>
    change((current) => ({
      ...current,
      accounts: [
        ...ids.flatMap((id) => current.accounts.filter((a) => a.id === id)),
        ...current.accounts.filter((a) => !ids.includes(a.id)),
      ],
    }));

  const setPreference = (map: "owners" | "workspaces", key: string, accountId: number | null) =>
    change((current) => {
      const { [key]: _previous, ...rest } = current[map];

      return { ...current, [map]: accountId === null ? rest : { ...rest, [key]: accountId } };
    });

  return {
    view,
    file: Ref.get(file),
    /** The accounts that can make calls, in the user's order. */
    active: Effect.map(Ref.get(file), (f) => f.accounts.filter((a) => !a.signedOut)),
    find: (accountId: number) =>
      Effect.map(Ref.get(file), (f) =>
        Option.fromUndefinedOr(f.accounts.find((a) => a.id === accountId))
      ),
    signedOut,
    startSignIn,
    cancelSignIn,
    remove,
    reorder,
    setOwner: (owner: string, accountId: number | null) =>
      setPreference("owners", owner.toLowerCase(), accountId),
    setWorkspace: (key: string, accountId: number | null) =>
      setPreference("workspaces", key, accountId),
  };
});

export type Accounts = Effect.Success<ReturnType<typeof openAccounts>>;
