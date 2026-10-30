/**
 * Edit's Back and Forward: the places left by switching files or jumping (go to
 * definition), which ⌃- and ⌃⇧-, the shell's ⌘[ and ⌘] and the mouse's side buttons move through.
 */
import type { EditorFile } from "../api.ts";
import { openFile } from "../api.ts";
import { fileKey } from "../model/drafts.ts";
import { type ActiveEditor, editorStore } from "../runtime/store.ts";

export type Place = EditorFile & { readonly line: number; readonly column: number };

export const PLACES_LIMIT = 100;

const keyOf = (file: EditorFile) => fileKey(file.hostKey, file.path);

export interface PlacesInput {
  /** Where the focused editor's cursor is. */
  readonly here: () => Place | null;
  readonly open: (place: Place) => void;
}

export const createPlaces = ({ here, open }: PlacesInput) => {
  const behind: Array<Place> = [];
  const ahead: Array<Place> = [];
  /** The file Back or Forward is opening: its arrival isn't a new visit. */
  let arriving: string | null = null;

  /** Leaving `place` for somewhere new: it goes behind, and the places ahead go. */
  const leave = (place: Place) => {
    const last = behind.at(-1);

    if (last !== undefined && keyOf(last) === keyOf(place) && last.line === place.line) return;
    behind.push(place);
    ahead.length = 0;

    if (behind.length > PLACES_LIMIT) behind.shift();
  };

  /** The active file changed from `from` to `to`. */
  const switched = (from: Place | null, to: EditorFile) => {
    const travelled = arriving === keyOf(to);

    arriving = null;

    if (!travelled && from !== null) leave(from);
  };

  const step = (from: Array<Place>, to: Array<Place>) => {
    const target = from.pop();

    if (target === undefined) return;
    const current = here();

    if (current !== null) to.push(current);

    if (current === null || keyOf(current) !== keyOf(target)) arriving = keyOf(target);
    open(target);
  };

  return {
    leave,
    switched,
    back: () => step(behind, ahead),
    forward: () => step(ahead, behind),
    canGoBack: () => behind.length > 0,
    canGoForward: () => ahead.length > 0,
  };
};

const placeOf = ({ view, ...file }: ActiveEditor): Place => {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);

  return { ...file, line: line.number, column: head - line.from + 1 };
};

export const editorPlaces = createPlaces({
  here: () => {
    const active = editorStore.getState().active;

    return active === null ? null : placeOf(active);
  },
  open: openFile,
});

/** Records file switches as places; call once, when the Editor starts. */
export const trackPlaces = () => {
  let last = editorStore.getState().active;

  return editorStore.subscribe(({ active }) => {
    if (active === null || active === last) return;
    const from = last;

    last = active;

    if (from !== null && keyOf(from) === keyOf(active)) return;
    editorPlaces.switched(from === null ? null : placeOf(from), active);
  });
};
