/**
 * The model server a Daemon runs itself for tab completion (ADR 0049): what it would
 * download for this machine, where it is in its lifecycle, and the actions on it.
 * Ephemeral: nothing here enters the event log.
 */
import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import { PredictionEndpoint, PredictionError } from "./prediction.ts";

const Bytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ManagedModelId = Schema.Literals(["zeta-2.1", "sweep-next-edit-1.5b"]);

export type ManagedModelId = typeof ManagedModelId.Type;

/** The model the setup would download (Sweep unless the user chose Zeta, spec §2), with its sizes. */
export const ManagedModelFacts = Schema.Struct({
  id: ManagedModelId,
  /** "Zeta 2.1", "Sweep Next-Edit 1.5B". */
  name: Schema.String,
  sizeBytes: Bytes,
  /** The server build's archive, so the setup step can say the whole download. */
  serverBytes: Bytes,
  /** What the loaded model takes in memory, roughly, for the opt-in's cost in Settings. */
  memoryBytes: Bytes,
});

export type ManagedModelFacts = typeof ManagedModelFacts.Type;

export const ManagedFailureReason = Schema.Literals([
  "no-space",
  "download-failed",
  "checksum-mismatch",
  "server-failed",
  "folder-unwritable",
]);

export type ManagedFailureReason = typeof ManagedFailureReason.Type;

/** The lifecycle, as the Daemon's machine reports it; one phase at a time. */
export const ManagedServerPhase = Schema.TaggedUnion({
  /** This machine can't run a managed server: no build for its platform, or it is too small. */
  Unsupported: { reason: Schema.Literals(["platform", "too-small"]) },
  /** Nothing downloaded yet: the setup step applies. */
  Absent: {},
  Downloading: {
    file: Schema.Literals(["server", "model"]),
    receivedBytes: Bytes,
    totalBytes: Bytes,
  },
  Verifying: {},
  /** Downloaded and verified; the server starts on the next completion request. */
  Stopped: {},
  /** The process is up and loading the model. */
  Starting: {},
  Serving: {},
  /** Crashed; the next start waits `retryInMs`. */
  Backoff: { attempt: Schema.Int, retryInMs: Bytes },
  Failed: {
    reason: ManagedFailureReason,
    message: Schema.String,
    /** The server's last stderr lines, for "won't start"; empty otherwise. */
    log: Schema.Array(Schema.String).check(Schema.isMaxLength(40)),
  },
});

export type ManagedServerPhase = typeof ManagedServerPhase.Type;

export const ManagedServerStatus = Schema.Struct({
  model: ManagedModelFacts,
  /** The folder the model and the server build live in, as resolved on the Host. */
  modelsDir: Schema.String,
  /** Free space in that folder's filesystem; null when it can't be read. */
  freeBytes: Schema.NullOr(Bytes),
  /** Known once a port is chosen, whether or not the server is up. */
  endpoint: Schema.NullOr(PredictionEndpoint),
  phase: ManagedServerPhase,
  /** The server process's resident memory while it runs; null otherwise. */
  memoryBytes: Schema.NullOr(Bytes),
  /** How long the running server took to load its model; null until it serves and once it unloads. */
  loadMs: Schema.NullOr(Bytes),
});

export type ManagedServerStatus = typeof ManagedServerStatus.Type;

/** A query's answer: the status, and whether this call started the server or joined a start. */
export const ManagedServerAnswer = Schema.Struct({
  ...ManagedServerStatus.fields,
  /** True when the caller waited for the model to load, so the wait isn't completion latency. */
  launched: Schema.Boolean,
});

export type ManagedServerAnswer = typeof ManagedServerAnswer.Type;

export const ManagedServerAction = Schema.Literals([
  /** Download (or resume) the build and the model into `modelsDir`. */
  "setup",
  "cancel",
  /** Start the server and answer once it serves; a no-op while it does. */
  "start",
  "stop",
  /** Stop and delete the model and the build. */
  "remove",
]);

export type ManagedServerAction = typeof ManagedServerAction.Type;

export const ManagedServerRequest = Schema.Struct({
  /** Null is the Host's default, `~/.polaris/models`. */
  modelsDir: Schema.NullOr(Schema.String.check(Schema.isMaxLength(4096))),
  /** Null is the default, Sweep; "zeta-2.1" is the user's higher-quality opt-in. */
  model: Schema.NullOr(ManagedModelId),
  /** Null only reports the status. */
  action: Schema.NullOr(ManagedServerAction),
});

export type ManagedServerRequest = typeof ManagedServerRequest.Type;

export const PredictionManagedQuery = Rpc.make("prediction.managed", {
  payload: ManagedServerRequest,
  success: ManagedServerAnswer,
  error: PredictionError,
});

/** The status now, then every change while the stream is open. */
export const PredictionManagedWatch = Rpc.make("prediction.managed.watch", {
  payload: Schema.Struct({
    modelsDir: ManagedServerRequest.fields.modelsDir,
    model: ManagedServerRequest.fields.model,
  }),
  success: ManagedServerStatus,
  error: PredictionError,
  stream: true,
});
