import { Schema } from "effect";
import { SessionId, Timestamp } from "./ids.ts";

/** Something an agent asked to tell the user (the MCP `notify` tool); never a Session State. */
export class SessionNotification extends Schema.Class<SessionNotification>("SessionNotification")({
  id: Schema.String,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  body: Schema.String.check(Schema.isMaxLength(400)),
  at: Timestamp,
}) {}

/** Capability `session.notify`; on the Host stream, so a Client hears it without the session open. */
export const notificationEventFields = {
  SessionNotified: { sessionId: SessionId, notification: SessionNotification },
};
