import { expect, test } from "bun:test";
import {
  ExtensionTokenRejected,
  LinkedDevice,
  LinkedDeviceId,
  Pairing,
  PairingId,
} from "@polaris/protocol";
import { RelayAddress } from "@polaris/protocol/relay";
import { Deferred, Effect, Exit, Fiber, Redacted, Schema } from "effect";
import { Headers } from "effect/http";
import { Rpc } from "effect/rpc";
import { RequestId } from "effect/rpc/RpcMessage";
import {
  ExtensionConnections,
  grantGate,
  grantGateFor,
  pairingOf,
  revokePairing,
  scopeConnection,
} from "./connection.ts";
import { Pairings, TokenCheck } from "./pairings.ts";

const raycast = new Pairing({
  id: PairingId.make("pair_1"),
  name: "Raycast",
  grant: ["read"],
  createdAt: "2026-10-23T00:00:00Z",
  lastUsedAt: null,
  revokedAt: null,
});

test.each(["store", "close"] as const)(
  "canceling revocation at the %s boundary still closes every connection",
  async (boundary) => {
    const live = new Set([1, 2]);
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();

          const pause = Effect.andThen(
            Deferred.succeed(entered, undefined),
            Deferred.await(release)
          );

          const store = Pairings.of({
            ...revokedBetweenChecks().pairings,
            revoke: () =>
              Effect.as(
                boundary === "store" ? pause : Effect.void,
                new Pairing({
                  ...Schema.encodeSync(Pairing)(raycast),
                  id: raycast.id,
                  revokedAt: "2026-10-23T01:00:00Z",
                })
              ),
          });

          const connections = ExtensionConnections.make((id) =>
            Effect.gen(function* () {
              if (id === 1 && boundary === "close") yield* pause;
              live.delete(id);
              connections.unbind(id);
            })
          );

          for (const id of live) connections.bind(raycast.id, id);

          const revoke = yield* revokePairing(raycast.id).pipe(
            Effect.provideService(Pairings, store),
            Effect.provideService(ExtensionConnections, connections),
            Effect.forkScoped
          );

          yield* Deferred.await(entered);
          revoke.interruptUnsafe();
          yield* Deferred.succeed(release, undefined);
          yield* Effect.exit(Fiber.join(revoke));
          expect([...live]).toEqual([]);
          expect(connections.count(raycast.id)).toBe(0);
        })
      )
    );
  }
);

test("a request received while token authentication waits has no Client authority", async () => {
  const client = new Rpc.ServerClient(9);
  const connections = ExtensionConnections.make(() => Effect.void);
  let reached = false;
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const store = Pairings.of({
          ...revokedBetweenChecks().pairings,
          touch: () => Effect.void,
          authenticate: () =>
            Effect.andThen(
              Deferred.succeed(entered, undefined),
              Effect.as(Deferred.await(release), TokenCheck.cases.Valid.make({ pairing: raycast }))
            ),
        });

        const hello = yield* scopeConnection(client, Redacted.make("first")).pipe(
          Effect.provideService(Pairings, store),
          Effect.provideService(ExtensionConnections, connections),
          Effect.forkScoped
        );

        yield* Deferred.await(entered);

        const request = grantGate(
          Effect.andThen(
            Effect.sync(() => {
              reached = true;
            }),
            Effect.interrupt
          ),
          {
            client,
            rpc: Rpc.make("extensions.list"),
            payload: undefined,
            requestId: RequestId(1),
            headers: Headers.empty,
          }
        );

        yield* Effect.exit(request);
        expect(reached).toBe(false);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(hello);
      })
    )
  );
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

test("concurrent hellos cannot replace the first Pairing", async () => {
  const second = new Pairing({
    ...Schema.encodeSync(Pairing)(raycast),
    id: PairingId.make("pair_2"),
    grant: ["turn"],
  });

  const connections = ExtensionConnections.make(() => Effect.void);
  const client = new Rpc.ServerClient(8);

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const store = Pairings.of({
          ...revokedBetweenChecks().pairings,
          touch: () => Effect.void,
          authenticate: (token) =>
            token === "first"
              ? Effect.andThen(
                  Deferred.succeed(entered, undefined),
                  Effect.as(
                    Deferred.await(release),
                    TokenCheck.cases.Valid.make({ pairing: raycast })
                  )
                )
              : Effect.succeed(TokenCheck.cases.Valid.make({ pairing: second })),
        });

        const scope = (token: string) =>
          scopeConnection(client, Redacted.make(token)).pipe(
            Effect.provideService(Pairings, store),
            Effect.provideService(ExtensionConnections, connections),
            Effect.exit
          );

        const first = yield* scope("first").pipe(Effect.forkScoped);
        yield* Deferred.await(entered);
        const other = yield* scope("second").pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* Deferred.succeed(release, undefined);
        expect(Exit.isSuccess(yield* Fiber.join(first))).toBe(true);
        expect(Exit.isFailure(yield* Fiber.join(other))).toBe(true);
        expect(pairingOf(client)?.id).toBe(raycast.id);
        expect(connections.count(second.id)).toBe(0);
      })
    )
  );
});

const phone = new LinkedDevice({
  id: LinkedDeviceId.make("dev_1"),
  name: "Phone",
  relayAddress: RelayAddress.make("A".repeat(22)),
  noiseKey: "B".repeat(43),
  createdAt: "2026-10-28T00:00:00Z",
  lastUsedAt: null,
  unlinkedAt: null,
});

// RX2-1: an RPC added after the allowlist (or any tag it doesn't name) fails closed for a device.
test.each(["future.newRpc", "toString", "__proto__"])(
  "a Linked Device is refused an RPC the allowlist doesn't name: %s",
  async (tag) => {
    /** What the gate did with the request: let it reach its handler, or refuse it. */
    const gate = async (device: LinkedDevice | null) => {
      let outcome = "neither";

      const handler = Effect.andThen(
        Effect.sync(() => {
          outcome = "ran";
        }),
        Effect.interrupt
      );

      await Effect.runPromise(
        Effect.scoped(
          Effect.exit(
            grantGateFor({ tokenRequired: () => false, deviceOf: () => device })(handler, {
              client: new Rpc.ServerClient(20),
              rpc: Rpc.make(tag),
              payload: undefined,
              requestId: RequestId(1),
              headers: Headers.empty,
            }).pipe(
              Effect.catchTag("NotGranted", (refusal) =>
                Effect.sync(() => {
                  outcome = refusal._tag;
                })
              )
            )
          )
        )
      );

      return outcome;
    };

    expect(await gate(null)).toBe("ran");
    expect(await gate(phone)).toBe("NotGranted");
  }
);
