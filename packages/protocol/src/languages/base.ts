import { Schema } from "effect";
import { HostId, ReviewCheckoutId, WorkspaceId, WorktreeId } from "../ids.ts";

export const LanguageKey = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
);

export const LanguageText = Schema.String.check(Schema.isMaxLength(65536));

export const LanguagePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.makeFilter((value) => !value.includes(String.fromCharCode(0)))
);

export const LanguageCounter = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
);

export const LanguageGeneration = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })
);

export const LanguageDeadline = Schema.Finite.check(Schema.isGreaterThan(0));

export const LanguageFingerprint = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

/** Transport must cap raw bytes before JSON parsing; this bounds decoded JSON payloads too. */

export const LanguageJson = Schema.Json.check(
  Schema.makeFilter((value) => JSON.stringify(value).length <= 1048576)
);

export const LanguageJsonObject = Schema.JsonObject.check(
  Schema.makeFilter((value) => JSON.stringify(value).length <= 1048576)
);

export const LanguageUri = Schema.String.check(
  Schema.isMaxLength(8192),
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9+.-]*:/),
  Schema.makeFilter((value) => !value.includes(String.fromCharCode(0)))
);

export const LanguageCheckout = Schema.TaggedUnion({
  Workspace: { workspaceId: WorkspaceId, path: LanguagePath },
  Worktree: { workspaceId: WorkspaceId, worktreeId: WorktreeId, path: LanguagePath },
  ReviewCheckout: {
    workspaceId: WorkspaceId,
    reviewCheckoutId: ReviewCheckoutId,
    path: LanguagePath,
  },
});

export type LanguageCheckout = typeof LanguageCheckout.Type;

/** Daemon resolves canonical paths and binds clientId to the authenticated connection. */

export const LanguageContextIdentity = Schema.Struct({
  hostId: HostId,
  clientId: LanguageKey,
  contextId: LanguageKey,
  checkout: LanguageCheckout,
  projectRoot: LanguagePath,
  providerId: LanguageKey,
  configurationFingerprint: LanguageFingerprint,
  generation: LanguageGeneration,
});

export type LanguageContextIdentity = typeof LanguageContextIdentity.Type;

export const LanguagePositionEncoding = Schema.Literals(["utf-8", "utf-16", "utf-32"]);

export const LanguagePosition = Schema.Struct({
  line: LanguageCounter,
  character: LanguageCounter,
});

export const LanguageRange = Schema.Struct({
  start: LanguagePosition,
  end: LanguagePosition,
}).check(
  Schema.makeFilter(
    ({ start, end }) =>
      start.line < end.line || (start.line === end.line && start.character <= end.character)
  )
);

export const LanguageDocumentFence = Schema.Struct({ uri: LanguageUri, version: LanguageCounter });

export type LanguageDocumentFence = typeof LanguageDocumentFence.Type;

export class LanguageError extends Schema.TaggedError<LanguageError>()("LanguageError", {
  reason: Schema.Literals([
    "unsupported-capability",
    "invalid-input",
    "not-owner",
    "not-connected",
    "not-offered",
    "audit-required",
    "unsupported-platform",
    "missing-prerequisite",
    "awaiting-trust",
    "not-installed",
    "not-ready",
    "queue-full",
    "too-large",
    "method-not-found",
    "timeout",
    "cancelled",
    "stale-generation",
    "stale-document",
    "conflict",
    "install-failed",
    "server-failed",
    "format-failed",
    "recovery-required",
  ]),
  message: LanguageText,
  retryable: Schema.Boolean,
}) {}
