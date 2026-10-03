/**
 * The one strip above the code that says what needs a decision (spec §3):
 * a conflict with the disk first, then a deleted file, a failed save, and a
 * Host whose Daemon can't save. Copy is sentence case and names who changed it.
 */
import type { BufferView } from "../runtime/store.ts";

export type BannerAction =
  | "compare"
  | "keep-mine"
  | "take-theirs"
  | "close"
  | "retry"
  | "update-daemon"
  | "save";

export interface Banner {
  readonly kind: "conflict" | "deleted" | "save-failed" | "read-only" | "unkept";
  readonly text: string;
  readonly actions: ReadonlyArray<{ readonly action: BannerAction; readonly label: string }>;
}

export const ACTION_LABELS: Readonly<Record<BannerAction, string>> = {
  compare: "Compare",
  "keep-mine": "Keep mine",
  "take-theirs": "Take theirs",
  close: "Close tab",
  retry: "Try again",
  "update-daemon": "Upgrade daemon",
  save: "Save",
};

const actions = (...list: ReadonlyArray<BannerAction>) =>
  list.map((action) => ({ action, label: ACTION_LABELS[action] }));

export const bannerFor = (buffer: BufferView, hostLabel: string): Banner | null => {
  const model = buffer.status.kind === "ready" ? buffer.status.model : null;

  if (model?.conflict != null) {
    const by = model.conflict.by;

    return {
      kind: "conflict",
      text: by === null ? "Changed on disk" : `Changed on disk by ${by}`,
      actions: actions("compare", "keep-mine", "take-theirs"),
    };
  }

  if (buffer.deleted) {
    return {
      kind: "deleted",
      text: "Deleted on disk. The text stays here until you close the tab.",
      actions: actions("close"),
    };
  }

  if (model?.error != null && model.error !== "") {
    return {
      kind: "save-failed",
      text: `Couldn't save. ${model.error}`,
      actions: actions("retry"),
    };
  }

  if (buffer.unkept && model?.dirty === true) {
    return {
      kind: "unkept",
      text: "This unsaved edit is too large to keep after quitting",
      actions: actions("save"),
    };
  }

  if (buffer.readOnly) {
    return {
      kind: "read-only",
      text: `The daemon on ${hostLabel} can't save files yet`,
      actions: actions("update-daemon"),
    };
  }

  return null;
};
