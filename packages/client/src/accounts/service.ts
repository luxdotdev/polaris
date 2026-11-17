/**
 * `Accounts`: a Client's Polaris accounts (ADR 0112), each on its own Account Server. Signs in
 * with PKCE through the platform's browser or with a device code, keeps each session token in
 * the app's secret store, and is what sharing asks for statements and Invites.
 */
import {
  Context,
  Effect,
  Fiber,
  Layer,
  Option,
  Schedule,
  type Scope,
  Semaphore,
  SubscriptionRef,
} from "effect";
import {
  type AcceptedInvite,
  type AcceptingDevice,
  AccountsError,
  type CreatedInvite,
  type Me,
  type NewInvite,
  type PendingInvite,
  type Person,
} from "./contract.ts";
import { type AccountServer, accountServer, type Fetch } from "./http.ts";
import {
  accountServerOrigin,
  pkceSecrets,
  newAccountId,
  signInUrl,
  verificationUriOn,
} from "./server.ts";
import { type AccountRecord, type AccountsFile, type AccountStore } from "./store.ts";

/** How one sign-in reaches a browser and comes back: a loopback listener, or the OS's auth session. */
export interface Authorizer {
  /** Where the Account Server sends the browser back: `http://127.0.0.1:<port>/…` or `polaris://…`. */
  readonly redirectUri: string;
  /** Opens `url` in a browser; succeeds with the URL the browser was sent back to. */
  readonly open: (url: string) => Effect.Effect<string, AccountsError>;
}

/** A device-code sign-in in progress: the code to type on a signed-in browser. */
export interface DeviceSignIn {
  readonly server: string;
  readonly userCode: string;
  readonly verificationUri: string;
  /** Epoch ms. */
  readonly expiresAt: number;
  /** Null while waiting; why it stopped otherwise. */
  readonly failure: string | null;
}

export interface AccountsState {
  readonly storageAvailable: boolean;
  readonly accounts: ReadonlyArray<AccountRecord>;
  /** A Workspace's key (`hostKey/workspaceId`) to its sharing Account's id. */
  readonly workspaces: Readonly<Record<string, string>>;
  readonly deviceSignIn: DeviceSignIn | null;
}

export interface AccountsInput {
  readonly store: AccountStore;
  readonly fetch: Fetch;
  /** The device flow's `client_id`: which app asks (`polaris-desktop`, `polaris-mobile`). */
  readonly clientId: string;
  readonly now?: () => number;
  /** The device flow's shortest poll interval; the contract's 5 s unless a test says otherwise. */
  readonly devicePollFloorS?: number;
}

/** A Workspace's key in `AccountsState.workspaces`. */
export const workspaceAccountKey = (hostKey: string, workspaceId: string) =>
  `${hostKey}/${workspaceId}`;

const unknownAccount = (id: string) =>
  new AccountsError({ reason: "unknown-account", message: `no Polaris account ${id} here` });

const signInFailed = (message: string) => new AccountsError({ reason: "sign-in-failed", message });

/** The `code` from the browser's return to `redirectUri`, once `state` matches. */
export const codeFromRedirect = (returned: string, state: string) => {
  if (!URL.canParse(returned)) return Effect.fail(signInFailed("the sign-in didn't come back"));
  const params = new URL(returned).searchParams;
  const code = params.get("code");

  if (params.get("state") !== state) return Effect.fail(signInFailed("the sign-in didn't match"));

  if (code === null || code === "")
    return Effect.fail(signInFailed(params.get("error") ?? "the sign-in returned no code"));

  return Effect.succeed(code);
};

const recordFrom = (id: string, server: string, me: Me, now: number): AccountRecord => ({
  id,
  server,
  personId: me.personId,
  login: me.login,
  name: me.name,
  avatarUrl: me.avatarUrl,
  commitEmail: me.commitEmail,
  commitEmails: me.commitEmails,
  signedInAt: now,
  signedOutAt: null,
});

const withoutAccount = (file: AccountsFile, id: string): AccountsFile => ({
  accounts: file.accounts.filter((a) => a.id !== id),
  workspaces: Object.fromEntries(Object.entries(file.workspaces).filter(([, a]) => a !== id)),
});

const replaced = (file: AccountsFile, record: AccountRecord): AccountsFile => {
  const at = file.accounts.findIndex((a) => a.id === record.id);

  return {
    ...file,
    accounts:
      at === -1 ? [...file.accounts, record] : file.accounts.map((a, i) => (i === at ? record : a)),
  };
};

const make = Effect.fn("Accounts.make")(function* (input: AccountsInput) {
  const { store } = input;
  const now = input.now ?? Date.now;
  const scope = yield* Effect.scope;
  const lock = yield* Semaphore.make(1);
  const initial = yield* Effect.orElseSucceed(store.read, () => ({ accounts: [], workspaces: {} }));

  const state = yield* SubscriptionRef.make<AccountsState>({
    storageAvailable: yield* store.available,
    ...initial,
    deviceSignIn: null,
  });

  let device: Fiber.Fiber<void> | undefined;

  const servers = new Map<string, AccountServer>();

  const serverAt = (origin: string) => {
    const known = servers.get(origin);

    if (known !== undefined) return known;
    const made = accountServer(input.fetch, origin);
    servers.set(origin, made);

    return made;
  };

  /** Applies `change` to the stored list under the lock, then publishes it. */
  const commit = (change: (file: AccountsFile) => AccountsFile) =>
    lock.withPermit(
      Effect.gen(function* () {
        const next = change(yield* store.read);
        yield* store.write(next);
        yield* SubscriptionRef.update(state, (s) => ({ ...s, ...next }));

        return next;
      })
    );

  const recordOf = (id: string) =>
    Effect.flatMap(SubscriptionRef.get(state), (s) =>
      Option.match(Option.fromUndefinedOr(s.accounts.find((a) => a.id === id)), {
        onNone: () => Effect.fail(unknownAccount(id)),
        onSome: Effect.succeed,
      })
    );

  /** A server's refusal of the session marks the Account signed out and forgets its token. */
  const markSignedOut = (id: string) =>
    Effect.andThen(
      store.deleteToken(id),
      Effect.ignore(
        commit((file) => ({
          ...file,
          accounts: file.accounts.map((a) =>
            a.id === id && a.signedOutAt === null ? { ...a, signedOutAt: now() } : a
          ),
        }))
      )
    );

  const signedOutError = (record: AccountRecord) =>
    new AccountsError({
      reason: "signed-out",
      message: `${record.login} on ${record.server} is signed out`,
    });

  /** Runs `use` with the Account's server and token. */
  const withToken = <A>(
    id: string,
    use: (server: AccountServer, token: string) => Effect.Effect<A, AccountsError>
  ) =>
    Effect.gen(function* () {
      const record = yield* recordOf(id);
      const token = yield* store.token(id);

      if (record.signedOutAt !== null || Option.isNone(token)) return yield* signedOutError(record);

      return yield* use(serverAt(record.server), token.value).pipe(
        Effect.tapError((error) =>
          error.reason === "signed-out" ? markSignedOut(id) : Effect.void
        )
      );
    });

  /** Keeps the session and the person it signs in, as a new Account or the one already here. */
  const adopt = Effect.fn("Accounts.adopt")(function* (server: string, token: string) {
    const me = yield* serverAt(server).me(token);
    const { accounts } = yield* SubscriptionRef.get(state);
    const existing = accounts.find((a) => a.server === server && a.personId === me.personId);
    const record = recordFrom(existing?.id ?? newAccountId(), server, me, now());

    yield* store.setToken(record.id, token);
    yield* commit((file) => replaced(file, record));

    return record;
  });

  const signIn = Effect.fn("Accounts.signIn")(function* (
    server: string,
    authorizer: Effect.Effect<Authorizer, AccountsError, Scope.Scope>
  ) {
    const origin = yield* accountServerOrigin(server);
    const pkce = yield* pkceSecrets;

    const code = yield* Effect.scoped(
      Effect.gen(function* () {
        const auth = yield* authorizer;
        const returned = yield* auth.open(signInUrl(origin, auth.redirectUri, pkce));

        return yield* codeFromRedirect(returned, pkce.state);
      })
    );

    const token = yield* serverAt(origin).exchangeCode(code, pkce.verifier);

    return yield* adopt(origin, token);
  });

  const setDevice = (deviceSignIn: DeviceSignIn | null) =>
    SubscriptionRef.update(state, (s) => ({ ...s, deviceSignIn }));

  const cancelDeviceSignIn = Effect.gen(function* () {
    const running = device;
    device = undefined;

    if (running !== undefined) yield* Fiber.interrupt(running);
    yield* setDevice(null);
  });

  const pollDevice = (flow: DeviceSignIn, deviceCode: string, intervalS: number) =>
    serverAt(flow.server)
      .deviceToken(deviceCode, input.clientId)
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail("pending" as const),
            onSome: Effect.succeed,
          })
        ),
        Effect.retry({
          while: (error) => error === "pending" && now() < flow.expiresAt,
          schedule: Schedule.spaced(`${Math.max(intervalS, input.devicePollFloorS ?? 5)} seconds`),
        }),
        Effect.flatMap((token) =>
          token === "pending"
            ? Effect.fail(signInFailed("the code expired"))
            : adopt(flow.server, token)
        ),
        Effect.matchEffect({
          onSuccess: () => setDevice(null),
          onFailure: (error) =>
            setDevice({
              ...flow,
              failure: error === "pending" ? "The code expired" : error.message,
            }),
        })
      );

  const startDeviceSignIn = Effect.fn("Accounts.startDeviceSignIn")(function* (server: string) {
    yield* cancelDeviceSignIn;
    const origin = yield* accountServerOrigin(server);
    const started = yield* serverAt(origin).deviceCode(input.clientId);
    const verificationUri = yield* verificationUriOn(origin, started.verification_uri_complete);

    const flow: DeviceSignIn = {
      server: origin,
      userCode: started.user_code,
      verificationUri,
      expiresAt: now() + started.expires_in * 1000,
      failure: null,
    };

    yield* setDevice(flow);
    device = yield* Effect.forkIn(
      pollDevice(flow, started.device_code, started.interval ?? 5),
      scope
    );

    return flow;
  });

  const signOut = Effect.fn("Accounts.signOut")(function* (id: string) {
    const record = yield* recordOf(id);
    const token = yield* Effect.orElseSucceed(store.token(id), () => Option.none<string>());

    // Signing out on the server also takes this session's devices off their Shares.
    if (Option.isSome(token)) yield* Effect.ignore(serverAt(record.server).signOut(token.value));
    yield* store.deleteToken(id);
    yield* commit((file) => withoutAccount(file, id));
  });

  const keepMe = (id: string) => (me: Me) =>
    Effect.flatMap(recordOf(id), (record) =>
      commit((file) =>
        replaced(file, {
          ...recordFrom(id, record.server, me, record.signedInAt),
          signedOutAt: null,
        })
      )
    );

  return {
    state,
    list: Effect.map(SubscriptionRef.get(state), (s) => s.accounts),
    signIn,
    startDeviceSignIn,
    cancelDeviceSignIn,
    signOut,
    /** Reads the person again (login, name, avatar, commit email) from the Account Server. */
    refresh: (id: string) =>
      withToken(id, (server, token) => server.me(token)).pipe(Effect.tap(keepMe(id))),
    setCommitEmail: (id: string, commitEmail: string) =>
      withToken(id, (server, token) => server.setCommitEmail(token, commitEmail)).pipe(
        Effect.tap(keepMe(id))
      ),
    /** A 15-minute statement binding this person to the device whose relay key is `noiseKey`. */
    statementFor: (id: string, noiseKey: string): Effect.Effect<string, AccountsError> =>
      withToken(id, (server, token) => server.statement(token, noiseKey)),
    person: (id: string, login: string): Effect.Effect<Person, AccountsError> =>
      withToken(id, (server, token) => server.person(token, login)),
    invites: (id: string): Effect.Effect<ReadonlyArray<PendingInvite>, AccountsError> =>
      withToken(id, (server, token) => server.invites(token)),
    accept: (
      id: string,
      inviteId: string,
      device: AcceptingDevice
    ): Effect.Effect<AcceptedInvite, AccountsError> =>
      withToken(id, (server, token) => server.accept(token, inviteId, device)),
    decline: (id: string, inviteId: string): Effect.Effect<void, AccountsError> =>
      withToken(id, (server, token) => server.decline(token, inviteId)),
    createInvite: (id: string, invite: NewInvite): Effect.Effect<CreatedInvite, AccountsError> =>
      withToken(id, (server, token) => server.createInvite(token, invite)),
    /** Withdraws an Invite the Host refused to record a Share for; its capability is the key. */
    withdrawInvite: (
      id: string,
      invite: Pick<CreatedInvite, "inviteId" | "hostCapability">
    ): Effect.Effect<void, AccountsError> =>
      Effect.flatMap(recordOf(id), (record) =>
        serverAt(record.server).withdrawInvite(invite.inviteId, invite.hostCapability)
      ),
    /** The Account a Workspace is shared as, or None until its first Share sets it. */
    workspaceAccount: (workspace: string) =>
      Effect.map(SubscriptionRef.get(state), (s) =>
        Option.fromUndefinedOr(s.workspaces[workspace])
      ),
    /** Null forgets the Workspace's sharing Account. */
    setWorkspaceAccount: (workspace: string, id: string | null) =>
      Effect.gen(function* () {
        if (id !== null) yield* recordOf(id);
        yield* commit((file) => {
          const { [workspace]: _dropped, ...rest } = file.workspaces;

          return { ...file, workspaces: id === null ? rest : { ...rest, [workspace]: id } };
        });
      }),
  };
});

export type AccountsApi = Effect.Success<ReturnType<typeof make>>;

export class Accounts extends Context.Service<Accounts, AccountsApi>()("polaris/client/Accounts") {
  static readonly layer = (input: AccountsInput) => Layer.effect(Accounts, make(input));
}
