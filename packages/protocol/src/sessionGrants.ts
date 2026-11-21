/** Session authority and immutable Starter identity (ADR 0119). */
import { Effect, Schema } from "effect";
import { PairingId, SessionId } from "./ids.ts";
import { Grant } from "./extensions.ts";

export const Starter = Schema.TaggedUnion({
  User: {},
  AgentSession: { sessionId: SessionId },
  Extension: { pairingId: PairingId },
  Cli: {},
});

export type Starter = typeof Starter.Type;

export const defaultStarter = Starter.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(Starter.cases.User.make({}))),
  Schema.withConstructorDefault(Effect.succeed(Starter.cases.User.make({})))
);

export const defaultSessionGrant = Grant.pipe(
  Schema.withDecodingDefaultKey(Effect.succeed(Grant.make(["read", "comment"]))),
  Schema.withConstructorDefault(Effect.succeed(Grant.make(["read", "comment"])))
);

export const SessionGrantKind = Schema.Literals(["start", "turn", "settings"]);

export type SessionGrantKind = typeof SessionGrantKind.Type;

export const SessionStartLimit = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const GrantApproval = Schema.Struct({
  kind: SessionGrantKind,
  action: Schema.String,
  targetSessionId: Schema.NullOr(SessionId),
  rememberable: Schema.Boolean,
});

export const GrantScope = Schema.Literals(["session", "workspace"]);
