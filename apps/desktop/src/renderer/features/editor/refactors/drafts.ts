import type { Draft } from "../model/drafts.ts";
import type { DraftDocument, DraftGroup, GroupStore } from "./group.ts";
import { expired } from "./lifetime.ts";

/** Latest transaction owns a path even when its projection removed an older legacy draft. */
export const projectedState = async (
  store: GroupStore,
  hostKey: string,
  path: string,
  legacy: Draft | null
): Promise<{ readonly draft: Draft | null; readonly document: DraftDocument | null }> => {
  const groups = (await store.list()).filter(
    (group) => group.hostKey === hostKey && group.touched.includes(path)
  );

  groups.sort((a, b) => b.updatedAt - a.updatedAt);
  const group = groups[0];

  if (
    !group ||
    group.state === "prepared" ||
    group.state === "unknown" ||
    (legacy !== null && legacy.savedAt >= group.updatedAt)
  )
    return { draft: legacy, document: null };
  const doc = group.documents.find((item) => item.canonicalPath === path);

  return {
    document: doc ?? null,
    draft: doc?.dirty
      ? { hostKey, path, text: doc.text, base: doc.diskVersion, savedAt: group.updatedAt }
      : null,
  };
};

export const projectedDraft = async (
  store: GroupStore,
  hostKey: string,
  path: string,
  legacy: Draft | null
) => (await projectedState(store, hostKey, path, legacy)).draft;

/** Ordinary edits/save/discard retire group undo ownership while retaining every original. */
export const intervene = async (
  store: GroupStore,
  hostKey: string,
  path: string,
  next: DraftDocument | null
) => {
  for (const group of await store.list()) {
    if (
      group.hostKey !== hostKey ||
      !group.touched.includes(path) ||
      group.state === "prepared" ||
      group.state === "unknown"
    )
      continue;
    const documents = group.documents.filter((doc) => doc.canonicalPath !== path);

    if (next !== null) documents.push(next);

    // A partial outcome stays unresolved; any other loses its undo and expires silently.
    const superseded: DraftGroup =
      group.state === "partial"
        ? { ...group, documents, revision: group.revision + 1, updatedAt: Date.now() }
        : {
            ...group,
            documents,
            state: "conflict",
            revision: group.revision + 1,
            updatedAt: Date.now(),
            message: "Newer edits or saves prevent coordinated undo.",
          };

    if (expired(superseded)) await store.remove(group.id, group.revision);
    else await store.commit(superseded, group.revision);
  }
};

export const ownedDocuments = (group: DraftGroup) =>
  group.state === "prepared" || group.state === "unknown" ? group.originals : group.documents;

export const readRefactorState = (
  store: GroupStore | undefined,
  hostKey: string,
  path: string,
  legacy: Draft | null
) =>
  store === undefined
    ? Promise.resolve({ draft: legacy, document: null })
    : projectedState(store, hostKey, path, legacy);
