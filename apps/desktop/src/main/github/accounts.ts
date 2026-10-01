/**
 * The signed-in GitHub accounts on github.com and any GitHub Enterprise hosts:
 * adding one through its host's device flow, removing and ordering them, the hosts
 * themselves, and the owner and Workspace routing. Tokens never leave the main process.
 */
import { Clock, Effect, Fiber, Option, Ref, Scope, SubscriptionRef } from "effect";
import {
  GITHUB_HOST,
  GITHUB_SCOPES,
  normalizeHost,
  ownerKey,
  type SignInFailure,
  type SignInView,
} from "../../shared/github.ts";
import { hostsOf, idFor, viewOf, withAccount, withoutAccounts } from "./accountFile.ts";
import { type EndpointConfig, endpointsFor, type GitHubEndpoints } from "./config.ts";
import type { Credentials } from "./credentials.ts";
import { pollStep } from "./deviceFlow.ts";
import { GitHubAuthError, GitHubInvalidHost, GitHubStorageError } from "./errors.ts";
import type { AccountsFile, HostRecord, Store, TokenPair } from "./store.ts";
import type { Transport } from "./transport.ts";
import { DeviceCode, TokenResponse, User } from "./wire.ts";

export interface AccountsInput {
  readonly store: Store;
  readonly transport: Transport;
  readonly endpoints: EndpointConfig;
  readonly scope: Scope.Scope;
}

/** What calling as an account needs from its host. */
export interface HostAccess {
  readonly host: string;
  readonly clientId: string;
  readonly endpoints: GitHubEndpoints;
}

/** An Enterprise host as Settings adds it: the host (or its URL) and its OAuth App's client id. */
export interface NewHost {
  readonly host: string;
  readonly clientId: string;
}

const CLIENT_ID = /^[A-Za-z0-9._-]{4,64}$/;

export const openAccounts = Effect.fn("openAccounts")(function* (input: AccountsInput) {
  const { store, transport, endpoints: config, scope } = input;
  const file = yield* Ref.make(yield* store.readAccounts);
  const signIn = yield* Ref.make<SignInView | null>(null);
  const storageAvailable = yield* store.available;

  const view = yield* SubscriptionRef.make(
    viewOf({ file: yield* Ref.get(file), signIn: null, storageAvailable, config })
  );

  let flow: Fiber.Fiber<void> | null = null;

  const publish = Effect.gen(function* () {
    yield* SubscriptionRef.set(
      view,
      viewOf({
        file: yield* Ref.get(file),
        signIn: yield* Ref.get(signIn),
        storageAvailable,
        config,
      })
    );
  });

  const change = (update: (current: AccountsFile) => AccountsFile) =>
    Effect.gen(function* () {
      const next = update(yield* Ref.get(file));

      yield* Ref.set(file, next);
      yield* store.writeAccounts(next);
      yield* publish;
    });

  const access = (record: HostRecord): HostAccess => ({
    host: record.host,
    clientId: record.clientId,
    endpoints: endpointsFor(config, record.host),
  });

  const hostAccess = (host: string) =>
    Effect.flatMap(Ref.get(file), (f) => {
      const record = hostsOf(f).find((h) => h.host === host);

      return record === undefined
        ? Effect.fail(
            new GitHubInvalidHost({ host, message: `${host} isn't a GitHub host Polaris knows.` })
          )
        : Effect.succeed(access(record));
    });

  /** The host an account calls, for its client id and endpoints. */
  const accessOf = (accountId: number) =>
    Effect.flatMap(Ref.get(file), (f) => {
      const host = f.accounts.find((a) => a.id === accountId)?.host;
      const record = hostsOf(f).find((h) => h.host === host);

      return record === undefined
        ? Effect.fail(new GitHubAuthError({ accountId, message: "no such account" }))
        : Effect.succeed(access(record));
    });

  const setSignIn = (next: SignInView | null) => Effect.andThen(Ref.set(signIn, next), publish);

  const failSignIn = (failure: SignInFailure) =>
    Effect.gen(function* () {
      const current = yield* Ref.get(signIn);

      if (current !== null) yield* setSignIn({ ...current, state: "failed", failure });
    });

  /** Signed out: the first time records when. */
  const signedOut = (accountId: number) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      yield* change((current) => ({
        ...current,
        accounts: current.accounts.map((a) =>
          a.id === accountId && !a.signedOut ? { ...a, signedOut: true, signedOutAt: now } : a
        ),
      }));
    }).pipe(Effect.ignore);

  /** Stores a new account (or signs an existing one back in) with its first tokens. */
  const welcome = (
    host: HostAccess,
    tokens: TokenPair,
    scopes: ReadonlyArray<string>,
    credentials: Credentials
  ) =>
    Effect.gen(function* () {
      const caller = { accountId: 0, token: tokens.accessToken, endpoints: host.endpoints };

      const user = yield* transport.rest(caller, User, {
        method: "GET",
        path: "/user",
        etag: null,
        body: null,
      });

      if (user.status !== "ok")
        return yield* Effect.fail(new GitHubStorageError({ message: "no user" }));

      const id = idFor(yield* Ref.get(file), host.host, user.value.id);
      const now = yield* Clock.currentTimeMillis;

      yield* credentials.put(id, tokens);
      yield* change((current) =>
        withAccount(current, {
          id,
          host: host.host,
          userId: id === user.value.id && host.host === GITHUB_HOST ? null : user.value.id,
          login: user.value.login,
          name: user.value.name,
          avatarUrl: user.value.avatar_url,
          scopes,
          signedOut: false,
          signedInAt: now,
          signedOutAt: null,
        })
      );
    });

  const finish = (
    host: HostAccess,
    tokens: TokenPair,
    scopes: ReadonlyArray<string>,
    credentials: Credentials
  ) =>
    Effect.gen(function* () {
      yield* welcome(host, tokens, scopes, credentials).pipe(
        Effect.catch(() => failSignIn("network"))
      );

      const s = yield* Ref.get(signIn);

      if (s?.state !== "failed") yield* setSignIn(null);
    });

  const poll = (host: HostAccess, code: DeviceCode, credentials: Credentials) =>
    Effect.gen(function* () {
      let interval = code.interval;
      const expiresAt = (yield* Clock.currentTimeMillis) + code.expires_in * 1000;

      while ((yield* Clock.currentTimeMillis) < expiresAt) {
        yield* Effect.sleep(`${interval} seconds`);

        const response = yield* transport
          .oauth(host.endpoints, "/login/oauth/access_token", TokenResponse, {
            client_id: host.clientId,
            device_code: code.device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          })
          .pipe(Effect.orElseSucceed((): TokenResponse => ({ error: "authorization_pending" })));

        const step = pollStep(response, interval, yield* Clock.currentTimeMillis);

        if (step.kind === "fail") return yield* failSignIn(step.failure);

        if (step.kind === "done") return yield* finish(host, step.tokens, step.scopes, credentials);
        interval = step.interval;
      }

      return yield* failSignIn("expired");
    });

  const cancelSignIn = Effect.gen(function* () {
    if (flow !== null) yield* Fiber.interrupt(flow);
    flow = null;
    yield* setSignIn(null);
  });

  /** Starts a device flow on `host`: the view shows its code until it succeeds, fails or is cancelled. */
  const startSignIn = (credentials: Credentials, hostName: string = GITHUB_HOST) =>
    Effect.gen(function* () {
      yield* cancelSignIn;

      if (!storageAvailable) {
        return yield* Effect.fail(
          new GitHubStorageError({ message: "this Mac can't store GitHub tokens safely" })
        );
      }

      const host = yield* hostAccess(hostName);

      const code = yield* transport.oauth(host.endpoints, "/login/device/code", DeviceCode, {
        client_id: host.clientId,
        scope: GITHUB_SCOPES.join(" "),
      });

      const started: SignInView = {
        flowId: code.device_code.slice(-8),
        host: host.host,
        userCode: code.user_code,
        verificationUri: code.verification_uri,
        expiresAt: (yield* Clock.currentTimeMillis) + code.expires_in * 1000,
        state: "waiting",
        failure: null,
      };

      yield* setSignIn(started);
      flow = yield* Effect.forkIn(poll(host, code, credentials), scope);

      return started;
    });

  const removeAll = (ids: ReadonlyArray<number>, credentials: Credentials) =>
    Effect.andThen(
      Effect.forEach(ids, credentials.forget, { discard: true }),
      change((current) => withoutAccounts(current, ids))
    );

  /** Adds (or updates the client id of) a GitHub Enterprise host. */
  const addHost = (added: NewHost) =>
    Effect.gen(function* () {
      const host = normalizeHost(added.host);

      if (host === null) {
        return yield* Effect.fail(
          new GitHubInvalidHost({
            host: added.host,
            message: "Enter the GitHub Enterprise host, like github.acme.com.",
          })
        );
      }

      if (!CLIENT_ID.test(added.clientId.trim())) {
        return yield* Effect.fail(
          new GitHubInvalidHost({
            host,
            message: "Enter the client ID of the OAuth App registered on that host.",
          })
        );
      }

      yield* change((current) => ({
        ...current,
        hosts: [
          ...current.hosts.filter((h) => h.host !== host),
          { host, clientId: added.clientId.trim() },
        ],
      }));

      return host;
    });

  /** Removes an Enterprise host with its accounts and their tokens. */
  const removeHost = (host: string, credentials: Credentials) =>
    Effect.gen(function* () {
      const ids = (yield* Ref.get(file)).accounts.filter((a) => a.host === host).map((a) => a.id);

      yield* removeAll(ids, credentials);
      yield* change((current) => ({
        ...current,
        hosts: current.hosts.filter((h) => h.host !== host),
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
    /** The Enterprise hosts, for parsing remotes and pull request URLs. */
    hostNames: Effect.map(Ref.get(file), (f) => f.hosts.map((h) => h.host)),
    accessOf,
    hostAccess,
    signedOut,
    startSignIn,
    cancelSignIn,
    remove: (accountId: number, credentials: Credentials) => removeAll([accountId], credentials),
    reorder,
    addHost,
    removeHost,
    setOwner: (owner: string, accountId: number | null, host: string = GITHUB_HOST) =>
      setPreference("owners", ownerKey(host, owner), accountId),
    setWorkspace: (key: string, accountId: number | null) =>
      setPreference("workspaces", key, accountId),
  };
});

export type Accounts = Effect.Success<ReturnType<typeof openAccounts>>;
