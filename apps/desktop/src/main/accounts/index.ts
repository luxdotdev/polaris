/**
 * `DesktopAccounts`: the Desktop App's Polaris accounts (ENG-944) on `@polaris/client`'s
 * `Accounts`: sign-in through the system browser and a loopback return, tokens in
 * `SecureStorage`, avatars fetched here, and the view Settings shows. See README.md.
 */
import { join } from "node:path";
import { POLARIS_CLOUD_ACCOUNTS_URL } from "@polaris/protocol";
import {
  type AccountRecord,
  Accounts,
  type AccountsState,
  isPolarisCloud,
  workspaceAccountKey,
} from "@polaris/client/accounts";
import { Context, Effect, Fiber, Layer, Stream, SubscriptionRef } from "effect";
import type {
  AccountSignInView,
  PolarisAccountsView,
  PolarisAccountView,
} from "../../shared/accountsContract.ts";
import type { InternetFetch } from "../net.ts";
import { SecureStorage } from "../secure/index.ts";
import { avatarCache } from "./avatars.ts";
import { loopbackAuthorizer } from "./loopback.ts";
import { desktopAccountStore } from "./store.ts";

export interface DesktopAccountsInput {
  /** `<userData>/accounts`. */
  readonly dir: string;
  readonly fetch: InternetFetch;
  readonly openExternal: (url: string) => Promise<void>;
}

interface Local {
  readonly browser: string | null;
  readonly failure: PolarisAccountsView["failure"];
}

const serverLabel = (server: string) =>
  isPolarisCloud(server) ? "Polaris Cloud" : new URL(server).host;

const accountView = (record: AccountRecord, avatar: string | null): PolarisAccountView => ({
  id: record.id,
  server: record.server,
  serverLabel: serverLabel(record.server),
  isPolarisCloud: isPolarisCloud(record.server),
  login: record.login,
  name: record.name,
  avatar,
  commitEmail: record.commitEmail,
  commitEmails: record.commitEmails,
  signedInAt: record.signedInAt,
  signedOutAt: record.signedOutAt,
});

const signInView = (state: AccountsState, local: Local): AccountSignInView | null => {
  if (local.browser !== null) return { kind: "browser", server: local.browser };
  const device = state.deviceSignIn;

  return device === null ? null : { kind: "device", ...device };
};

const make = Effect.fn("DesktopAccounts.make")(function* (input: DesktopAccountsInput) {
  const accounts = yield* Accounts;
  const scope = yield* Effect.scope;
  const avatars = avatarCache(join(input.dir, "avatars"), input.fetch);
  const local = yield* SubscriptionRef.make<Local>({ browser: null, failure: null });

  const view = yield* SubscriptionRef.make<PolarisAccountsView>({
    storageAvailable: false,
    accounts: [],
    workspaces: {},
    signIn: null,
    failure: null,
  });

  let browser: Fiber.Fiber<unknown, unknown> | undefined;

  const publish: Effect.Effect<void> = Effect.gen(function* () {
    const state = yield* SubscriptionRef.get(accounts.state);
    const mine = yield* SubscriptionRef.get(local);

    yield* SubscriptionRef.set(view, {
      storageAvailable: state.storageAvailable,
      accounts: state.accounts.map((a) => accountView(a, avatars.get(a.id, a.avatarUrl))),
      workspaces: state.workspaces,
      signIn: signInView(state, mine),
      failure: mine.failure,
    });

    const missing = state.accounts.filter((a) => avatars.missing(a.id, a.avatarUrl));

    if (missing.length > 0)
      yield* Effect.forkIn(
        Effect.forEach(missing, (a) => avatars.load(a.id, a.avatarUrl), { discard: true }).pipe(
          Effect.andThen(Effect.suspend(() => publish))
        ),
        scope
      );
  });

  const setLocal = (next: Local) => Effect.andThen(SubscriptionRef.set(local, next), publish);

  const cancel = Effect.gen(function* () {
    const running = browser;
    browser = undefined;

    if (running !== undefined) yield* Fiber.interrupt(running);
    yield* accounts.cancelDeviceSignIn;
    yield* setLocal({ browser: null, failure: null });
  });

  const failedAt = (server: string) => (message: string) =>
    setLocal({ browser: null, failure: { server, message } });

  const signIn = Effect.fn("DesktopAccounts.signIn")(function* (server: string) {
    yield* cancel;
    yield* setLocal({ browser: server, failure: null });

    browser = yield* Effect.forkIn(
      accounts.signIn(server, loopbackAuthorizer(input.openExternal)).pipe(
        Effect.matchEffect({
          onSuccess: () => setLocal({ browser: null, failure: null }),
          onFailure: (error) => failedAt(server)(error.message),
        })
      ),
      scope
    );
  });

  const signInWithCode = Effect.fn("DesktopAccounts.signInWithCode")(function* (server: string) {
    yield* cancel;
    yield* accounts
      .startDeviceSignIn(server)
      .pipe(Effect.catch((error) => failedAt(server)(error.message)));
  });

  yield* Effect.forkIn(
    SubscriptionRef.changes(accounts.state).pipe(Stream.runForEach(() => publish)),
    scope
  );

  // Catches sessions ended while the app was closed, and new logins or avatars.
  yield* Effect.forkIn(
    Effect.flatMap(accounts.list, (list) =>
      Effect.forEach(
        list.filter((a) => a.signedOutAt === null),
        (a) => Effect.ignore(accounts.refresh(a.id)),
        { concurrency: 4, discard: true }
      )
    ),
    scope
  );

  return {
    view,
    signIn: (server?: string) => signIn(server ?? POLARIS_CLOUD_ACCOUNTS_URL),
    signInWithCode: (server?: string) => signInWithCode(server ?? POLARIS_CLOUD_ACCOUNTS_URL),
    cancel,
    signOut: (id: string) => Effect.andThen(accounts.signOut(id), avatars.forget(id)),
    setCommitEmail: (id: string, email: string) =>
      Effect.asVoid(accounts.setCommitEmail(id, email)),
    setWorkspace: (hostKey: string, workspaceId: string, id: string | null) =>
      accounts.setWorkspaceAccount(workspaceAccountKey(hostKey, workspaceId), id),
  };
});

export class DesktopAccounts extends Context.Service<
  DesktopAccounts,
  Effect.Success<ReturnType<typeof make>>
>()("polaris/desktop/DesktopAccounts") {
  /** `DesktopAccounts` and the `Accounts` it is built on, for sharing to use directly. */
  static readonly layer = (input: DesktopAccountsInput) =>
    Layer.effect(DesktopAccounts, make(input)).pipe(
      Layer.provideMerge(
        Layer.unwrap(
          Effect.gen(function* () {
            const storage = yield* SecureStorage;

            return Accounts.layer({
              store: desktopAccountStore(input.dir, storage),
              fetch: input.fetch,
              clientId: "polaris-desktop",
            });
          })
        )
      )
    );
}
