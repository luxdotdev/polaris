import { Schema } from "effect";
import { FileVersion } from "../files.ts";
import { HostId } from "../ids.ts";

import {
  LanguageCheckout,
  LanguageCounter,
  LanguageDeadline,
  LanguageDocumentFence,
  LanguageJsonObject,
  LanguageKey,
  LanguagePath,
  LanguageRange,
  LanguageText,
  LanguageUri,
} from "./base.ts";
import { LanguageDocumentText, LanguageRequestFence } from "./documents.ts";
import { LanguageFormatterSelection } from "./settings.ts";

const LanguageDiskVersion = FileVersion.check(
  Schema.makeFilter(
    (version) =>
      Number.isFinite(version.mtimeMs) &&
      Number.isSafeInteger(version.size) &&
      version.size >= 0 &&
      /^[a-f0-9]{64}$/.test(version.hash)
  )
);

export const LanguageTextEdit = Schema.Struct({
  range: LanguageRange,
  newText: LanguageDocumentText,
  annotationId: Schema.optionalKey(LanguageKey),
});

export const LanguageTextDocumentEdit = Schema.Struct({
  textDocument: Schema.Struct({ uri: LanguageUri, version: Schema.NullOr(LanguageCounter) }),
  edits: Schema.Array(LanguageTextEdit).check(Schema.isMaxLength(4096)),
});

export const LanguageResourceOperation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    uri: LanguageUri,
    options: Schema.optionalKey(
      Schema.Struct({
        overwrite: Schema.optionalKey(Schema.Boolean),
        ignoreIfExists: Schema.optionalKey(Schema.Boolean),
      })
    ),
    annotationId: Schema.optionalKey(LanguageKey),
  }),
  Schema.Struct({
    kind: Schema.Literal("rename"),
    oldUri: LanguageUri,
    newUri: LanguageUri,
    options: Schema.optionalKey(
      Schema.Struct({
        overwrite: Schema.optionalKey(Schema.Boolean),
        ignoreIfExists: Schema.optionalKey(Schema.Boolean),
      })
    ),
    annotationId: Schema.optionalKey(LanguageKey),
  }),
  Schema.Struct({
    kind: Schema.Literal("delete"),
    uri: LanguageUri,
    options: Schema.optionalKey(
      Schema.Struct({
        recursive: Schema.optionalKey(Schema.Boolean),
        ignoreIfNotExists: Schema.optionalKey(Schema.Boolean),
      })
    ),
    annotationId: Schema.optionalKey(LanguageKey),
  }),
]);

export const LanguageDocumentChange = Schema.Union([
  LanguageTextDocumentEdit,
  LanguageResourceOperation,
]);

/** Preserve both LSP forms and ordered documentChanges; consumers must reject ambiguous duplicates. */

export const LanguageWorkspaceEdit = Schema.Struct({
  changes: Schema.optionalKey(
    Schema.Record(
      LanguageUri,
      Schema.Array(LanguageTextEdit).check(Schema.isMaxLength(4096))
    ).check(Schema.isMaxProperties(1024))
  ),
  documentChanges: Schema.optionalKey(
    Schema.Array(LanguageDocumentChange).check(Schema.isMaxLength(1024))
  ),
  changeAnnotations: Schema.optionalKey(
    Schema.Record(
      LanguageKey,
      Schema.Struct({
        label: LanguageText,
        needsConfirmation: Schema.optionalKey(Schema.Boolean),
        description: Schema.optionalKey(LanguageText),
      })
    ).check(Schema.isMaxProperties(1024))
  ),
});

export type LanguageWorkspaceEdit = typeof LanguageWorkspaceEdit.Type;

/** Closed-file snapshots and dirty-buffer revisions are acceptance inputs, not automatic disk writes. */

export const LanguageEditSnapshot = Schema.Struct({
  uri: LanguageUri,
  canonicalPath: LanguagePath,
  diskVersion: Schema.NullOr(LanguageDiskVersion),
  diskText: Schema.NullOr(LanguageDocumentText),
  buffer: Schema.NullOr(
    Schema.Struct({
      version: LanguageCounter,
      text: LanguageDocumentText,
      draftRevision: LanguageCounter,
    })
  ),
});

export const LanguageEditProposal = Schema.Struct({
  proposalId: LanguageKey,
  fence: LanguageRequestFence,
  origin: Schema.Literals(["code-action", "rename", "server-apply-edit"]),
  label: LanguageText,
  edit: LanguageWorkspaceEdit,
  snapshots: Schema.Array(LanguageEditSnapshot).check(Schema.isMaxLength(1024)),
  expiresAt: LanguageDeadline,
});

export type LanguageEditProposal = typeof LanguageEditProposal.Type;

export const LanguageEditAcceptance = Schema.Struct({
  proposalId: LanguageKey,
  operationId: LanguageKey,
  fence: LanguageRequestFence,
  snapshots: Schema.Array(LanguageEditSnapshot).check(Schema.isMaxLength(1024)),
  decision: Schema.Literals(["accept", "reject"]),
});

export const LanguageOperationStep = Schema.Struct({
  index: LanguageCounter,
  operation: LanguageResourceOperation,
  state: Schema.Literals(["prepared", "applied", "failed", "restored", "conflict", "not-applied"]),
  before: Schema.Array(
    Schema.Struct({ path: LanguagePath, version: Schema.NullOr(LanguageDiskVersion) })
  ).check(Schema.isMaxLength(2)),
  owned: Schema.Array(
    Schema.Struct({ path: LanguagePath, version: Schema.NullOr(LanguageDiskVersion) })
  ).check(Schema.isMaxLength(2)),
  message: LanguageText,
});
/** Unknown/partial results require status/recovery by operationId, never blind replay. */

export const LanguageOperationOutcome = Schema.Struct({
  operationId: LanguageKey,
  proposalId: LanguageKey,
  owner: Schema.Struct({ hostId: HostId, clientId: LanguageKey, checkout: LanguageCheckout }),
  state: Schema.Literals([
    "prepared",
    "applying",
    "applied",
    "rejected",
    "failed",
    "partial",
    "recovering",
    "restored",
    "recovery-required",
  ]),
  draftsDurable: Schema.Boolean,
  receiptDurable: Schema.Boolean,
  receiptRevision: LanguageCounter,
  draftGroupId: Schema.NullOr(LanguageKey),
  steps: Schema.Array(LanguageOperationStep).check(Schema.isMaxLength(1024)),
  failedChange: Schema.NullOr(LanguageCounter),
  message: LanguageText,
}).check(
  Schema.makeFilter(
    (value) => value.state !== "applied" || (value.draftsDurable && value.receiptDurable)
  )
);

export type LanguageOperationOutcome = typeof LanguageOperationOutcome.Type;

export const LanguageApplyEditResponse = Schema.Struct({
  applied: Schema.Boolean,
  failureReason: Schema.optionalKey(LanguageText),
  failedChange: Schema.optionalKey(LanguageCounter),
});

export const LanguageSaveReason = Schema.Literals([
  "manual",
  "autosave",
  "save-all",
  "vim",
  "close",
  "quit",
]);

export const LanguageFormatPreflight = Schema.Struct({
  requestId: LanguageKey,
  fence: LanguageRequestFence,
  document: LanguageDocumentFence,
  snapshot: LanguageDocumentText,
  expectedDiskVersion: LanguageDiskVersion,
  formatter: LanguageFormatterSelection,
  options: LanguageJsonObject,
  reason: LanguageSaveReason,
  deadline: LanguageDeadline,
}).check(
  Schema.makeFilter((value) =>
    value.fence.documents.some(
      (document) =>
        document.uri === value.document.uri && document.version === value.document.version
    )
  )
);

export type LanguageFormatPreflight = typeof LanguageFormatPreflight.Type;

export const LanguageFormatOutcome = Schema.TaggedUnion({
  Formatted: {
    requestId: LanguageKey,
    fence: LanguageRequestFence,
    document: LanguageDocumentFence,
    edits: Schema.Array(LanguageTextEdit).check(Schema.isMaxLength(4096)),
  },
  Skipped: { requestId: LanguageKey, reason: Schema.Literals(["disabled", "no-formatter"]) },
  Failed: {
    requestId: LanguageKey,
    reason: Schema.Literals(["unavailable", "timeout", "cancelled", "stale", "formatter-failed"]),
    message: LanguageText,
  },
});

export type LanguageFormatOutcome = typeof LanguageFormatOutcome.Type;

/** Format failure still saves current text; disk success/failure is a separate coordinator result. */

export const LanguageSaveOutcome = Schema.TaggedUnion({
  Saved: {
    uri: LanguageUri,
    version: LanguageCounter,
    diskVersion: LanguageDiskVersion,
    formatting: LanguageFormatOutcome,
  },
  Failed: {
    uri: LanguageUri,
    reason: Schema.Literals(["disk-conflict", "disk-failed", "buffer-changed"]),
    message: LanguageText,
    formatting: LanguageFormatOutcome,
  },
});

export type LanguageSaveOutcome = typeof LanguageSaveOutcome.Type;
