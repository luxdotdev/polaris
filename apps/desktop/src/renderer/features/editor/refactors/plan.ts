import type {
  LanguagePositionEncoding,
  LanguageTreeEditProposal,
  LanguageTreeOperationOutcome,
} from "@polaris/protocol";
import { equal } from "./equality.ts";
import { ProjectionBuilder } from "./projection.ts";
import type { DraftDocument } from "./group.ts";

export const fileUri = (path: string): string =>
  new URL("file://" + encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F")).href;

export const within = (root: string, path: string) => path === root || path.startsWith(root + "/");

export const filePath = (uri: string, root: string): string => {
  const url = new URL(uri);

  if (url.protocol !== "file:" || url.host !== "" || url.search || url.hash || /%2f|%5c/i.test(uri))
    throw new Error("Refactor requires a local canonical file URI on its Host.");
  const path = decodeURIComponent(url.pathname);

  if (
    !within(root, path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error("Refactor path leaves the checkout.");

  return path;
};

export const affected = (proposal: LanguageTreeEditProposal, path: string) =>
  proposal.snapshots.some((snapshot) => snapshot.canonicalPath === path) ||
  proposal.resourceSnapshots.some((snapshot) => within(snapshot.canonicalPath, path));

export const validateInventory = (
  proposal: LanguageTreeEditProposal,
  originals: readonly DraftDocument[]
) => {
  const root = proposal.fence.context.checkout.path.replace(/\/$/, "");
  const names = new Map<string, string>();

  for (const snapshot of [...proposal.snapshots, ...proposal.resourceSnapshots]) {
    if (filePath(snapshot.uri, root) !== snapshot.canonicalPath)
      throw new Error("Canonical snapshot differs from its URI.");
    const prior = names.get(snapshot.canonicalPath);

    if (prior !== undefined && prior !== snapshot.uri) throw new Error("Aliased refactor paths.");
    names.set(snapshot.canonicalPath, snapshot.uri);
  }

  if (new Set(originals.map((doc) => doc.canonicalPath)).size !== originals.length)
    throw new Error("Duplicate draft inventory.");

  for (const doc of originals) {
    validateDocument(doc);

    if (!affected(proposal, doc.canonicalPath) || filePath(doc.uri, root) !== doc.canonicalPath)
      throw new Error("Draft inventory leaves the accepted preview.");
  }

  for (const snapshot of proposal.snapshots) {
    const doc = originals.find((item) => item.canonicalPath === snapshot.canonicalPath);

    if (
      !doc ||
      !equal(doc.buffer, snapshot.buffer) ||
      (snapshot.buffer !== null && doc.text !== snapshot.buffer.text) ||
      !equal(doc.diskVersion, snapshot.diskVersion) ||
      doc.diskText !== snapshot.diskText
    )
      throw new Error("Text snapshot changed before preview.");
  }
};

const validateDocument = (doc: DraftDocument) => {
  if (
    doc.buffer !== null &&
    (doc.buffer.text !== doc.text ||
      doc.buffer.version !== doc.version ||
      doc.buffer.draftRevision !== doc.draftRevision)
  )
    throw new Error("Current draft text/revision differs from its document acknowledgment.");
};

export interface Projection {
  readonly documents: readonly DraftDocument[];
  readonly touched: readonly string[];
}

/** Replay the ordered preview, or only steps whose durable receipt confirms complete application. */
export const project = (
  proposal: LanguageTreeEditProposal,
  originals: readonly DraftDocument[],
  encoding: typeof LanguagePositionEncoding.Type,
  outcome: LanguageTreeOperationOutcome | null = null
): Projection => {
  if (
    proposal.edit.changes &&
    proposal.edit.documentChanges?.some((change) => "textDocument" in change)
  )
    throw new Error("Ambiguous workspace edit forms.");
  const builder = new ProjectionBuilder(proposal, originals, encoding);

  for (const [uri, edits] of Object.entries(proposal.edit.changes ?? {}))
    builder.text(uri, edits, null);

  for (const [index, change] of (proposal.edit.documentChanges ?? []).entries()) {
    if ("textDocument" in change) {
      builder.text(change.textDocument.uri, change.edits, change.textDocument.version);
      continue;
    }

    if (outcome !== null && outcome.steps.find((step) => step.index === index)?.state !== "applied")
      break;
    builder.resource(change);
  }

  return builder.result();
};
