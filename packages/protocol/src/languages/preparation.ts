import { Schema } from "effect";
import { LanguageContextIdentity, LanguageCounter, LanguageUri } from "./base.ts";
import { LanguageDocumentText } from "./documents.ts";
import { LanguageEditProposal } from "./edits.ts";
import { LanguageTreeEditProposal } from "./trees.ts";

export const LanguageBufferAcknowledgment = Schema.Struct({
  uri: LanguageUri,
  version: LanguageCounter,
  text: LanguageDocumentText,
  draftRevision: LanguageCounter,
});

export type LanguageBufferAcknowledgment = typeof LanguageBufferAcknowledgment.Type;

/** Confirms the independently authenticated Host mirror tuple without echoing document text. */
export const LanguageBufferAcknowledgmentReceipt = Schema.Struct({
  context: LanguageContextIdentity,
  uri: LanguageUri,
  version: LanguageCounter,
  draftRevision: LanguageCounter,
  acceptedSequence: LanguageCounter,
});

const PreparedTextProposal = Schema.Struct({
  ...LanguageEditProposal.fields,
  format: Schema.optionalKey(Schema.Never),
  resourceSnapshots: Schema.optionalKey(Schema.Never),
}).check(
  Schema.makeFilter(
    (proposal) => !proposal.edit.documentChanges?.some((change) => "kind" in change)
  )
);

/** Tree metadata must survive decoding; versioned or resource edits never fall through to text. */
export const LanguagePreparedEditProposal = Schema.Union([
  LanguageTreeEditProposal,
  PreparedTextProposal,
]);
