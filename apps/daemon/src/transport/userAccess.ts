/**
 * The user gate (ENG-700, ENG-927, ADR 0114): a token-less Client makes user-only requests
 * (`@polaris/protocol` `userAccess.ts`) only while its `hello`'s user key is enrolled
 * (`../userAccess/`). Extensions and Linked Devices keep their own gates.
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
import type { UserAccessRegistry } from "../userAccess/index.ts";

/** Of a `dispatch` payload, the gate needs only the Command's tag. */
const dispatchTag = Schema.decodeUnknownOption(
  Schema.Struct({ command: Schema.Struct({ _tag: Schema.String }) })
);

export interface TransportFacts {
  readonly tokenRequired: (client: Rpc.ServerClient) => boolean;
  /** The Linked Device a connection came in as, from the transport rather than annotations. */
  readonly deviceOf?: (client: Rpc.ServerClient) => LinkedDevice | null;
}

/** Whether a request comes from a token-less Client, the only kind this gate decides for. */
const tokenlessClient = (client: Rpc.ServerClient, transport: TransportFacts) => {
  const admission = admissionOf(client);

  return (
    !transport.tokenRequired(client) &&
    !admission.tokenRequired &&
    admission.role !== "extension" &&
    pairingOf(client) === null &&
    (transport.deviceOf?.(client) ?? deviceOf(client)) === null
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
 * The user gate: Extensions and Linked Devices pass to their own gates; a token-less
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
