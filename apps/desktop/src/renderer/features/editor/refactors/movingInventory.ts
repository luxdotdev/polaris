import type { DraftStore } from "../model/draftStore.ts";
import type { KeyValue } from "../model/drafts.ts";
import type { EditorFiles } from "../files/port.ts";
import type { DraftDocument, DraftGroup, GroupStore } from "./group.ts";
import { collectInventory } from "./inventory.ts";
import { equal } from "./equality.ts";

const draftOwnership = (documents: readonly DraftDocument[]) =>
  documents.map((doc) => ({
    uri: doc.uri,
    canonicalPath: doc.canonicalPath,
    sourcePath: doc.sourcePath,
    text: doc.text,
    version: doc.version,
    draftRevision: doc.draftRevision,
    dirty: doc.dirty,
  }));

/** Read actual Client buffers/drafts; pinned disk metadata is excluded from this ownership comparison. */
export const checkMovingDraftOwnership = async (
  group: DraftGroup,
  opened: readonly DraftDocument[],
  kv: KeyValue | null,
  drafts: DraftStore,
  groups: GroupStore
): Promise<void> => {
  const diskMetadata: EditorFiles = {
    read: ({ path }) => {
      const original = group.originals.find((doc) => doc.canonicalPath === path);

      if (original === undefined)
        throw new Error("A new affected draft appeared during file operations.");

      return Promise.resolve(
        original.diskVersion === null || original.diskText === null
          ? { kind: "missing" }
          : { kind: "text", text: original.diskText, version: original.diskVersion }
      );
    },
    write: () => Promise.reject(new Error("Receipt verification cannot save files.")),
    watch: () => () => {},
  };

  const current = await collectInventory(
    group.proposal,
    group.hostKey,
    opened,
    kv,
    drafts,
    diskMetadata,
    groups
  );

  if (!equal(draftOwnership(current), draftOwnership(group.originals)))
    throw new Error("Client draft text or revisions changed during file operations.");
};
