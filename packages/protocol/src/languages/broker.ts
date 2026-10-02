import { Schema } from "effect";
import {
  LanguageContextIdentity,
  LanguageCounter,
  LanguageDeadline,
  LanguageJson,
  LanguageJsonObject,
  LanguageKey,
  LanguageText,
  LanguageUri,
} from "./base.ts";
import {
  LanguageDiagnostics,
  LanguageProviderCapabilities,
  LanguageRequestFence,
  LanguageRuntime,
  LanguageSyncAck,
} from "./documents.ts";
import { LanguageEditProposal } from "./edits.ts";

export const LanguageMethod = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.makeFilter((value) => !value.includes(String.fromCharCode(0)))
);

export const LanguageRpcId = Schema.Union([
  Schema.String.check(Schema.isMaxLength(256)),
  Schema.Int.check(
    Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER })
  ),
]);

const NoField = Schema.optionalKey(Schema.Never);

const Parameters = Schema.optionalKey(
  Schema.Union([LanguageJsonObject, Schema.Array(LanguageJson).check(Schema.isMaxLength(4096))])
);

export const LanguageJsonRpcRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: LanguageRpcId,
  method: LanguageMethod,
  params: Parameters,
  result: NoField,
  error: NoField,
});

export const LanguageJsonRpcNotification = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  method: LanguageMethod,
  params: Parameters,
  id: NoField,
  result: NoField,
  error: NoField,
});

export const LanguageJsonRpcResponse = Schema.Union([
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: LanguageRpcId,
    result: LanguageJson,
    error: NoField,
    method: NoField,
    params: NoField,
  }),
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.NullOr(LanguageRpcId),
    error: Schema.Struct({
      code: Schema.Int,
      message: LanguageText,
      data: Schema.optionalKey(LanguageJson),
    }),
    result: NoField,
    method: NoField,
    params: NoField,
  }),
]);

export const LanguageJsonRpcEnvelope = Schema.Union([
  LanguageJsonRpcRequest,
  LanguageJsonRpcNotification,
  LanguageJsonRpcResponse,
]);

export type LanguageJsonRpcEnvelope = typeof LanguageJsonRpcEnvelope.Type;

export const LanguageFeatureMethod = Schema.Literals([
  "textDocument/completion",
  "completionItem/resolve",
  "textDocument/hover",
  "textDocument/signatureHelp",
  "textDocument/definition",
  "textDocument/typeDefinition",
  "textDocument/implementation",
  "textDocument/references",
  "textDocument/prepareRename",
  "textDocument/rename",
  "textDocument/codeAction",
  "codeAction/resolve",
  "workspace/executeCommand",
  "textDocument/documentSymbol",
  "workspace/symbol",
  "workspaceSymbol/resolve",
  "textDocument/diagnostic",
  "workspace/diagnostic",
]);
/** LSP payloads remain bounded JSON; feature adapters decode method-specific data before use. */

export const LanguageFeatureRequest = Schema.Struct({
  requestId: LanguageKey,
  fence: LanguageRequestFence,
  method: LanguageFeatureMethod,
  params: LanguageJsonObject,
  deadline: LanguageDeadline,
});

export type LanguageFeatureRequest = typeof LanguageFeatureRequest.Type;

export const LanguageFeatureResult = Schema.Struct({
  requestId: LanguageKey,
  fence: LanguageRequestFence,
  result: LanguageJson,
  proposals: Schema.optionalKey(Schema.Array(LanguageEditProposal).check(Schema.isMaxLength(128))),
});

export type LanguageFeatureResult = typeof LanguageFeatureResult.Type;

export const LanguageConfigurationItem = Schema.Struct({
  scopeUri: Schema.optionalKey(LanguageUri),
  section: Schema.optionalKey(LanguageText),
});

export const LanguageRegistration = Schema.Struct({
  id: LanguageKey,
  method: LanguageMethod,
  registerOptions: Schema.optionalKey(LanguageJsonObject),
});

export const LanguageServerRequest = Schema.Struct({
  context: LanguageContextIdentity,
  request: LanguageJsonRpcRequest,
  deadline: LanguageDeadline,
});

export type LanguageServerRequest = typeof LanguageServerRequest.Type;

export const LanguageServerResponse = Schema.Struct({
  context: LanguageContextIdentity,
  response: LanguageJsonRpcResponse,
});

export const LanguageServerRequestPayload = Schema.TaggedUnion({
  Configuration: { items: Schema.Array(LanguageConfigurationItem).check(Schema.isMaxLength(256)) },
  Register: { registrations: Schema.Array(LanguageRegistration).check(Schema.isMaxLength(256)) },
  Unregister: {
    unregistrations: Schema.Array(Schema.Struct({ id: LanguageKey, method: LanguageMethod })).check(
      Schema.isMaxLength(256)
    ),
  },
  ProgressCreate: { token: LanguageRpcId },
  WorkspaceFolders: {},
  ShowMessage: {
    type: Schema.Literals([1, 2, 3, 4]),
    message: LanguageText,
    actions: Schema.Array(Schema.Struct({ title: LanguageText })).check(Schema.isMaxLength(32)),
  },
  ApplyEdit: { proposal: LanguageEditProposal },
  Unsupported: { method: LanguageMethod },
});

/** Every configuration item has a corresponding result, in request order; null means no value. */

export const LanguageConfigurationResponse = Schema.Struct({
  values: Schema.Array(LanguageJson).check(Schema.isMaxLength(256)),
});

export const LanguageProgress = Schema.Struct({
  context: LanguageContextIdentity,
  token: LanguageRpcId,
  value: Schema.TaggedUnion({
    Begin: {
      title: LanguageText,
      message: Schema.optionalKey(LanguageText),
      percentage: Schema.optionalKey(
        Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
      ),
      cancellable: Schema.optionalKey(Schema.Boolean),
    },
    Report: {
      message: Schema.optionalKey(LanguageText),
      percentage: Schema.optionalKey(
        Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 100 }))
      ),
      cancellable: Schema.optionalKey(Schema.Boolean),
    },
    End: { message: Schema.optionalKey(LanguageText) },
  }),
});

export const LanguageContextEvent = Schema.TaggedUnion({
  Snapshot: { context: LanguageContextIdentity, runtime: LanguageRuntime, ack: LanguageSyncAck },
  RuntimeChanged: { context: LanguageContextIdentity, runtime: LanguageRuntime },
  Synchronized: { ack: LanguageSyncAck },
  CapabilitiesChanged: {
    context: LanguageContextIdentity,
    capabilities: LanguageProviderCapabilities,
    registrations: Schema.Array(LanguageRegistration).check(Schema.isMaxLength(256)),
  },
  Diagnostics: { diagnostics: LanguageDiagnostics },
  ServerRequest: { request: LanguageServerRequest, payload: LanguageServerRequestPayload },
  Progress: { progress: LanguageProgress },
  Log: {
    context: LanguageContextIdentity,
    level: Schema.Literals(["error", "warning", "info", "debug"]),
    message: LanguageText,
  },
  Invalidated: {
    context: LanguageContextIdentity,
    reason: Schema.Literals(["connection-lost", "restart", "settings-changed", "closed"]),
  },
});

export type LanguageContextEvent = typeof LanguageContextEvent.Type;

export const LanguageLimits = Schema.Struct({
  messageBytes: LanguageCounter,
  queuedMessages: LanguageCounter,
  outstandingRequests: LanguageCounter,
  documents: LanguageCounter,
  diagnosticsPerDocument: LanguageCounter,
  logBytes: LanguageCounter,
  requestTimeoutMs: LanguageCounter,
});
