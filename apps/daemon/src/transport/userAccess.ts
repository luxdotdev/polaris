/**
 * The user gate (ENG-700, ENG-927, ADR 0114): a token-less Client makes user-only requests
 * (`@polaris/protocol` `userAccess.ts`) only while its `hello`'s user key is enrolled
 * (`../userAccess/`). Extensions, Linked Devices and Teammates keep their own gates.
 */
import {
  decideUserAccess,
  Command,
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
import { sessionActionGrant } from "../engine/sessionGrantPolicy.ts";
import type { Actor } from "./actor.ts";

/** Of a `dispatch` payload, the gate needs only the Command's tag. */
const dispatchTag = Schema.decodeUnknownOption(Schema.Struct({ command: Command }));

const settingsWrites = new Set(["settings.set", "clientSettings.set"]);

export interface TransportFacts {
  readonly actorOf?: (client: Rpc.ServerClient) => Actor;
  readonly tokenRequired: (client: Rpc.ServerClient) => boolean;
  /** The Linked Device a connection came in as, from the transport rather than annotations. */
  readonly deviceOf?: (client: Rpc.ServerClient) => LinkedDevice | null;
  /** The Teammate a relay connection was admitted as (ADR 0112), from the transport. */
  readonly teammateOf?: (client: Rpc.ServerClient) => TeammateDevice | null;
}

/** Whether a request comes from the owner's token-less Client, the only kind this gate decides for. */
export const tokenlessClient = (client: Rpc.ServerClient, transport: TransportFacts) => {
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
      ? Option.getOrNull(Option.map(dispatchTag(payload), (p) => p.command))
      : null;

    // Session start/turn Grants are checked by the Engine; approval and secret RPCs keep this gate.
    const access = sessionActionGrant(
      command === null ? { rpc: rpc._tag } : { rpc: rpc._tag, command }
    );

    if (
      transport.actorOf?.(client).kind === "agentSession" &&
      (access === "start" ||
        access === "turn" ||
        access === "settings" ||
        settingsWrites.has(rpc._tag) ||
        Predicate.isTagged(rpc, "session.start"))
    )
      return effect;

    // Start validates omitted CLI defaults before checking the enrolled user key in its handler.
    if (Predicate.isTagged(rpc, "session.start")) return effect;

    const refusal = decideUserAccess(rpc._tag, command?._tag ?? null, registry.holds(client));

    if (refusal !== null) return Effect.fail(refusal);
    const needed = decideUserAccess(rpc._tag, command?._tag ?? null, false);

    // Admitted and user-only: it ends, refused, the moment the connection's key is revoked.
    return needed === null ? effect : Effect.raceFirst(effect, lost(registry, client, needed));
  });

/**
 * Whether a Teammate may send Turns: a Share's `turn` Grant now decides (ENG-941). The
 * Share gate still reads it, so one line turns them off.
 */
export const teammatesMayAct = (): boolean => true;
