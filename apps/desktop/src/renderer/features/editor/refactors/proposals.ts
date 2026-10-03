import { LanguageEditProposal, LanguageTreeEditProposal } from "@polaris/protocol";
import { Schema } from "effect";

/** Text-only legacy proposals retain their full decoded fence/snapshots; trees never cross this decoder. */
export const promoteTextProposal = (input: LanguageEditProposal): LanguageTreeEditProposal => {
  const object = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(input);

  if ("format" in object || "resourceSnapshots" in object)
    throw new Error("Versioned resource proposals require the dedicated tree decoder.");
  const proposal = Schema.decodeUnknownSync(LanguageEditProposal)(object);

  if (proposal.edit.documentChanges?.some((change) => "kind" in change))
    throw new Error("Resource operations require complete format-2 tree snapshots.");

  return Schema.decodeUnknownSync(LanguageTreeEditProposal)({
    ...proposal,
    format: 2,
    resourceSnapshots: [],
  });
};
