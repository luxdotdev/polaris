import { expect, test } from "bun:test";
import type { HostConnection, LiveSession } from "@polaris/client";
import { Accounts, memoryAccountStore } from "@polaris/client/accounts";
import { fakeAccountServer } from "@polaris/client/accounts/testing";
import { RelayRouteStatus, SessionId, ShareRefused } from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Effect, Layer, SubscriptionRef } from "effect";
import type { HostView } from "../../shared/api.ts";
import { HostDirectory } from "../hosts.ts";
import { ownerSharing } from "./owner.ts";

const route = new RelayRouteStatus({
  state: "on",
  url: "wss://relay.example/v1",
  connected: true,
  hostAddress: RelayAddress.make("A".repeat(22)),
  hostNoiseKey: "B".repeat(43),
});

/** One Host whose `shares.create` fails with `refusal`. */
const refusingHost = (refusal: ShareRefused) => {
  const client = {
    "relayRoute.status": () => Effect.succeed(route),
    "shares.create": () => Effect.fail(refusal),
  };

  // SAFETY: sharing reads only `host.hostname` and the RPCs faked in `client`.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- a partial fake of a generic RPC client
  const live = { host: { hostname: "Mac Studio" }, client } as unknown as LiveSession;
  const connection: Partial<HostConnection> = { session: Effect.succeed(live) };

  return Effect.map(SubscriptionRef.make<ReadonlyArray<HostView>>([]), (views) =>
    HostDirectory.of({
      views,
      entry: () => undefined,
      // SAFETY: sharing reads only `session` of a connection.
      connection: () => Effect.succeed(connection as HostConnection),
      add: () => Effect.void,
      remove: () => Effect.void,
    })
  );
};

test.each([
  new ShareRefused({ reason: "worker" }),
  new ShareRefused({ reason: "issuer-unreachable" }),
])("a Share the Host refuses leaves no Invite anyone can accept: %p", async (refusal) => {
  const server = fakeAccountServer("https://auth.team.dev");

  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const accounts = yield* Accounts;
      const account = yield* accounts.signIn(server.origin, server.browser());

      const sharing = ownerSharing({
        hosts: yield* refusingHost(refusal),
        accounts,
        avatar: () => null,
        loadAvatars: Effect.succeed(false),
        now: Date.now,
      });

      return yield* Effect.flip(
        sharing.share({
          hostKey: "studio",
          sessionId: SessionId.make("s-1"),
          workspaceId: "w-1",
          title: "Polaris planning",
          accountId: account.id,
          login: "maya",
          role: "contributor",
          expiresAt: null,
        })
      );
    }).pipe(
      Effect.provide(
        Layer.fresh(
          Accounts.layer({ store: memoryAccountStore(), fetch: server.fetch, clientId: "t" })
        )
      ),
      Effect.scoped
    )
  );

  expect(outcome).toEqual(refusal);
  expect(server.invited()).toHaveLength(1);
  expect(server.liveInvites()).toEqual([]);
});
