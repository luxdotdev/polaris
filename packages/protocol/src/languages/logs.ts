import { Schema } from "effect";
import { LanguageContextIdentity, LanguageCounter } from "./base.ts";

export const LanguageServerLogLine = Schema.Struct({
  sequence: LanguageCounter.check(Schema.isGreaterThan(0)),
  time: LanguageCounter,
  level: Schema.Literals(["error", "warning", "info", "debug"]),
  source: Schema.Literals(["logMessage", "showMessage", "stderr"]),
  text: Schema.String.check(Schema.isMaxLength(8192)),
});

export type LanguageServerLogLine = typeof LanguageServerLogLine.Type;

/** Ephemeral server output, never a DomainEvent or a durable resume cursor. */
export const LanguageServerLogEvent = Schema.TaggedUnion({
  Snapshot: {
    context: LanguageContextIdentity,
    lines: Schema.Array(LanguageServerLogLine).check(Schema.isMaxLength(2000)),
  },
  Line: { context: LanguageContextIdentity, line: LanguageServerLogLine },
});

export type LanguageServerLogEvent = typeof LanguageServerLogEvent.Type;
