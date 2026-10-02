import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { WorkspaceId } from "./ids.ts";
import { ModelId, ReasoningEffort } from "./models.ts";

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Half-open UTF-16 offsets into the exact buffer supplied by the Client. */
export const InlineRange = Schema.Struct({ from: Offset, to: Offset });

export const InlineRequest = Schema.Struct({
  workspaceId: WorkspaceId,
  path: Schema.String,
  /** Includes unsaved edits; agents otherwise only see disk. */
  content: Schema.String,
  selection: InlineRange,
  prompt: Schema.String,
  harness: Schema.Literals(["codex", "claude"]),
  model: Schema.NullOr(ModelId),
  effort: Schema.NullOr(ReasoningEffort),
});

export type InlineRequest = typeof InlineRequest.Type;

/** Ranges are ordered, non-overlapping and confined to the requested selection. */
export const InlinePatch = Schema.Struct({
  replacements: Schema.Array(Schema.Struct({ from: Offset, to: Offset, text: Schema.String })),
  summary: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
});

export type InlinePatch = typeof InlinePatch.Type;

export const InlineStreamItem = Schema.TaggedUnion({
  /** Provisional Harness text, never applied as an edit. */
  Delta: { text: Schema.String },
  /** Exactly one final patch. The Client checks its buffer is unchanged before applying. */
  Proposed: { patch: InlinePatch, thoughtMs: Offset },
});

export type InlineStreamItem = typeof InlineStreamItem.Type;

export class InlineError extends Schema.TaggedError<InlineError>()("InlineError", {
  reason: Schema.Literals(["invalid-request", "invalid-patch", "harness-failed"]),
  message: Schema.String,
}) {}

/** Preserve the selection and proposal as sources when starting a normal Agent Session. */
export const inlineSessionPrompt = (request: InlineRequest, patch: InlinePatch | null): string =>
  [
    request.prompt,
    "Source: editor selection (may contain unsaved edits)",
    JSON.stringify({
      path: request.path,
      selection: request.selection,
      text: request.content.slice(request.selection.from, request.selection.to),
    }),
    ...(patch === null ? [] : ["Inline proposal:", JSON.stringify(patch)]),
  ].join("\n\n");

/** Ending consumption cancels the Harness work; proposals never write files or commit events. */
export const InlinePropose = Rpc.make("inline.propose", {
  payload: InlineRequest,
  success: InlineStreamItem,
  error: InlineError,
  stream: true,
});
