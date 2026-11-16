import { Effect, Layer, Redacted } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  acceptInvite,
  createInvite,
  declineInvite,
  inviteForCapability,
  pendingInvites,
  revokeShare,
} from "../invites/index.ts";
import { findByLogin, findPerson, me, setCommitEmail, toPerson } from "../people/index.ts";
import { Accounts, store } from "../server/services.ts";
import { signStatement } from "../statements/index.ts";
import {
  AccountsApi,
  CapabilityAuth,
  CurrentPerson,
  CurrentShare,
  SessionAuth,
  Unauthorized,
} from "./definition.ts";
import { devicesResponse } from "./longPoll.ts";

export const SessionAuthLive = Layer.effect(
  SessionAuth,
  Effect.gen(function* () {
    const { auth } = yield* Accounts;

    return SessionAuth.of({
      bearer: Effect.fn(function* (handler, { credential }) {
        const token = Redacted.value(credential);

        const session =
          token === ""
            ? null
            : yield* store(() =>
                auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) })
              ).pipe(Effect.orDie);

        if (session === null)
          return yield* new Unauthorized({ message: "Sign in to this Account Server." });

        return yield* Effect.provideService(handler, CurrentPerson, {
          personId: session.user.id,
          login: session.user.login,
        });
      }),
    });
  })
);

export const CapabilityAuthLive = Layer.effect(
  CapabilityAuth,
  Effect.gen(function* () {
    const accounts = yield* Accounts;

    return CapabilityAuth.of({
      capability: Effect.fn(function* (handler, { credential }) {
        const capability = Redacted.value(credential);

        const row =
          capability === ""
            ? undefined
            : yield* inviteForCapability(capability).pipe(
                Effect.provideService(Accounts, accounts),
                Effect.orDie
              );

        if (row === undefined)
          return yield* new Unauthorized({ message: "Unknown or revoked capability." });

        return yield* Effect.provideService(handler, CurrentShare, { inviteId: row.id });
      }),
    });
  })
);

/** The capability names one Share; any other `inviteId` in the path is refused like a bad one. */
const sameShare = Effect.fn(function* (inviteId: string) {
  const share = yield* CurrentShare;

  if (share.inviteId !== inviteId)
    return yield* new Unauthorized({ message: "Unknown or revoked capability." });
});

const AccountHandlers = HttpApiBuilder.group(AccountsApi, "account", (handlers) =>
  handlers
    .handle("me", () => Effect.flatMap(CurrentPerson, (p) => me(p.personId)).pipe(Effect.orDie))
    .handle("setMe", ({ payload }) =>
      Effect.flatMap(CurrentPerson, (p) => setCommitEmail(p.personId, payload.commitEmail)).pipe(
        Effect.catchTag("StoreError", Effect.die)
      )
    )
    .handle("statement", ({ payload }) =>
      Effect.gen(function* () {
        const person = yield* findPerson((yield* CurrentPerson).personId);

        return { jwt: yield* signStatement(person, payload.noiseKey) };
      }).pipe(Effect.orDie)
    )
    .handle("person", ({ query }) =>
      findByLogin(query.login).pipe(Effect.map(toPerson), Effect.catchTag("StoreError", Effect.die))
    )
);

const InvitesHandlers = HttpApiBuilder.group(AccountsApi, "invites", (handlers) =>
  handlers
    .handle("create", ({ payload }) =>
      Effect.flatMap(CurrentPerson, (p) => createInvite(p.personId, payload)).pipe(
        Effect.catchTag("StoreError", Effect.die)
      )
    )
    .handle("pending", () =>
      Effect.flatMap(CurrentPerson, (p) => pendingInvites(p.personId)).pipe(Effect.orDie)
    )
    .handle("accept", ({ params, payload }) =>
      Effect.flatMap(CurrentPerson, (p) => acceptInvite(p.personId, params.inviteId, payload)).pipe(
        Effect.catchTag("StoreError", Effect.die)
      )
    )
    .handle("decline", ({ params }) =>
      Effect.flatMap(CurrentPerson, (p) => declineInvite(p.personId, params.inviteId)).pipe(
        Effect.catchTag("StoreError", Effect.die)
      )
    )
);

const SharesHandlers = HttpApiBuilder.group(AccountsApi, "shares", (handlers) =>
  handlers
    .handleRaw("devices", ({ params }) =>
      sameShare(params.inviteId).pipe(Effect.andThen(devicesResponse(params.inviteId)))
    )
    .handle("revoke", ({ params }) =>
      sameShare(params.inviteId).pipe(
        Effect.andThen(revokeShare(params.inviteId)),
        Effect.catchTag("StoreError", Effect.die)
      )
    )
);

export const HandlersLive = Layer.mergeAll(AccountHandlers, InvitesHandlers, SharesHandlers).pipe(
  Layer.provide([SessionAuthLive, CapabilityAuthLive])
);
