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
  type Pairing,
  type PairingId,
} from "@polaris/protocol";
import { Context, Effect, Match, Option, Redacted, Schema } from "effect";
import type { Rpc } from "effect/rpc";
import { Pairings } from "./pairings.ts";

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

/**
 * Scopes the connection to the Pairing the token proves, for `hello`. The first
 * Pairing a connection presents is the one it keeps.
 */
export const scopeConnection = Effect.fn("scopeConnection")(function* (
  client: Rpc.ServerClient,
  token: Redacted.Redacted<string>
) {
  const existing = pairingOf(client);

  if (existing !== null) return existing;
  const pairings = yield* Pairings;
  const connections = yield* ExtensionConnections;
  const check = yield* Effect.orDie(pairings.authenticate(Redacted.value(token)));

  const pairing = yield* Match.value(check).pipe(
    Match.tags({
      Valid: ({ pairing }) => Effect.succeed(pairing),
      Malformed: () => Effect.fail(new ExtensionTokenRejected({ reason: "malformed" })),
      Unknown: () => Effect.fail(new ExtensionTokenRejected({ reason: "unknown" })),
      Revoked: () => Effect.fail(new ExtensionTokenRejected({ reason: "revoked" })),
    }),
    Match.exhaustive
  );

  client.annotate(ConnectionPairing, pairing);
  connections.bind(pairing.id, client.id);
  yield* Effect.orDie(pairings.touch(pairing.id));

  return pairing;
});

/** Of a `dispatch` payload, the gate needs the Command's tag. */
const dispatchCommand = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.Struct({ _tag: Schema.String }) })
);

/** The gate every RPC passes: `decideAccess` on the connection's Pairing. */
export const grantGate = GrantGate.of((effect, { client, rpc, payload }) => {
  const command = Option.getOrNull(Option.map(dispatchCommand(payload), (p) => p.command._tag));
  const refusal = decideAccess(pairingOf(client), rpc._tag, command);

  return refusal === null ? effect : Effect.fail(refusal);
});
