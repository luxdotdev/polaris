import { Schema } from "effect";

const Identity = Schema.NullOr(Schema.Struct({ hostId: Schema.String, clientId: Schema.String }));

const Event = Schema.Struct({
  connection: Schema.Int,
  hostId: Schema.String,
  action: Schema.Literals(["hello", "revoke"]),
  offered: Identity,
  observed: Identity,
});

export const IdentityTrace = Schema.Struct({
  format: Schema.Literal("language-identity-v1"),
  provenance: Schema.Literal("runtime-fake-socket"),
  events: Schema.Array(Event),
});

export type IdentityTrace = typeof IdentityTrace.Type;

/** Replay only public connection observations; credential values are never trace fields. */
export const replayIdentity = (trace: IdentityTrace): void => {
  const bindings = new Map<
    number,
    { hostId: string; identity: typeof Identity.Type; revoked: boolean }
  >();

  for (const event of trace.events) {
    const previous = bindings.get(event.connection);

    if (event.offered !== null && event.offered.hostId !== event.hostId)
      throw new Error("Foreign trace identity");
    const same = previous?.identity?.clientId === event.offered?.clientId;

    const revoked =
      event.action === "revoke" ||
      (previous !== undefined && (previous.revoked || previous.hostId !== event.hostId || !same));

    const identity = previous === undefined ? event.offered : previous.identity;
    const expected = revoked ? null : identity;

    if (JSON.stringify(event.observed) !== JSON.stringify(expected))
      throw new Error("Identity trace observation mismatch");
    bindings.set(event.connection, { hostId: event.hostId, identity, revoked });
  }
};
