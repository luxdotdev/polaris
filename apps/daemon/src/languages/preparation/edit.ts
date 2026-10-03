import type { HostDelivery } from "./contracts.ts";
import { preparationLimits } from "./contracts.ts";
import { positionOffset } from "../runtime/documents.ts";
import type { LanguageTextEdit, LanguageTextDocumentEdit } from "@polaris/protocol";

/** Operation arrays retain their exact provider order; only initial snapshot paths are deduplicated. */
export const editPaths = (delivery: HostDelivery) => {
  const text = new Map<string, readonly (typeof LanguageTextEdit.Type)[]>();
  const resources = new Set<string>();
  const { edit } = delivery;

  if (edit.changes && edit.documentChanges?.some((change) => "textDocument" in change))
    throw new Error("Ambiguous workspace edit forms.");

  for (const [uri, edits] of Object.entries(edit.changes ?? {})) text.set(uri, edits);

  for (const change of edit.documentChanges ?? []) {
    if ("textDocument" in change) {
      checkVersion(delivery, change);

      if (text.has(change.textDocument.uri))
        throw new Error("Repeated text document edit is unsupported.");
      text.set(change.textDocument.uri, change.edits);
    } else if (change.kind === "rename") {
      resources.add(change.oldUri);
      resources.add(change.newUri);
    } else resources.add(change.uri);
  }

  if (text.size + resources.size === 0 || text.size + resources.size > preparationLimits.paths)
    throw new Error("Proposal path budget exceeded or edit is empty.");

  return { text, resources };
};

export const checkRanges = (
  text: string,
  edits: readonly (typeof LanguageTextEdit.Type)[],
  encoding: HostDelivery["encoding"]
) => {
  const ranges = edits
    .map((edit) => ({
      from: positionOffset(text, edit.range.start, encoding),
      to: positionOffset(text, edit.range.end, encoding),
    }))
    .sort((a, b) => a.from - b.from || a.to - b.to);

  let end = -1;
  let start = -1;

  for (const range of ranges) {
    if (range.to < range.from || range.from < end || range.from === start)
      throw new Error("Text edit ranges overlap or are reversed.");
    start = range.from;
    end = range.to;
  }
};

const checkVersion = (delivery: HostDelivery, change: typeof LanguageTextDocumentEdit.Type) => {
  const version = change.textDocument.version;

  if (
    version !== null &&
    !delivery.fence.documents.some(
      (doc) => doc.uri === change.textDocument.uri && doc.version === version
    )
  )
    throw new Error("Versioned text edit lacks its captured Host document fence.");
};
