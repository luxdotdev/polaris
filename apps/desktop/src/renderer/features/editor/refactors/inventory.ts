import type { LanguageTreeEditProposal } from "@polaris/protocol";
import { listDrafts, type KeyValue } from "../model/drafts.ts";
import type { DraftStore } from "../model/draftStore.ts";
import type { EditorFiles } from "../files/port.ts";
import { projectedDraft } from "./drafts.ts";
import type { DraftDocument, GroupStore } from "./group.ts";
import { equal } from "./equality.ts";
import { affected, fileUri } from "./plan.ts";

/** Enumerate unopened legacy/spilled drafts too; read failure cannot mean an empty inventory. */
export const collectInventory = async (
  proposal: LanguageTreeEditProposal,
  hostKey: string,
  opened: readonly DraftDocument[],
  kv: KeyValue | null,
  drafts: DraftStore,
  files: EditorFiles,
  groups?: GroupStore
): Promise<readonly DraftDocument[]> => {
  const documents = new Map<string, DraftDocument>();

  for (const doc of opened)
    if (affected(proposal, doc.canonicalPath)) documents.set(doc.canonicalPath, doc);

  if (groups !== undefined)
    await groupedInventory(groups, proposal, hostKey, documents, drafts, files);
  const paths = inventoryPaths(proposal, hostKey, kv);

  for (const path of paths) {
    if (documents.has(path)) continue;
    const doc = await readInventoryDocument(proposal, hostKey, path, drafts, files, groups);

    if (doc !== null) documents.set(path, doc);
  }

  return [...documents.values()].sort((a, b) =>
    a.canonicalPath < b.canonicalPath ? -1 : Number(a.canonicalPath > b.canonicalPath)
  );
};

const inventoryPaths = (
  proposal: LanguageTreeEditProposal,
  hostKey: string,
  kv: KeyValue | null
) => {
  const paths = new Set(proposal.snapshots.map((snapshot) => snapshot.canonicalPath));

  for (const draft of kv === null ? [] : listDrafts(kv)) {
    if (draft.hostKey === hostKey && affected(proposal, draft.path)) paths.add(draft.path);
  }

  return paths;
};

const groupedInventory = async (
  groups: GroupStore,
  proposal: LanguageTreeEditProposal,
  hostKey: string,
  documents: Map<string, DraftDocument>,
  drafts: DraftStore,
  files: EditorFiles
) => {
  const all = (await groups.list()).filter(
    (group) => group.hostKey === hostKey && group.state !== "prepared" && group.state !== "unknown"
  );

  all.sort((a, b) => b.updatedAt - a.updatedAt);
  const covered = new Set<string>();

  for (const group of all) {
    for (const path of group.touched) {
      if (covered.has(path) || !affected(proposal, path)) continue;
      covered.add(path);
      const doc = group.documents.find((item) => item.canonicalPath === path);

      if (!doc?.dirty || documents.has(path)) continue;

      const current = await currentGroupedDocument(
        groups,
        proposal,
        hostKey,
        doc,
        group.updatedAt,
        drafts,
        files
      );

      if (current !== null) documents.set(path, current);
    }
  }
};

const currentGroupedDocument = async (
  groups: GroupStore,
  proposal: LanguageTreeEditProposal,
  hostKey: string,
  doc: DraftDocument,
  updatedAt: number,
  drafts: DraftStore,
  files: EditorFiles
) => {
  const legacy = await drafts.read(hostKey, doc.canonicalPath);

  if (legacy === null && drafts.has(hostKey, doc.canonicalPath))
    throw new Error("An affected draft could not be read.");

  if (legacy !== null && legacy.savedAt === updatedAt)
    throw new Error("Ambiguous closed draft revision requires a new inventory.");

  if (legacy !== null && legacy.savedAt > updatedAt)
    return readInventoryDocument(proposal, hostKey, doc.canonicalPath, drafts, files, groups);

  const disk = await files.read({
    hostKey,
    path: doc.canonicalPath,
    root: proposal.fence.context.checkout.path,
  });

  if (disk.kind === "binary" || !equal(legacy, await drafts.read(hostKey, doc.canonicalPath)))
    throw new Error("A grouped draft changed while reading inventory.");

  return {
    ...doc,
    sourcePath: doc.canonicalPath,
    buffer: null,
    diskVersion: disk.kind === "text" ? disk.version : null,
    diskText: disk.kind === "text" ? disk.text : null,
  };
};

const readInventoryDocument = async (
  proposal: LanguageTreeEditProposal,
  hostKey: string,
  path: string,
  drafts: DraftStore,
  files: EditorFiles,
  groups?: GroupStore
): Promise<DraftDocument | null> => {
  const legacy = await drafts.read(hostKey, path);

  const draft = groups === undefined ? legacy : await projectedDraft(groups, hostKey, path, legacy);

  if (
    legacy !== null &&
    draft === null &&
    !proposal.snapshots.some((snapshot) => snapshot.canonicalPath === path)
  )
    return null;

  if (draft === null && drafts.has(hostKey, path))
    throw new Error("An affected draft could not be read.");
  const disk = await files.read({ hostKey, path, root: proposal.fence.context.checkout.path });

  if (!equal(legacy, await drafts.read(hostKey, path)))
    throw new Error("A closed draft changed while reading inventory.");

  if (groups !== undefined && !equal(draft, await projectedDraft(groups, hostKey, path, legacy)))
    throw new Error("A grouped draft changed while reading inventory.");

  if (disk.kind === "binary") throw new Error("An affected document could not be read.");
  const version = 0;
  const draftRevision = draft?.savedAt ?? 0;
  const diskText = disk.kind === "text" ? disk.text : null;
  const text = draft?.text ?? diskText ?? "";

  return {
    uri: fileUri(path),
    canonicalPath: path,
    sourcePath: path,
    diskVersion: disk.kind === "text" ? disk.version : null,
    diskText,
    buffer: null,
    version,
    draftRevision,
    text,
    dirty: draft !== null && text !== diskText,
  };
};
