import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { WorkspaceId } from "./ids.ts";
import { PredictionEndpointUrl } from "./predictionEndpoint.ts";

export { PredictionEndpointUrl } from "./predictionEndpoint.ts";

const Offset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const Positive = Schema.Int.check(Schema.isGreaterThan(0));

const Text = Schema.String.check(Schema.isMaxLength(1_048_576));

export const PREDICTION_CAPABILITIES = [
  "prediction.capability",
  "prediction.context",
  "prediction.complete",
  "prediction.edit",
  /** `prediction.server`: what the model server behind an endpoint is, and its recovery actions. */
  "prediction.server",
] as const;

export const PredictionFormat = Schema.Literals(["mellum-spm", "qwen-fim", "suffix"]);

export type PredictionFormat = typeof PredictionFormat.Type;

export const PredictionEndpoint = Schema.Struct({
  kind: Schema.Literals(["openai", "ollama"]),
  /** Base URL, optionally including /v1 for OpenAI-compatible endpoints. */
  url: Schema.String.check(Schema.isMaxLength(2048)),
});

export type PredictionEndpoint = typeof PredictionEndpoint.Type;

export const PredictionContextPiece = Schema.Struct({
  kind: Schema.Literals(["definition", "importOutline", "diagnostic", "editHunk"]),
  text: Text,
  source: Schema.String,
});

export type PredictionContextPiece = typeof PredictionContextPiece.Type;

/** Ordered Host context. Stable definitions and outlines precede volatile pieces. */

export const PredictionContext = Schema.Array(PredictionContextPiece).check(
  Schema.isMaxLength(128)
);

export type PredictionContext = typeof PredictionContext.Type;

export const PredictionRecentEdit = Schema.Struct({
  path: Schema.String,
  from: Offset,
  to: Offset,
  text: Text,
});

export type PredictionRecentEdit = typeof PredictionRecentEdit.Type;

export const PredictionContextRequest = Schema.Struct({
  workspaceId: WorkspaceId,
  path: Schema.String,
  buffer: Text,
  /** Absolute UTF-16 offset into buffer, including unsaved edits. */
  cursor: Offset,
  recentEdits: Schema.Array(PredictionRecentEdit).check(Schema.isMaxLength(128)),
  budgetTokens: Positive.check(Schema.isLessThanOrEqualTo(32768)),
});

export type PredictionContextRequest = typeof PredictionContextRequest.Type;

export const PredictionMachine = Schema.Struct({
  chip: Schema.String,
  cpuCores: Positive,
  ramBytes: Offset,
  gpu: Schema.NullOr(Schema.String),
  gpuMemoryBytes: Schema.NullOr(Offset),
  unifiedMemory: Schema.Boolean,
  /** One-minute load average; null when unavailable. */
  load: Schema.NullOr(Schema.Number),
});

export type PredictionMachine = typeof PredictionMachine.Type;

export const PredictionCapability = Schema.Struct({
  machine: PredictionMachine,
  endpoints: Schema.Array(
    Schema.Struct({
      ...PredictionEndpoint.fields,
      models: Schema.Array(Schema.String),
    })
  ),
});

export type PredictionCapability = typeof PredictionCapability.Type;

export const PredictionRequest = Schema.Struct({
  context: PredictionContext,
  path: Schema.String,
  prefix: Text,
  suffix: Text,
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  format: PredictionFormat,
  endpoint: PredictionEndpoint,
  budgetTokens: Positive.check(Schema.isLessThanOrEqualTo(32768)),
  maxTokens: Positive.check(Schema.isLessThanOrEqualTo(1024)),
  maxLines: Positive.check(Schema.isLessThanOrEqualTo(100)),
});

export type PredictionRequest = typeof PredictionRequest.Type;

export const PredictionStreamItem = Schema.TaggedUnion({
  /** Provisional raw text. Use Final.text for acceptance after post-processing. */
  Delta: { text: Schema.String },
  /** Exactly one final on successful completion; empty text means abstention. */
  Final: { text: Schema.String, elapsedMs: Schema.Number },
});

export type PredictionStreamItem = typeof PredictionStreamItem.Type;

export class PredictionError extends Schema.TaggedError<PredictionError>()("PredictionError", {
  reason: Schema.Literals([
    "unavailable",
    "invalid-request",
    "endpoint-failed",
    "invalid-response",
  ]),
  message: Schema.String,
}) {}

/** Absent or empty endpoints probes the Host defaults only (8080, 1234, 11434). */
export const PredictionCapabilityRequest = Schema.UndefinedOr(
  Schema.Struct({
    endpoints: Schema.optional(Schema.Array(PredictionEndpointUrl).check(Schema.isMaxLength(16))),
  })
);

export type PredictionCapabilityRequest = typeof PredictionCapabilityRequest.Type;

export const PredictionCapabilityQuery = Rpc.make("prediction.capability", {
  payload: PredictionCapabilityRequest,
  success: PredictionCapability,
  error: PredictionError,
});

export const PredictionContextQuery = Rpc.make("prediction.context", {
  payload: PredictionContextRequest,
  success: PredictionContext,
  error: PredictionError,
});

/** Ephemeral: consumption cancellation aborts HTTP; no event-log or file writes. */

export const PredictionComplete = Rpc.make("prediction.complete", {
  payload: PredictionRequest,
  success: PredictionStreamItem,
  error: PredictionError,
  stream: true,
});

/** The server answering an OpenAI-compatible or Ollama endpoint, told apart by its own API. */
export const PredictionServerKind = Schema.Literals([
  "llama-server",
  "ollama",
  "lm-studio",
  "unknown",
]);

export type PredictionServerKind = typeof PredictionServerKind.Type;

/** Recovery through the server's own API; Polaris never starts or stops its process. */
export const PredictionServerAction = Schema.Literals(["clear-cache", "reload-model"]);

export type PredictionServerAction = typeof PredictionServerAction.Type;

export const PredictionServerRequest = Schema.Struct({
  endpoint: Schema.Struct({ kind: PredictionEndpoint.fields.kind, url: PredictionEndpointUrl }),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  /** Null only identifies the server. */
  action: Schema.NullOr(PredictionServerAction),
});

export type PredictionServerRequest = typeof PredictionServerRequest.Type;

export const PredictionServerReport = Schema.Struct({
  kind: PredictionServerKind,
  actions: Schema.Array(PredictionServerAction),
  /** What the action did, in words; null when only identifying. */
  outcome: Schema.NullOr(Schema.String),
});

export type PredictionServerReport = typeof PredictionServerReport.Type;

export const PredictionServerQuery = Rpc.make("prediction.server", {
  payload: PredictionServerRequest,
  success: PredictionServerReport,
  error: PredictionError,
});
