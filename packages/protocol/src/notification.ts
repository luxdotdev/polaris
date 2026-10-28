import { Effect, Schema } from "effect";
import { SessionId, Timestamp } from "./ids.ts";
import { optionalNullable } from "./models.ts";

/** Something to tell the user about a session; never a Session State. */
export class SessionNotification extends Schema.Class<SessionNotification>("SessionNotification")({
  id: Schema.String,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  body: Schema.String.check(Schema.isMaxLength(400)),
  at: Timestamp,
  /**
   * Polaris sent it because a Constellation needs the user (ENG-462), not the agent's `notify`.
   * Each device's setting for these can turn them off; absent on older logs: the agent's.
   */
  automatic: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
    Schema.withConstructorDefault(Effect.succeed(false))
  ),
  /** The Constellation an automatic notification is about, so a tap opens it; else null. */
  constellationId: optionalNullable(Schema.String),
}) {}

/** Capability `session.notify`; on the Host stream, so a Client hears it without the session open. */
export const notificationEventFields = {
  SessionNotified: { sessionId: SessionId, notification: SessionNotification },
};
