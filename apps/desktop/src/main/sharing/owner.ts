/**
 * The owner's side of sharing: an Invite on the Account Server, then the Share on the session's
 * Host, withdrawing the Invite if the Host refuses (ADR 0112); the session's Shares, renewing and revoking them, and who has it open.
 */
import type { LiveSession } from "@polaris/client";
import { type AccountsApi, AccountsError, workspaceAccountKey } from "@polaris/client/accounts";
import {
  InviteId,
  POLARIS_CLOUD_RELAY_URL,
  PersonId,
  SHARE_DEFAULT_LIFETIME_MS,
  type SessionId,
  type Share,
  type ShareId,
  ShareListing,
  ShareTarget,
} from "@polaris/protocol";
import { Effect, Option, Predicate, Redacted, Schema, Stream } from "effect";
import type { RequestInput } from "../../shared/contract.ts";
import type { SharingPersonView } from "../../shared/sharingContract.ts";
import type { HostDirectory } from "../hosts.ts";
import { type AvatarOf, presenceViews, shareView } from "./views.ts";

/** The login hasn't signed in to Polaris on that Account Server, so it can't be invited. */
export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()("PersonNotFound", {
  message: Schema.String,
}) {}

/** The Polaris account's session ended on its server; sign in again to share. */
export class SignedOut extends Schema.TaggedError<SignedOut>()("SignedOut", {
  message: Schema.String,
}) {}

export interface OwnerInput {
  readonly hosts: HostDirectory["Service"];
  readonly accounts: AccountsApi;
  readonly avatar: AvatarOf;
  /** Starts loading any avatar `avatar` returned null for; resolves when they settle. */
  readonly loadAvatars: Effect.Effect<boolean>;
  readonly now: () => number;
}

const serverName = (server: string) => new URL(server).host;

const sessionTarget = (sessionId: SessionId) => ShareTarget.cases.Session.make({ sessionId });

/** A refused person lookup reads as the person, a lapsed session as signing in again. */
export const lookupFailure = (login: string, server: string) => (error: AccountsError) => {
  if (error.serverTag === "PersonNotFound" || error.status === 404)
    return new PersonNotFound({
      message: `@${login} hasn't signed in to Polaris on ${serverName(server)}.`,
    });

  return error.reason === "signed-out"
    ? new SignedOut({ message: "This Polaris account was signed out. Sign in again to share." })
    : error;
};

export const ownerSharing = (input: OwnerInput) => {
  const { hosts, accounts, avatar, now } = input;

  const live = (hostKey: string) =>
    Effect.flatMap(hosts.connection(hostKey), (connection) => connection.session);

  /** The Host's relay keys and URL; sharing turns the relay route on if it is off. */
  const relayRoute = (session: LiveSession) =>
    Effect.gen(function* () {
      const status = yield* session.client["relayRoute.status"]();

      return status.state === "on" ? status : yield* session.client["relayRoute.enable"]({});
    });

  const listings = (session: LiveSession, sessionId: SessionId | null) =>
    session.client["shares.list"]({ target: sessionId === null ? null : sessionTarget(sessionId) });

  const views = (all: ReadonlyArray<ShareListing>) =>
    all.map((listing) => shareView(listing, now(), avatar));

  /** The Share as the Host now lists it, with its log. */
  const refreshed = (session: LiveSession) => (changed: Share) =>
    Effect.map(listings(session, null), (all) =>
      shareView(
        all.find((l) => l.share.id === changed.id) ?? new ShareListing({ share: changed, log: [] }),
        now(),
        avatar
      )
    );

  const share = Effect.fn("Sharing.share")(function* (request: RequestInput<"sharing.share">) {
    const login = request.login.replace(/^@/, "");
    const account = (yield* accounts.list).find((a) => a.id === request.accountId);

    if (account === undefined)
      return yield* new AccountsError({ reason: "unknown-account", message: "No such account" });

    const person = yield* accounts
      .person(account.id, login)
      .pipe(Effect.mapError(lookupFailure(login, account.server)));

    const session = yield* live(request.hostKey);
    const route = yield* relayRoute(session);

    const expiresAt =
      request.expiresAt ?? new Date(now() + SHARE_DEFAULT_LIFETIME_MS).toISOString();

    // `relayUrl` reaches the Account Server once InviteHost carries it (ENG-941 B2).
    const host = {
      name: session.host.hostname,
      relayAddress: route.hostAddress,
      noiseKey: route.hostNoiseKey,
      relayUrl: route.url ?? POLARIS_CLOUD_RELAY_URL,
    };

    const invite = yield* accounts
      .createInvite(account.id, {
        inviteeLogin: login,
        share: { id: request.sessionId, title: request.title, kind: "session" },
        host,
        role: request.role,
        expiresAt,
      })
      .pipe(Effect.mapError(lookupFailure(login, account.server)));

    const created = yield* session.client["shares.create"]({
      target: sessionTarget(request.sessionId),
      personId: PersonId.make(person.personId),
      inviteeLogin: login,
      role: request.role,
      expiresAt: request.expiresAt,
      issuer: account.server,
      inviteId: InviteId.make(invite.inviteId),
      hostCapability: Redacted.make(invite.hostCapability),
    }).pipe(
      // A refused Share leaves no Invite for anyone to accept; a failed withdraw keeps the refusal.
      Effect.tapError(() => Effect.ignore(accounts.withdrawInvite(account.id, invite)))
    );

    const workspace = workspaceAccountKey(request.hostKey, request.workspaceId);

    if (Option.isNone(yield* accounts.workspaceAccount(workspace)))
      yield* accounts.setWorkspaceAccount(workspace, account.id);

    return yield* refreshed(session)(created);
  });

  const presence = (hostKey: string, sessionId: SessionId, owner: SharingPersonView | null) =>
    Stream.unwrap(
      Effect.map(live(hostKey), (session) =>
        session.client["shares.watchPresence"]({ target: sessionTarget(sessionId) })
      )
    ).pipe(
      Stream.flatMap((entries) =>
        Stream.concat(
          Stream.make(presenceViews(entries, avatar, owner)),
          Stream.fromEffect(input.loadAvatars).pipe(
            Stream.filter((loaded) => loaded),
            Stream.map(() => presenceViews(entries, avatar, owner))
          )
        )
      )
    );

  return {
    share,
    list: (hostKey: string, sessionId: SessionId) =>
      Effect.flatMap(live(hostKey), (session) => Effect.map(listings(session, sessionId), views)),
    /** Sessions on the Host with a live Share. */
    sharedSessions: (hostKey: string) =>
      Effect.flatMap(live(hostKey), (session) => listings(session, null)).pipe(
        Effect.map((all) => [
          ...new Set(
            views(all).flatMap((view, i) => {
              const target = all[i]?.share.target;

              return view.live && target !== undefined && Predicate.isTagged(target, "Session")
                ? [target.sessionId]
                : [];
            })
          ),
        ])
      ),
    renew: (hostKey: string, id: ShareId, expiresAt: string | null) =>
      Effect.flatMap(live(hostKey), (session) =>
        Effect.flatMap(session.client["shares.renew"]({ id, expiresAt }), refreshed(session))
      ),
    revoke: (hostKey: string, id: ShareId) =>
      Effect.flatMap(live(hostKey), (session) =>
        Effect.flatMap(session.client["shares.revoke"]({ id }), refreshed(session))
      ),
    presence,
  };
};

export type OwnerSharing = ReturnType<typeof ownerSharing>;
