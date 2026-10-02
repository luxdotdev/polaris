import { Match, Schema } from "effect";
import {
  LanguageCheckout,
  LanguageContextIdentity,
  LanguageCounter,
  LanguageDocumentFence,
  LanguageGeneration,
  LanguageKey,
  LanguagePositionEncoding,
  LanguageRange,
  LanguageUri,
} from "./base.ts";
import { FileVersion } from "../files.ts";

export const LanguageDocumentText = Schema.String.check(Schema.isMaxLength(1048576));

export const LanguageContentChange = Schema.Struct({
  range: Schema.optionalKey(LanguageRange),
  rangeLength: Schema.optionalKey(LanguageCounter),
  text: LanguageDocumentText,
});

export const LanguageDocumentNotification = Schema.TaggedUnion({
  Open: {
    uri: LanguageUri,
    languageId: LanguageKey,
    version: LanguageCounter,
    text: LanguageDocumentText,
  },
  Change: {
    uri: LanguageUri,
    previousVersion: LanguageCounter,
    version: LanguageCounter,
    changes: Schema.Array(LanguageContentChange).check(Schema.isBetweenLength(1, 1024)),
  },
  Close: { uri: LanguageUri, version: LanguageCounter },
  Save: {
    uri: LanguageUri,
    version: LanguageCounter,
    diskVersion: FileVersion,
    text: Schema.optionalKey(LanguageDocumentText),
  },
}).check(
  Schema.makeFilter((notification) =>
    Match.value(notification).pipe(
      Match.tag("Change", (change) => change.version > change.previousVersion),
      Match.orElse(() => true)
    )
  )
);

export type LanguageDocumentNotification = typeof LanguageDocumentNotification.Type;

export const LanguageSyncInput = Schema.Struct({
  context: LanguageContextIdentity,
  sequence: LanguageCounter.check(Schema.isGreaterThan(0)),
  notification: LanguageDocumentNotification,
});

export type LanguageSyncInput = typeof LanguageSyncInput.Type;

/** Accepted sequence means delivery to the ordered server queue, never completed analysis. */

export const LanguageSyncAck = Schema.Struct({
  context: LanguageContextIdentity,
  acceptedSequence: LanguageCounter,
  documents: Schema.Array(LanguageDocumentFence).check(Schema.isMaxLength(1024)),
});

export type LanguageSyncAck = typeof LanguageSyncAck.Type;

export const LanguageProviderCapabilities = Schema.Struct({
  positionEncoding: LanguagePositionEncoding,
  synchronization: Schema.Literals(["none", "full", "incremental"]),
  openClose: Schema.Boolean,
  save: Schema.Boolean,
  saveIncludeText: Schema.Boolean,
  methods: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).check(
    Schema.isMaxLength(256)
  ),
  completionResolve: Schema.Boolean,
  actionResolve: Schema.Boolean,
  executeCommands: Schema.Array(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
  ).check(Schema.isMaxLength(256)),
  diagnostics: Schema.Literals(["none", "push", "pull", "push-and-pull"]),
  workspaceDiagnostics: Schema.Boolean,
});

export type LanguageProviderCapabilities = typeof LanguageProviderCapabilities.Type;

export const LanguageRuntime = Schema.TaggedUnion({
  AwaitingTrust: {},
  Starting: {},
  Ready: { capabilities: LanguageProviderCapabilities },
  Stopped: { reason: Schema.Literals(["no-demand", "manual", "connection-lost", "replaced"]) },
  Failed: {
    message: Schema.String,
    attempts: LanguageCounter,
    retryAt: Schema.NullOr(LanguageCounter),
  },
  Unsupported: { message: Schema.String },
});

/** A result is usable only at this exact generation, queue cut and set of buffer versions. */

export const LanguageRequestFence = Schema.Struct({
  context: LanguageContextIdentity,
  requiredSequence: LanguageCounter,
  documents: Schema.Array(LanguageDocumentFence).check(Schema.isMaxLength(1024)),
});

export type LanguageRequestFence = typeof LanguageRequestFence.Type;

const sameCheckout = (left: LanguageCheckout, right: LanguageCheckout): boolean =>
  left.path === right.path &&
  left.workspaceId === right.workspaceId &&
  Match.value(left).pipe(
    Match.tag("Workspace", () =>
      Match.value(right).pipe(
        Match.tag("Workspace", () => true),
        Match.orElse(() => false)
      )
    ),
    Match.tag("Worktree", (checkout) =>
      Match.value(right).pipe(
        Match.tag("Worktree", (other) => checkout.worktreeId === other.worktreeId),
        Match.orElse(() => false)
      )
    ),
    Match.tag("ReviewCheckout", (checkout) =>
      Match.value(right).pipe(
        Match.tag(
          "ReviewCheckout",
          (other) => checkout.reviewCheckoutId === other.reviewCheckoutId
        ),
        Match.orElse(() => false)
      )
    ),
    Match.exhaustive
  );

/** Pure consumer guard; ownership, canonical paths and byte/range validation remain Daemon checks. */

export const languageFenceSatisfied = (
  fence: LanguageRequestFence,
  ack: LanguageSyncAck
): boolean =>
  fence.context.hostId === ack.context.hostId &&
  fence.context.clientId === ack.context.clientId &&
  fence.context.contextId === ack.context.contextId &&
  fence.context.generation === ack.context.generation &&
  fence.context.providerId === ack.context.providerId &&
  fence.context.configurationFingerprint === ack.context.configurationFingerprint &&
  fence.context.projectRoot === ack.context.projectRoot &&
  sameCheckout(fence.context.checkout, ack.context.checkout) &&
  fence.requiredSequence <= ack.acceptedSequence &&
  fence.documents.every((document) =>
    ack.documents.some(
      (current) => current.uri === document.uri && current.version === document.version
    )
  );

export const LanguageDiagnostic = Schema.Struct({
  range: LanguageRange,
  severity: Schema.NullOr(Schema.Literals([1, 2, 3, 4])),
  code: Schema.NullOr(Schema.Union([Schema.String, Schema.Int])),
  source: Schema.NullOr(Schema.String),
  message: Schema.String.check(Schema.isMaxLength(65536)),
  data: Schema.optionalKey(Schema.Json),
  codeDescription: Schema.optionalKey(Schema.Struct({ href: LanguageUri })),
  relatedInformation: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        location: Schema.Struct({ uri: LanguageUri, range: LanguageRange }),
        message: Schema.String.check(Schema.isMaxLength(65536)),
      })
    ).check(Schema.isMaxLength(128))
  ),
  tags: Schema.Array(Schema.Literals([1, 2])).check(Schema.isMaxLength(2)),
});

export const LanguageDiagnostics = Schema.Struct({
  context: LanguageContextIdentity,
  uri: LanguageUri,
  providerId: LanguageKey,
  generation: LanguageGeneration,
  version: Schema.NullOr(LanguageCounter),
  freshness: Schema.Literals(["versioned", "unversioned", "last-known"]),
  kind: Schema.Literals(["full", "unchanged"]),
  resultId: Schema.NullOr(Schema.String),
  previousResultId: Schema.NullOr(Schema.String),
  items: Schema.Array(LanguageDiagnostic).check(Schema.isMaxLength(2000)),
  truncated: Schema.Boolean,
}).check(
  Schema.makeFilter(
    (value) =>
      JSON.stringify(value).length <= 1048576 &&
      value.providerId === value.context.providerId &&
      value.generation === value.context.generation &&
      (value.freshness !== "versioned" || value.version !== null) &&
      (value.kind !== "unchanged" || (value.items.length === 0 && value.resultId !== null))
  )
);

export type LanguageDiagnostics = typeof LanguageDiagnostics.Type;
