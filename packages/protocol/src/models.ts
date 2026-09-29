/**
 * Models and reasoning effort (CONTEXT.md: Model). Both are named as the
 * Harness names them, so neither is a closed list: the Harness is the source
 * of truth, and each Model lists the effort levels it supports.
 */
import { Effect, Schema } from "effect";

/** A Model as its Harness names it (`gpt-5.5`, `claude-opus-5-5`, `anthropic/claude-sonnet-5-5`). */
export const ModelId = Schema.String;

export type ModelId = typeof ModelId.Type;

/** A reasoning effort level as the Harness names it (`low`, `high`, `xhigh`). */
export const ReasoningEffort = Schema.String;

export type ReasoningEffort = typeof ReasoningEffort.Type;

/**
 * A nullable field added after logs were written: absent decodes as null, so
 * events and snapshots from before it keep decoding.
 */
export const addedNullable = <S extends Schema.Top>(schema: S) =>
  Schema.NullOr(schema).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null)));

/** An array field added after logs were written: absent decodes as empty. */
export const addedArray = <S extends Schema.Top>(schema: S) =>
  Schema.Array(schema).pipe(Schema.withDecodingDefaultKey(Effect.succeed([])));

export class Model extends Schema.Class<Model>("Model")({
  id: ModelId,
  /** How the Harness displays it. */
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** The effort levels it supports, lowest first; empty when it takes none. */
  efforts: Schema.Array(ReasoningEffort),
  defaultEffort: Schema.NullOr(ReasoningEffort),
  /** The Model the Harness picks when none is given. */
  isDefault: Schema.Boolean,
}) {}
