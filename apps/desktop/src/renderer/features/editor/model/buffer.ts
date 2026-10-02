/**
 * One open file's agreement with the disk (spec §3): what the buffer was
 * loaded from, whether it has unsaved edits, a save in flight, and a
 * conflict when the file moved on under unsaved edits. Pure: the session
 * (`buffers/session.ts`) applies the effects to the editor.
 */

/** A file's version on its Host: a save is rejected unless the disk still matches it. */
export interface FileVersion {
  readonly mtimeMs: number;
  readonly size: number;
  /** The content hash (`files.readVersioned`), or one made here for an older Daemon. */
  readonly hash: string;
}

/** The content decides: a touch that keeps the bytes is the same version. */
export const sameVersion = (a: FileVersion, b: FileVersion) =>
  a.size === b.size && a.hash === b.hash;

export interface DiskText {
  readonly text: string;
  readonly version: FileVersion;
}

export interface Conflict {
  readonly theirs: DiskText;
  /** Who changed it ("Claude Code"), when an agent session is known to be editing it. */
  readonly by: string | null;
}

export interface BufferModel {
  /** The disk text this buffer last agreed with. */
  readonly base: string;
  /** Null for a file that isn't on disk yet. */
  readonly version: FileVersion | null;
  readonly dirty: boolean;
  /** The text being written, while a save is in flight. */
  readonly saving: string | null;
  readonly conflict: Conflict | null;
  /** Why the last save failed, until the next one. */
  readonly error: string | null;
}

export type BufferEvent =
  /** The doc changed; `dirty` is whether it now differs from `base`. */
  | { readonly kind: "edited"; readonly dirty: boolean }
  /** The disk changed; `doc` is the buffer's current text. */
  | {
      readonly kind: "disk";
      readonly disk: DiskText;
      readonly doc: string;
      readonly by: string | null;
    }
  | { readonly kind: "save-started"; readonly text: string }
  /** Written; `doc` is the buffer's text now (typing may have continued). */
  | { readonly kind: "saved"; readonly version: FileVersion; readonly doc: string }
  | { readonly kind: "save-rejected"; readonly current: DiskText; readonly by: string | null }
  | { readonly kind: "save-failed"; readonly message: string }
  | { readonly kind: "keep-mine" }
  | { readonly kind: "take-theirs" };

/** What the editor must do after a transition: replace its text with the disk's, in place. */
export type BufferEffect = { readonly kind: "reload"; readonly text: string } | null;

export interface Transition {
  readonly model: BufferModel;
  readonly effect: BufferEffect;
}

export const loaded = (disk: DiskText): BufferModel => ({
  base: disk.text,
  version: disk.version,
  dirty: false,
  saving: null,
  conflict: null,
  error: null,
});

/** A restored draft: the disk text it was edited from, and the edits on top. */
export const restored = (disk: DiskText, draftDirty: boolean): BufferModel => ({
  ...loaded(disk),
  dirty: draftDirty,
});

const stay = (model: BufferModel): Transition => ({ model, effect: null });

const onDisk = (
  model: BufferModel,
  { disk, doc, by }: { disk: DiskText; doc: string; by: string | null }
): Transition => {
  if (model.version !== null && sameVersion(model.version, disk.version)) return stay(model);

  // Our own save, or a write that left the same text: nothing to show.
  if (disk.text === model.base || disk.text === doc || disk.text === model.saving) {
    return stay({ ...model, base: disk.text, version: disk.version, dirty: disk.text !== doc });
  }

  if (!model.dirty && model.saving === null) {
    return {
      model: { ...model, base: disk.text, version: disk.version, conflict: null },
      effect: { kind: "reload", text: disk.text },
    };
  }

  return stay({ ...model, conflict: { theirs: disk, by } });
};

const onConflictChoice = (model: BufferModel, keep: boolean): Transition => {
  const conflict = model.conflict;

  if (conflict === null) return stay(model);
  const { text, version } = conflict.theirs;

  // Keep mine: the next save overwrites theirs on purpose, so it is made against their version.
  if (keep) return stay({ ...model, base: text, version, dirty: true, conflict: null });

  return {
    model: { ...model, base: text, version, dirty: false, conflict: null, error: null },
    effect: { kind: "reload", text },
  };
};

export const step = (model: BufferModel, event: BufferEvent): Transition => {
  switch (event.kind) {
    case "edited":
      return stay(event.dirty === model.dirty ? model : { ...model, dirty: event.dirty });
    case "disk":
      return onDisk(model, event);
    case "save-started":
      return stay({ ...model, saving: event.text, error: null });
    case "saved": {
      const base = model.saving ?? model.base;

      return stay({
        ...model,
        base,
        version: event.version,
        saving: null,
        dirty: event.doc !== base,
      });
    }

    case "save-rejected":
      return stay({ ...model, saving: null, conflict: { theirs: event.current, by: event.by } });
    case "save-failed":
      return stay({ ...model, saving: null, error: event.message });
    case "keep-mine":
      return onConflictChoice(model, true);
    case "take-theirs":
      return onConflictChoice(model, false);
  }
};

/** A save may go out: something to save, nothing in flight, no conflict to settle first. */
export const canSave = (model: BufferModel) =>
  model.dirty && model.saving === null && model.conflict === null;
