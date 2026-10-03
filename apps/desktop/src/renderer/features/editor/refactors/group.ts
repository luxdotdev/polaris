import {
  LanguageTreeEditProposal,
  LanguageTreeDraftReceipt,
  LanguageTreeOperationOutcome,
  LanguageEditSnapshot,
  LanguageCounter,
  LanguagePath,
  LanguageKey,
  LanguageFingerprint,
  LanguagePositionEncoding,
} from "@polaris/protocol";
import { Schema } from "effect";

export const DraftDocument = Schema.Struct({
  ...LanguageEditSnapshot.fields,
  sourcePath: Schema.NullOr(LanguagePath),
  draftRevision: LanguageCounter,
  version: LanguageCounter,
  text: Schema.String,
  dirty: Schema.Boolean,
});

export type DraftDocument = typeof DraftDocument.Type;

export const DraftGroup = Schema.Struct({
  format: Schema.Literal(2),
  positionEncoding: Schema.optionalKey(LanguagePositionEncoding),
  id: LanguageKey,
  operationId: LanguageKey,
  hostKey: Schema.String,
  revision: LanguageCounter,
  updatedAt: Schema.Number,
  fingerprint: LanguageFingerprint,
  proposal: LanguageTreeEditProposal,
  originals: Schema.Array(DraftDocument),
  documents: Schema.Array(DraftDocument),
  touched: Schema.Array(LanguagePath),
  state: Schema.Literals(["prepared", "unknown", "applied", "partial", "restored", "conflict"]),
  outcome: Schema.NullOr(LanguageTreeOperationOutcome),
  message: Schema.String,
});

export type DraftGroup = typeof DraftGroup.Type;

/** The transaction commits the whole group and all draft projections together, with revision CAS. */
export interface GroupStore {
  readonly get: (id: string) => Promise<DraftGroup | null>;
  readonly list: () => Promise<readonly DraftGroup[]>;
  readonly commit: (group: DraftGroup, expectedRevision: number | null) => Promise<void>;
}

export const MAX_GROUP_BYTES = 32 * 1024 * 1024;

export const decodeGroup = (value: string): DraftGroup => {
  if (new TextEncoder().encode(value).byteLength > MAX_GROUP_BYTES)
    throw new Error("Refactor drafts exceed the local storage limit.");

  return Schema.decodeUnknownSync(Schema.fromJsonString(DraftGroup))(value);
};

export const encodeGroup = (group: DraftGroup): string => {
  const encoded = JSON.stringify(Schema.decodeUnknownSync(DraftGroup)(group));
  decodeGroup(encoded);

  return encoded;
};

export const previewFingerprint = async (proposal: LanguageTreeEditProposal): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(proposal));
  const hash = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const draftReceipt = (group: DraftGroup): LanguageTreeDraftReceipt =>
  Schema.decodeUnknownSync(LanguageTreeDraftReceipt)({
    format: 2,
    durable: true,
    groupId: group.id,
    previewFingerprint: group.fingerprint,
    resourceSnapshots: group.proposal.resourceSnapshots,
    descendants: group.originals
      .filter((doc) => doc.dirty)
      .map((doc) => ({
        canonicalPath: doc.canonicalPath,
        version: doc.version,
        draftRevision: doc.draftRevision,
      })),
  });
