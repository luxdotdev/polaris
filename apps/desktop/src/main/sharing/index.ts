/**
 * `DesktopSharing` (ENG-941, ADR 0112): the owner's Shares (`owner.ts`) and a Teammate's Invites
 * and relay Hosts (`teammate.ts`), on `Accounts` and the `HostDirectory`. See README.md.
 */
import { join } from "node:path";
import { Accounts } from "@polaris/client/accounts";
import { POLARIS_CLOUD_RELAY_URL, type SessionId } from "@polaris/protocol";
import { Context, Duration, Effect, Layer, Schedule, Stream, SubscriptionRef } from "effect";
import type { SharedWithMeView } from "../../shared/sharingContract.ts";
import { avatarCache } from "../accounts/avatars.ts";
import { HostDirectory } from "../hosts.ts";
import type { InternetFetch } from "../net.ts";
import { ownerSharing } from "./owner.ts";
import { fileSharedStore, type SharedStore } from "./store.ts";
import { type DeviceKeys, type InvitesByAccount, teammateSharing, withMeView } from "./teammate.ts";
import { TEAMMATE_TURN_LIMIT, teammateHostFeed, teammateHostItems } from "./teammateFeed.ts";
import type { RelayDeviceUnavailable } from "../relayDevice.ts";

export interface DesktopSharingInput {
  /** `<userData>/sharing`. */
  readonly dir: string;
  readonly fetch: InternetFetch;
  readonly deviceKeys: Effect.Effect<DeviceKeys, RelayDeviceUnavailable>;
  readonly store?: SharedStore;
  /** The relay an Invite without one is dialled through; Polaris Cloud's when unset (tests set it). */
  readonly defaultRelayUrl?: string | undefined;
  /** How often signed-in Accounts are asked for Invites while the app runs. */
  readonly invitesEvery?: Duration.Input;
  readonly now?: () => number;
}

const personKey = (login: string) => `p-${login.toLowerCase().replace(/[^a-z0-9-]/g, "")}`;

const make = Effect.fn("DesktopSharing.make")(function* (input: DesktopSharingInput) {
  const hosts = yield* HostDirectory;
  const accounts = yield* Accounts;
  const scope = yield* Effect.scope;
  const now = input.now ?? Date.now;
  const store = input.store ?? fileSharedStore(input.dir);
  const avatars = avatarCache(join(input.dir, "avatars"), input.fetch);
  const wanted = new Map<string, string>();

  const avatar = (login: string, url: string | null) => {
    const key = personKey(login);

    if (url !== null && avatars.missing(key, url)) wanted.set(key, url);

    return avatars.get(key, url);
  };

  /** Loads the avatars asked for since the last load; true when there were any. */
  const loadAvatars = Effect.suspend(() => {
    const batch = [...wanted];
    wanted.clear();

    return Effect.as(
      Effect.forEach(batch, ([key, url]) => avatars.load(key, url), { discard: true }),
      batch.length > 0
    );
  });

  const shared = yield* SubscriptionRef.make(yield* store.read);
  const invites = yield* SubscriptionRef.make<InvitesByAccount>(new Map());

  const view = yield* SubscriptionRef.make<SharedWithMeView>({
    invites: [],
    sessions: [],
    accounts: [],
  });

  const owner = ownerSharing({ hosts, accounts, avatar, loadAvatars, now });

  const teammate = teammateSharing({
    hosts,
    accounts,
    store,
    shared,
    deviceKeys: input.deviceKeys,
    defaultRelayUrl: input.defaultRelayUrl ?? POLARIS_CLOUD_RELAY_URL,
    avatar,
    now,
  });

  const publish: Effect.Effect<void> = Effect.gen(function* () {
    yield* SubscriptionRef.set(
      view,
      withMeView({
        accounts: (yield* SubscriptionRef.get(accounts.state)).accounts,
        invites: yield* SubscriptionRef.get(invites),
        shared: yield* SubscriptionRef.get(shared),
        hosts: yield* SubscriptionRef.get(hosts.views),
        avatar,
      })
    );

    if (wanted.size > 0)
      yield* Effect.forkIn(
        Effect.flatMap(loadAvatars, (loaded) => (loaded ? publish : Effect.void)),
        scope
      );
  });

  const refreshInvites = Effect.flatMap(teammate.fetchInvites, (next) =>
    SubscriptionRef.set(invites, next)
  );

  const signedInIds = Stream.map(SubscriptionRef.changes(accounts.state), (state) =>
    state.accounts
      .filter((a) => a.signedOutAt === null)
      .map((a) => a.id)
      .join()
  );

  yield* teammate.connectAll;

  yield* Effect.forkIn(
    Stream.mergeAll(
      [
        Stream.map(SubscriptionRef.changes(accounts.state), () => undefined),
        Stream.map(SubscriptionRef.changes(invites), () => undefined),
        Stream.map(SubscriptionRef.changes(shared), () => undefined),
        Stream.map(SubscriptionRef.changes(hosts.views), () => undefined),
      ],
      { concurrency: "unbounded" }
    ).pipe(Stream.runForEach(() => publish)),
    scope
  );

  // A sign-in or sign-out asks at once; otherwise every few minutes, and only with an Account.
  yield* Effect.forkIn(
    Stream.changes(signedInIds).pipe(
      Stream.runForEach((ids) =>
        ids === "" ? SubscriptionRef.set(invites, new Map()) : refreshInvites
      )
    ),
    scope
  );
  yield* Effect.forkIn(
    Effect.flatMap(accounts.list, (list) =>
      list.some((a) => a.signedOutAt === null) ? refreshInvites : Effect.void
    ).pipe(Effect.repeat(Schedule.spaced(input.invitesEvery ?? Duration.minutes(2)))),
    scope
  );

  const ownerPerson = Effect.map(accounts.list, (list) => {
    const account = list.find((a) => a.signedOutAt === null);

    return account === undefined
      ? null
      : { login: account.login, name: "You", avatar: avatar(account.login, account.avatarUrl) };
  });

  return {
    ...owner,
    view,
    presence: (hostKey: string, sessionId: SessionId) =>
      Stream.unwrap(
        Effect.map(ownerPerson, (person) => owner.presence(hostKey, sessionId, person))
      ),
    accept: (accountId: string, inviteId: string) =>
      Effect.tap(teammate.accept(accountId, inviteId), () => refreshInvites),
    decline: (accountId: string, inviteId: string) =>
      Effect.andThen(teammate.decline(accountId, inviteId), refreshInvites),
    refreshInvites,
    isTeammateHost: (hostKey: string) => hosts.entry(hostKey)?.teammate !== undefined,
    /** The `host` feed of another person's Host: its shared sessions' streams (`teammateFeed.ts`). */
    hostFeed: (hostKey: string) => {
      const items = teammateHostItems();

      return Stream.unwrap(
        Effect.map(hosts.connection(hostKey), (connection) =>
          teammate
            .sessionsOn(hostKey)
            .pipe(
              Stream.switchMap((ids) =>
                teammateHostFeed(
                  ids,
                  (id) => connection.subscribeSession(id, { turnLimit: TEAMMATE_TURN_LIMIT }),
                  items
                )
              )
            )
        )
      );
    },
  };
});

export class DesktopSharing extends Context.Service<
  DesktopSharing,
  Effect.Success<ReturnType<typeof make>>
>()("polaris/desktop/DesktopSharing") {
  static readonly layer = (input: DesktopSharingInput) => Layer.effect(DesktopSharing, make(input));
}
