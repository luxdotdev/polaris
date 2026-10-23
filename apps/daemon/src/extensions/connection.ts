/**
 * A connection scoped to a Pairing (ADR 0078): `hello` annotates it, the Grant
 * gate refuses what its Grant lacks, `dispatch` records it as the actor, and
 * revoking the Pairing closes it.
 */
import {
  Actor,
  decideAccess,
  ExtensionTokenRejected,
  GrantGate,
  NotGranted,
  NotFound,
  type Pairing,
  type PairingId,
} from "@polaris/protocol";
import { Context, Effect, Exit, Match, Option, Predicate, Redacted, Schema } from "effect";
import type { Rpc } from "effect/rpc";
import { Pairings } from "./pairings.ts";
import { admissionOf, rejectConnection, reserveConnection } from "./admission.ts";

/** Per-connection annotation set by `hello`: the Pairing the connection acts as. */
export class ConnectionPairing extends Context.Service<ConnectionPairing, Pairing>()(
  "polaris/daemon/extensions/ConnectionPairing"
) {}

export const pairingOf = (client: Rpc.ServerClient): Pairing | null =>
  Context.getOrUndefined(client.annotations, ConnectionPairing) ?? null;

/** Who a command from this connection comes from. */
export const actorOf = (client: Rpc.ServerClient): Actor => {
  const pairing = pairingOf(client);

  return pairing === null
    ? Actor.cases.Client.make({})
    : Actor.cases.Extension.make({ pairingId: pairing.id, name: pairing.name });
};

/** The live connections of each Pairing, so that revoking it closes them. */
export class ExtensionConnections extends Context.Service<
  ExtensionConnections,
  {
    readonly bind: (pairingId: PairingId, connectionId: number) => void;
    readonly unbind: (connectionId: number) => void;
    readonly closeAll: (pairingId: PairingId) => Effect.Effect<void>;
    /** How many connections a Pairing has open right now. */
    readonly count: (pairingId: PairingId) => number;
  }
>()("polaris/daemon/extensions/ExtensionConnections") {
  /** `close` ends the connection with that id; a closed connection calls `unbind`. */
  static make(
    close: (connectionId: number) => Effect.Effect<void>
  ): ExtensionConnections["Service"] {
    const byPairing = new Map<PairingId, Set<number>>();
    const byConnection = new Map<number, PairingId>();

    const unbind = (connectionId: number) => {
      const pairingId = byConnection.get(connectionId);

      if (pairingId === undefined) return;
      byConnection.delete(connectionId);
      const open = byPairing.get(pairingId);
      open?.delete(connectionId);

      if (open?.size === 0) byPairing.delete(pairingId);
    };

    return ExtensionConnections.of({
      bind: (pairingId, connectionId) => {
        unbind(connectionId);
        byConnection.set(connectionId, pairingId);
        const open = byPairing.get(pairingId) ?? new Set<number>();
        open.add(connectionId);
        byPairing.set(pairingId, open);
      },
      unbind,
      closeAll: (pairingId) =>
        Effect.forEach([...(byPairing.get(pairingId) ?? [])], close, { discard: true }),
      count: (pairingId) => byPairing.get(pairingId)?.size ?? 0,
    });
  }
}

const rejected = (reason: ExtensionTokenRejected["reason"]) =>
  Effect.fail(new ExtensionTokenRejected({ reason }));

/**
 * Authenticates every token-bearing hello, serialized per connection. Its role
 * was reserved before any authentication could yield; a rejection seals it.
 */
export const scopeConnection = (client: Rpc.ServerClient, token?: Redacted.Redacted<string>) =>
  Effect.suspend(() => {
    reserveConnection(client, token !== undefined);
    const admission = admissionOf(client);

    return admission.hello.withPermit(authenticateConnection(client, token)).pipe(
      Effect.onExit((exit) => {
        if (Exit.isSuccess(exit)) return Effect.void;
        rejectConnection(client);

        return Effect.flatMap(ExtensionConnections, (connections) =>
          Effect.sync(() => connections.unbind(client.id))
        );
      })
    );
  });

const authenticateConnection = Effect.fn("authenticateConnection")(function* (
  client: Rpc.ServerClient,
  token: Redacted.Redacted<string> | undefined
) {
  const admission = admissionOf(client);

  if (admission.rejection !== null) return yield* rejected(admission.rejection);
  const existing = pairingOf(client);

  if (token === undefined) {
    if (admission.role === "extension" && existing === null) return yield* rejected("missing");

    return existing;
  }

  const pairings = yield* Pairings;
  const connections = yield* ExtensionConnections;
  const authenticate = Effect.orDie(pairings.authenticate(Redacted.value(token)));

  const pairing = yield* Match.value(yield* authenticate).pipe(
    Match.tags({
      Valid: ({ pairing }) => Effect.succeed(pairing),
      Malformed: () => rejected("malformed"),
      Unknown: () => rejected("unknown"),
      Revoked: () => rejected("revoked"),
    }),
    Match.exhaustive
  );

  if (existing !== null && existing.id !== pairing.id) return yield* rejected("connection-bound");
  connections.bind(pairing.id, client.id);

  if (!Predicate.isTagged(yield* authenticate, "Valid")) {
    connections.unbind(client.id);

    return yield* rejected("revoked");
  }

  // A transport close or another failed hello may have sealed it while the store yielded.
  if (admission.rejection !== null) return yield* rejected(admission.rejection);
  client.annotate(ConnectionPairing, pairing);
  yield* Effect.orDie(pairings.touch(pairing.id));

  return pairing;
});

/** Of a `dispatch` payload, the gate needs the Command's tag and a `StartSession`'s mode. */
const dispatchCommand = Schema.decodeUnknownOption(
  Schema.Struct({
    command: Schema.Struct({
      _tag: Schema.String,
      permissionMode: Schema.optionalKey(Schema.String),
    }),
  })
);

const tokenHello = Schema.is(Schema.Struct({ extensionToken: Schema.Redacted(Schema.String) }));

/**
 * The gate for a server whose connections may differ: the gateway's require a
 * token (`tokenRequired` answers per connection), the Unix socket's keep
 * pre-hello Client calls.
 */
export const grantGateFor = (options: {
  readonly tokenRequired: (client: Rpc.ServerClient) => boolean;
}) =>
  GrantGate.of((effect, { client, rpc, payload }) => {
    // RpcServer builds middleware before forking handlers: reserve authority at receipt.
    reserveConnection(
      client,
      Predicate.isTagged(rpc, "hello") && tokenHello(payload),
      options.tokenRequired(client)
    );

    if (Predicate.isTagged(rpc, "hello")) return effect;

    const command = Predicate.isTagged(rpc, "dispatch")
      ? Option.getOrNull(Option.map(dispatchCommand(payload), (p) => p.command))
      : null;

    return Effect.suspend(() => {
      const admission = admissionOf(client);
      const pairing = pairingOf(client);

      if (admission.rejection !== null || (admission.role === "extension" && pairing === null)) {
        return Effect.fail(new NotGranted({ what: rpc._tag, needed: null }));
      }

      const refusal = decideAccess(
        pairing,
        rpc._tag,
        command?._tag ?? null,
        command?.permissionMode ?? null
      );

      return refusal === null ? effect : Effect.fail(refusal);
    });
  });

export const grantGate = grantGateFor({ tokenRequired: () => false });

/** Persist revocation and close every transport as one operation. */
export const revokePairing = Effect.fn("revokePairing")(function* (id: PairingId) {
  const pairings = yield* Pairings;
  const revoked = yield* Effect.orDie(pairings.revoke(id));

  if (revoked === null) return yield* new NotFound({ what: "pairing", id });
  yield* (yield* ExtensionConnections).closeAll(id);

  return revoked;
}, Effect.uninterruptible);
