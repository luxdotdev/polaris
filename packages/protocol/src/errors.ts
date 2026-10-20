/** Errors shared by RPC groups across the protocol. */
import { Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  what: Schema.String,
  id: Schema.String,
}) {}

export class Unsupported extends Schema.TaggedError<Unsupported>()("Unsupported", {
  capability: Schema.String,
}) {}
