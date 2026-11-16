/**
 * The user gate (ENG-700, ENG-927, ADR 0114): a token-less Client makes user-only requests
 * (`@polaris/protocol` `userAccess.ts`) only while its `hello`'s user key is enrolled
 * (`../userAccess/`). Extensions, Linked Devices and Teammates keep their own gates.
 */
import {
  decideUserAccess,
  type LinkedDevice,
  UserAccessGate,
  type UserAccessRequired,
} from "@polaris/protocol";
import { Effect, Option, Predicate, Schema } from "effect";
import type { Rpc } from "effect/rpc";
import { admissionOf } from "../extensions/admission.ts";
import { pairingOf } from "../extensions/connection.ts";
import { deviceOf } from "../linkedDevices/connection.ts";
import { type TeammateDevice, teammateOf } from "../shares/connection.ts";
import type { UserAccessRegistry } from "../userAccess/index.ts";

/** Of a `dispatch` payload, the gate needs only the Command's tag. */
const dispatchTag = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.Struct({ _tag: Schema.String }) })
);

export interface TransportFacts {
  readonly tokenRequired: (client: Rpc.ServerClient) => boolean;
  /** The Linked Device a connection came in as, from the transport rather than annotations. */
  readonly deviceOf?: (client: Rpc.ServerClient) => LinkedDevice | null;
  /** The Teammate a relay connection was admitted as (ADR 0112), from the transport. */
  readonly teammateOf?: (client: Rpc.ServerClient) => TeammateDevice | null;
}

/** Whether a request comes from the owner's token-less Client, the only kind this gate decides for. */
const tokenlessClient = (client: Rpc.ServerClient, transport: TransportFacts) => {
  const admission = admissionOf(client);

  return (
    !transport.tokenRequired(client) &&
    !admission.tokenRequired &&
    admission.role !== "extension" &&
    pairingOf(client) === null &&
    (transport.deviceOf?.(client) ?? deviceOf(client)) === null &&
    // A Teammate is never the owner: the Share gate decides for it, and it holds no user key.
    (transport.teammateOf?.(client) ?? teammateOf(client)) === null
  );
};

/** Fails once the connection no longer holds user access; never succeeds. */
const lost = (
  registry: UserAccessRegistry,
  client: Rpc.ServerClient,
  refusal: UserAccessRequired
) =>
  Effect.callback<never, UserAccessRequired>((resume) => {
    const stop = registry.onLost(client, () => resume(Effect.fail(refusal)));

    return Effect.sync(stop);
  });

/**
 * The user gate: Extensions, Linked Devices and Teammates pass to their own gates; a token-less
 * Client without user access is refused what `USER_RPCS` and `USER_COMMANDS` mark `user`.
 */
export const userAccessGateFor = (transport: TransportFacts, registry: UserAccessRegistry) =>
  UserAccessGate.of((effect, { client, rpc, payload }) => {
    if (Predicate.isTagged(rpc, "hello") || !tokenlessClient(client, transport)) return effect;

    const command = Predicate.isTagged(rpc, "dispatch")
      ? Option.getOrNull(Option.map(dispatchTag(payload), (p) => p.command._tag))
      : null;

    const refusal = decideUserAccess(rpc._tag, command, registry.holds(client));

    if (refusal !== null) return Effect.fail(refusal);
    const needed = decideUserAccess(rpc._tag, command, false);

    // Admitted and user-only: it ends, refused, the moment the connection's key is revoked.
    return needed === null ? effect : Effect.raceFirst(effect, lost(registry, client, needed));
  });

/**
 * Whether a Teammate may send Turns and answer approvals. Still off: a Share's `turn` and
 * `approve` Grants stay refused until that is decided, now that enrolment is back (ENG-927).
 */
export const teammatesMayAct = (): boolean => false;
