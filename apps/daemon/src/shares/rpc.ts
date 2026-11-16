/**
 * Handlers for `shares.*` and `account.refreshStatement`. Which connection may call which is
 * decided before they run: the Grant, device and Share gates leave Share management to the owner.
 */
import { ShareRpcs, StatementRejected } from "@polaris/protocol";
import { Effect, Stream } from "effect";
import { actorOf } from "../extensions/connection.ts";
import { teammateOf } from "./connection.ts";
import { Shares } from "./service.ts";

export const ShareRpcsLive = ShareRpcs.toLayer({
  "shares.create": (input, { client }) =>
    Effect.flatMap(Shares, (shares) => shares.create(input, actorOf(client))),
  "shares.renew": ({ id, expiresAt }, { client }) =>
    Effect.flatMap(Shares, (shares) => shares.renew(id, expiresAt, actorOf(client))),
  "shares.revoke": ({ id }, { client }) =>
    Effect.flatMap(Shares, (shares) => shares.revoke(id, actorOf(client))),
  "shares.list": ({ target }) => Effect.flatMap(Shares, (shares) => shares.list(target)),
  "shares.watchPresence": ({ target }) =>
    Stream.unwrap(Effect.map(Shares, (shares) => shares.watchPresence(target))),
  // Only a Teammate's connection has a statement to renew.
  "account.refreshStatement": ({ statement }, { client }) => {
    const teammate = teammateOf(client);

    return teammate === null
      ? Effect.fail(new StatementRejected({ reason: "device" }))
      : Effect.flatMap(Shares, (shares) => shares.present(teammate, statement));
  },
});
