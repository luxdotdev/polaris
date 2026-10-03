import { fileUri } from "../refactors/plan.ts";
import type { LanguageTreeOperationOutcome } from "@polaris/protocol";
import type { DraftDocument, DraftGroup, GroupStore } from "../refactors/group.ts";
import { readRefactorState, intervene } from "../refactors/drafts.ts";
import { ownedDocuments } from "../refactors/drafts.ts";
import { bufferOf, openBuffers, rekey, releaseBuffer, type OpenBuffer } from "./buffers.ts";
import type { DraftStore } from "../model/draftStore.ts";
import { type Draft, fileKey } from "../model/drafts.ts";
import { modelOf, patchBuffer, setBufferModel } from "./store.ts";
import { receiptVersion } from "../refactors/ownership.ts";
import { equal } from "../refactors/equality.ts";
import { renameTab } from "../model/tabs.ts";
import { editorStore } from "./store.ts";
import { normalized, reloadChanges } from "../cm/reload.ts";

/** Current runtime text/revision used by the injected refactor inventory and guarded reconciliation. */
export const refactorDocument = (buffer: OpenBuffer): DraftDocument | null => {
  const model = modelOf(buffer.key);

  if (model === null || buffer.view === null) return null;

  return {
    uri: fileUri(buffer.file.path),
    canonicalPath: buffer.file.path,
    sourcePath: buffer.file.path,
    diskVersion: model.version,
    diskText: model.base,
    buffer: {
      version: buffer.revision,
      draftRevision: buffer.revision + buffer.draftRevisionOffset,
      text: buffer.view.state.sliceDoc(),
    },
    version: buffer.revision,
    draftRevision: buffer.revision + buffer.draftRevisionOffset,
    text: buffer.view.state.sliceDoc(),
    dirty: model.dirty,
  };
};

export const openRefactorDocuments = (hostKey: string): readonly DraftDocument[] =>
  openBuffers()
    .filter((buffer) => buffer.file.hostKey === hostKey)
    .flatMap((buffer) => {
      const doc = refactorDocument(buffer);

      return doc === null ? [] : [doc];
    });

/** Never replaces a changed open view; G2 validates closed persistent drafts and disk snapshots too. */
export const checkRefactorBuffers = (group: DraftGroup, outcome?: LanguageTreeOperationOutcome) => {
  if (group.state === "conflict")
    throw new Error("Newer edits prevent coordinated refactor reconciliation.");

  const documents = ownedDocuments(group);

  for (const path of group.touched) {
    const buffer = bufferOf(fileKey(group.hostKey, path));

    if (buffer === undefined || documents.some((doc) => doc.canonicalPath === path)) continue;
    const original = group.originals.find((doc) => doc.canonicalPath === path);
    const current = refactorDocument(buffer);

    if (
      !buffer.refactor ||
      original === undefined ||
      current === null ||
      current.text !== original.text ||
      current.version !== original.version
    )
      throw new Error("A newly occupied buffer prevents refactor reconciliation.");
  }

  for (const doc of documents) {
    const buffer = bufferOf(fileKey(group.hostKey, doc.canonicalPath));

    if (buffer === undefined) continue;
    const current = refactorDocument(buffer);

    if (
      current === null ||
      current.text !== doc.text ||
      current.version !== doc.version ||
      current.draftRevision !== doc.draftRevision ||
      !equal(current.diskVersion, doc.diskVersion) ||
      !ownedConflict(buffer, outcome)
    )
      throw new Error("A newer buffer edit prevents refactor reconciliation.");
  }
};

/** Durable drafts stay in the group; applying a refactor does not start an autosave timer. */
export const publishRefactorBuffers = (group: DraftGroup, previous: DraftGroup) => {
  const before = ownedDocuments(previous);

  for (const original of before) {
    const next = group.documents.find(
      (doc) => doc.sourcePath !== null && doc.sourcePath === original.sourcePath
    );

    if (next === undefined || next.canonicalPath === original.canonicalPath) continue;
    const buffer = bufferOf(fileKey(group.hostKey, original.canonicalPath));

    if (buffer === undefined) continue;
    const collision = bufferOf(fileKey(group.hostKey, next.canonicalPath));

    if (collision !== undefined && collision !== buffer) {
      holdRefactor(collision);
      releaseBuffer(collision.key);
    }

    rekey(buffer, next.canonicalPath);
    editorStore.setState((state) => ({
      tabs: Object.fromEntries(
        Object.entries(state.tabs).map(([key, set]) => [
          key,
          key.startsWith(group.hostKey + "\u0000")
            ? renameTab(set, original.canonicalPath, next.canonicalPath)
            : set,
        ])
      ),
    }));
  }

  for (const path of group.touched) {
    const buffer = bufferOf(fileKey(group.hostKey, path));

    if (buffer?.view == null) continue;
    const doc = group.documents.find((item) => item.canonicalPath === path);
    holdRefactor(buffer);

    if (doc === undefined) {
      patchBuffer(buffer.key, { deleted: true });
      continue;
    }

    buffer.view.dispatch({
      changes: reloadChanges(
        buffer.view.state.doc.toString(),
        normalized(buffer.view.state, doc.text)
      ),
      userEvent: "reload.refactor",
    });
    buffer.revision = doc.version;
    buffer.draftRevisionOffset = doc.draftRevision - doc.version;
    setBufferModel(buffer.key, {
      base: doc.diskText ?? "",
      version: doc.diskVersion,
      dirty: doc.dirty,
      saving: null,
      conflict: null,
      error: null,
    });
    patchBuffer(buffer.key, { deleted: false });
  }
};

const ownedConflict = (buffer: OpenBuffer, outcome: LanguageTreeOperationOutcome | undefined) => {
  const model = modelOf(buffer.key);

  if (model === null || model.saving !== null) return false;

  if (model.conflict === null) return true;

  if (outcome === undefined) return false;

  const version = receiptVersion(outcome, buffer.file.path);

  return version !== null && equal(version, model.conflict.theirs.version);
};

/** Closed drafts changed in another window also lose undo ownership, including same-text revisions. */
export const checkRefactorDrafts = async (group: DraftGroup, drafts: DraftStore) => {
  for (const path of group.touched) {
    if (bufferOf(fileKey(group.hostKey, path)) !== undefined) continue;
    const draft = await drafts.read(group.hostKey, path);

    if (draft === null && drafts.has(group.hostKey, path))
      throw new Error("An affected draft is unreadable.");

    if (draft !== null && draft.savedAt >= group.updatedAt)
      throw new Error("A newer closed draft prevents refactor reconciliation.");
  }
};

const holdRefactor = (buffer: OpenBuffer) => {
  buffer.save?.invalidate();

  if (buffer.autosave !== null) clearTimeout(buffer.autosave);

  if (buffer.settle !== null) clearTimeout(buffer.settle);
  buffer.autosave = null;
  buffer.settle = null;
  buffer.refactor = true;
};

/** Reopened grouped drafts keep their persisted revisions and remain outside implicit saves. */
export const restoreRefactorDocument = (buffer: OpenBuffer, document: DraftDocument | null) => {
  if (document === null) return;
  buffer.revision = document.version;
  buffer.draftRevisionOffset = document.draftRevision - document.version;
  buffer.refactor = true;
};

export const discardRefactorBuffer = async (
  hostKey: string,
  path: string,
  current: () => boolean,
  kept: DraftStore,
  groups: GroupStore | undefined,
  keep: (buffer: OpenBuffer) => boolean
): Promise<boolean> => {
  const key = fileKey(hostKey, path);
  const original = bufferOf(key);
  const revision = original?.revision;
  const same = () => current() && bufferOf(key) === original && original?.revision === revision;
  const before = await kept.read(hostKey, path);
  const projected = await readRefactorState(groups, hostKey, path, before);

  if (!same()) return false;

  if (before === null && kept.has(hostKey, path))
    throw new Error("An affected draft is unreadable.");

  if (groups !== undefined) await intervene(groups, hostKey, path, null);
  const after = await kept.read(hostKey, path);

  if (after === null && kept.has(hostKey, path))
    throw new Error("An affected draft is unreadable.");

  if (!same() || !equal(before, after)) {
    preserveDiscardDraft(hostKey, path, after ?? projected.draft, kept, keep);

    return false;
  }

  releaseBuffer(key);
  kept.drop(hostKey, path);

  return true;
};

const preserveDiscardDraft = (
  hostKey: string,
  path: string,
  draft: Draft | null,
  drafts: DraftStore,
  keep: (buffer: OpenBuffer) => boolean
) => {
  const buffer = bufferOf(fileKey(hostKey, path));

  if (buffer?.view != null && modelOf(buffer.key)?.dirty === true) {
    buffer.refactor = false;

    if (!keep(buffer))
      throw new Error("Cannot preserve the draft after a changed discard request.");

    return;
  }

  if (draft !== null && !drafts.write(draft))
    throw new Error("Cannot preserve the draft after a changed discard request.");
};

/** Host-owned in-flight disk changes do not grant ownership of newer Client edits or saves. */
export const checkMovingRefactorBuffers = (group: DraftGroup) => {
  for (const original of group.originals) {
    const buffer = bufferOf(fileKey(group.hostKey, original.canonicalPath));

    if (buffer === undefined) continue;
    const current = refactorDocument(buffer);

    if (
      current === null ||
      modelOf(buffer.key)?.saving !== null ||
      current.text !== original.text ||
      current.version !== original.version ||
      current.draftRevision !== original.draftRevision
    )
      throw new Error("A newer Client edit or pending save prevents file operations.");
  }
};
