import { Schema } from "effect";

export class InstallError extends Schema.TaggedError<InstallError>()("InstallError", {
  step: Schema.String,
  message: Schema.String,
}) {}
