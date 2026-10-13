import type { Schema } from "effect";

/** A one-shot, schema-constrained Harness request: no session, no edits, no events. */
export interface StructuredJob {
  readonly instructions: string;
  readonly prompt: string;
  /** JSON Schema for the final output; objects must set additionalProperties: false. */
  readonly schema: typeof Schema.Json.Type;
  readonly model: string | null;
  readonly effort: string | null;
  /** Claude Code's `Read` tool; without it the Harness sees only the prompt. */
  readonly read: boolean;
}
