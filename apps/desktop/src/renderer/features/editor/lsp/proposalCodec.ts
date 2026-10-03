import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { PreparedLanguageEdit } from "./preparation.ts";

/** Typed IPC results contain FileVersion domain instances; encode them before JSON-only routing. */
export const decodePreparedProposal = (input: PreparedLanguageEdit): PreparedLanguageEdit => {
  const tree = "format" in input || "resourceSnapshots" in input;

  if (!tree && input.edit.documentChanges?.some((change) => "kind" in change))
    throw new Error("Resource edits require the dedicated format2 proposal.");

  const encoded = tree
    ? Schema.encodeUnknownSync(P.LanguageTreeEditProposal)(input)
    : Schema.encodeUnknownSync(P.LanguageEditProposal)(input);

  return P.decodeLanguageResourceProposal(encoded);
};
