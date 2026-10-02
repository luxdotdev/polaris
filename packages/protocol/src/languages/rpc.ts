import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { BlobId, WorkspaceId } from "../ids.ts";
import {
  LanguageCheckout,
  LanguageContextIdentity,
  LanguageCounter,
  LanguageError,
  LanguageKey,
  LanguagePath,
  LanguageUri,
} from "./base.ts";
import {
  LanguageAvailability,
  LanguageCatalog,
  LanguageInstallProgress,
  LanguageLaunchFact,
  LanguagePreflight,
  LanguagePrerequisiteFact,
} from "./catalog.ts";
import {
  LanguageContextEvent,
  LanguageFeatureRequest,
  LanguageFeatureResult,
  LanguageLimits,
  LanguageRpcId,
  LanguageServerResponse,
} from "./broker.ts";
import { LanguageRuntime, LanguageSyncAck, LanguageSyncInput } from "./documents.ts";
import {
  LanguageEditAcceptance,
  LanguageFormatOutcome,
  LanguageFormatPreflight,
  LanguageOperationOutcome,
} from "./edits.ts";
import {
  LanguageEffectiveSettings,
  LanguagePreviewPolicy,
  LanguageSettingsPatch,
  LanguageSettingsRecord,
  LanguageSettingsScope,
  LanguageTrust,
  LanguageTrustScope,
} from "./settings.ts";

export const GetLanguageCatalog = Rpc.make("languages.catalog", {
  payload: {},
  success: LanguageCatalog,
  error: LanguageError,
});

export const GetLanguageAvailability = Rpc.make("languages.availability", {
  payload: {
    toolIds: Schema.Array(LanguageKey).check(Schema.isMaxLength(512)),
    checkout: Schema.NullOr(LanguageCheckout),
    refresh: Schema.Boolean,
    phase: Schema.Literals(["install", "feature"]),
  },
  success: Schema.Array(LanguageAvailability).check(Schema.isMaxLength(512)),
  error: LanguageError,
});

export const InstallLanguageTool = Rpc.make("languages.install", {
  payload: {
    toolId: LanguageKey,
    version: Schema.String,
    intent: Schema.Literals(["first-encounter", "manual", "update", "rollback"]),
  },
  success: Schema.Struct({ jobId: LanguageKey }),
  error: LanguageError,
});

export const CancelLanguageInstall = Rpc.make("languages.install.cancel", {
  payload: { jobId: LanguageKey },
  success: Schema.Void,
  error: LanguageError,
});

export const WatchLanguageInstall = Rpc.make("languages.install.watch", {
  payload: { jobId: LanguageKey },
  success: LanguageInstallProgress,
  error: LanguageError,
  stream: true,
});

export const WatchLanguageAvailability = Rpc.make("languages.availability.watch", {
  payload: {
    toolIds: Schema.Array(LanguageKey).check(Schema.isMaxLength(512)),
    checkout: Schema.NullOr(LanguageCheckout),
  },
  success: Schema.Array(LanguageAvailability).check(Schema.isMaxLength(512)),
  error: LanguageError,
  stream: true,
});

export const LanguageDiscovery = Schema.Struct({
  checkout: LanguageCheckout,
  projectRoot: LanguagePath,
  providers: Schema.Array(
    Schema.Struct({
      providerId: LanguageKey,
      preflight: LanguagePreflight,
      launch: Schema.NullOr(LanguageLaunchFact),
      prerequisites: Schema.Array(LanguagePrerequisiteFact).check(Schema.isMaxLength(64)),
    })
  ).check(Schema.isMaxLength(32)),
  effectiveSettings: LanguageEffectiveSettings,
  trust: LanguageTrust,
});

export const DiscoverLanguageProject = Rpc.make("languages.discover", {
  payload: {
    checkout: LanguageCheckout,
    path: LanguagePath,
    documentLanguageId: LanguageKey,
    settings: LanguageEffectiveSettings,
  },
  success: LanguageDiscovery,
  error: LanguageError,
});

export const GetLanguageTrust = Rpc.make("languages.trust.get", {
  payload: { scope: LanguageTrustScope },
  success: LanguageTrust,
  error: LanguageError,
});

export const SetLanguageTrust = Rpc.make("languages.trust.set", {
  payload: {
    scope: LanguageTrustScope,
    trusted: Schema.Boolean,
    expectedRevision: LanguageCounter,
  },
  success: LanguageTrust,
  error: LanguageError,
});

export const LanguageContextSnapshot = Schema.Struct({
  context: LanguageContextIdentity,
  runtime: LanguageRuntime,
  ack: LanguageSyncAck,
  limits: LanguageLimits,
});

export const AcquireLanguageContext = Rpc.make("languages.context.acquire", {
  payload: {
    clientId: LanguageKey,
    contextId: LanguageKey,
    checkout: LanguageCheckout,
    path: LanguagePath,
    providerId: LanguageKey,
    settings: LanguageEffectiveSettings,
    interestId: LanguageKey,
  },
  success: LanguageContextSnapshot,
  error: LanguageError,
});

export const ReleaseLanguageContext = Rpc.make("languages.context.release", {
  payload: { context: LanguageContextIdentity, interestId: LanguageKey },
  success: Schema.Void,
  error: LanguageError,
});

export const RestartLanguageContext = Rpc.make("languages.context.restart", {
  payload: { context: LanguageContextIdentity },
  success: LanguageContextSnapshot,
  error: LanguageError,
});

export const WatchLanguageContext = Rpc.make("languages.context.watch", {
  payload: { context: LanguageContextIdentity },
  success: LanguageContextEvent,
  error: LanguageError,
  stream: true,
});

export const SyncLanguageDocument = Rpc.make("languages.document.sync", {
  payload: LanguageSyncInput,
  success: LanguageSyncAck,
  error: LanguageError,
});

export const RequestLanguageFeature = Rpc.make("languages.request", {
  payload: LanguageFeatureRequest,
  success: LanguageFeatureResult,
  error: LanguageError,
});

export const CancelLanguageRequest = Rpc.make("languages.cancel", {
  payload: { context: LanguageContextIdentity, requestId: LanguageKey },
  success: Schema.Void,
  error: LanguageError,
});

export const CancelLanguageProgress = Rpc.make("languages.progress.cancel", {
  payload: { context: LanguageContextIdentity, token: LanguageRpcId },
  success: Schema.Void,
  error: LanguageError,
});

export const RespondLanguageServer = Rpc.make("languages.server.respond", {
  payload: LanguageServerResponse,
  success: Schema.Void,
  error: LanguageError,
});

export const ConfigureLanguageContext = Rpc.make("languages.context.configure", {
  payload: { context: LanguageContextIdentity, settings: LanguageEffectiveSettings },
  success: LanguageContextSnapshot,
  error: LanguageError,
});

export const PreflightLanguageFormat = Rpc.make("languages.format", {
  payload: LanguageFormatPreflight,
  success: LanguageFormatOutcome,
  error: LanguageError,
});

export const AcceptLanguageEdit = Rpc.make("languages.edit.decide", {
  payload: LanguageEditAcceptance,
  success: LanguageOperationOutcome,
  error: LanguageError,
});

export const GetLanguageOperation = Rpc.make("languages.operation.get", {
  payload: { checkout: LanguageCheckout, clientId: LanguageKey, operationId: LanguageKey },
  success: LanguageOperationOutcome,
  error: LanguageError,
});

export const RecoverLanguageOperation = Rpc.make("languages.operation.recover", {
  payload: {
    checkout: LanguageCheckout,
    clientId: LanguageKey,
    operationId: LanguageKey,
    intent: Schema.Literals(["recover", "undo", "cancel"]),
    expectedReceiptRevision: LanguageCounter,
  },
  success: LanguageOperationOutcome,
  error: LanguageError,
});

export const LanguagePreviewMedia = Schema.Struct({
  uri: LanguageUri,
  mimeType: Schema.String.check(Schema.isPattern(/^image\/(png|jpeg|gif|webp|avif)$/)),
  bytes: LanguageCounter.check(Schema.isLessThanOrEqualTo(10485760)),
  blobId: BlobId,
});

export const ReadLanguagePreviewMedia = Rpc.make("languages.preview.media", {
  payload: {
    checkout: LanguageCheckout,
    documentPath: LanguagePath,
    relativePath: LanguagePath,
    maxBytes: LanguageCounter.check(Schema.isBetween({ minimum: 1, maximum: 10485760 })),
  },
  success: LanguagePreviewMedia,
  error: LanguageError,
});

/** Reserved local configuration RPC-shaped schemas for IPC; never persisted as Host installation facts. */

export const GetLanguageSettings = Rpc.make("languages.settings.get", {
  payload: { scope: LanguageSettingsScope },
  success: LanguageSettingsRecord,
  error: LanguageError,
});

export const SetLanguageSettings = Rpc.make("languages.settings.set", {
  payload: {
    scope: LanguageSettingsScope,
    expectedRevision: LanguageCounter,
    settings: LanguageSettingsPatch,
  },
  success: LanguageSettingsRecord,
  error: LanguageError,
});

export const GetLanguagePreviewPolicy = Rpc.make("languages.preview.policy.get", {
  payload: { workspaceId: WorkspaceId },
  success: LanguagePreviewPolicy,
  error: LanguageError,
});

export const SetLanguagePreviewPolicy = Rpc.make("languages.preview.policy.set", {
  payload: { policy: LanguagePreviewPolicy },
  success: LanguagePreviewPolicy,
  error: LanguageError,
});

/** Opt-in extension: C1/T1 register only implemented methods; do not merge into DaemonRpcs yet. */

export class LanguageRpcs extends RpcGroup.make(
  GetLanguageCatalog,
  GetLanguageAvailability,
  WatchLanguageAvailability,
  InstallLanguageTool,
  CancelLanguageInstall,
  WatchLanguageInstall,
  DiscoverLanguageProject,
  GetLanguageTrust,
  SetLanguageTrust,
  AcquireLanguageContext,
  ReleaseLanguageContext,
  RestartLanguageContext,
  WatchLanguageContext,
  SyncLanguageDocument,
  RequestLanguageFeature,
  CancelLanguageRequest,
  CancelLanguageProgress,
  RespondLanguageServer,
  ConfigureLanguageContext,
  PreflightLanguageFormat,
  AcceptLanguageEdit,
  GetLanguageOperation,
  RecoverLanguageOperation,
  ReadLanguagePreviewMedia
) {}
