import { expect, test } from "bun:test";
import { ExtensionTokenRejected, Pairing, PairingId } from "@polaris/protocol";
import { Effect, Redacted } from "effect";
import { Rpc } from "effect/rpc";
import { ExtensionConnections, pairingOf, scopeConnection } from "./connection.ts";
import { Pairings, TokenCheck } from "./pairings.ts";

const raycast = new Pairing({
  id: PairingId.make("pair_1"),
  name: "Raycast",
  grant: ["read"],
  createdAt: "2026-10-23T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
});

/** A store whose Pairing is revoked right after the first check: the revoke/hello race. */
const revokedBetweenChecks = () => {
  let checks = 0;
  const touched: Array<PairingId> = [];

  const pairings = Pairings.of({
    pair: () => Effect.die("unused"),
    list: Effect.die("unused"),
    revoke: () => Effect.die("unused"),
    touch: (id) => Effect.sync(() => void touched.push(id)),
    authenticate: () =>
      Effect.sync(() => {
        checks += 1;

        return checks === 1
          ? TokenCheck.cases.Valid.make({ pairing: raycast })
          : TokenCheck.cases.Revoked.make({ pairing: raycast });
      }),
  });

  return { pairings, touched, checks: () => checks };
};

test("a Pairing revoked between the token check and the binding never scopes the connection", async () => {
  const store = revokedBetweenChecks();
  const connections = ExtensionConnections.make(() => Effect.void);
  const client = new Rpc.ServerClient(7);

  const result = await Effect.runPromise(
    scopeConnection(client, Redacted.make("pol_ext_x")).pipe(
      Effect.flip,
      Effect.provideService(Pairings, store.pairings),
      Effect.provideService(ExtensionConnections, connections)
    )
  );

  expect(result).toEqual(new ExtensionTokenRejected({ reason: "revoked" }));
  expect(pairingOf(client)).toBeNull();
  expect(connections.count(raycast.id)).toBe(0);
  expect(store.touched).toEqual([]);
  expect(store.checks()).toBe(2);
});
