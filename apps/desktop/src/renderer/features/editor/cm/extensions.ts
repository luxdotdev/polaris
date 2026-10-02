/**
 * The seam other features plug into every editor through: which file a state
 * holds (`editorFile`), and extensions they register (the explorer's git
 * gutter, the inline chat's selection bar). A registration reaches open tabs too.
 */
import { Compartment, type Extension, Facet } from "@codemirror/state";

export interface EditorFile {
  readonly hostKey: string;
  readonly workspaceId: string;
  /** Absolute on the Host. */
  readonly path: string;
}

/** The file an editor state holds: `view.state.facet(editorFile)`. */
export const editorFile = Facet.define<EditorFile, EditorFile | null>({
  combine: (values) => values[0] ?? null,
});

export type EditorExtensionFactory = (file: EditorFile) => Extension;

const factories: Array<EditorExtensionFactory> = [];

const listeners = new Set<() => void>();

/** The compartment registered extensions live in, one per editor state. */
export const registeredCompartment = new Compartment();

export const registeredExtensions = (file: EditorFile): Extension =>
  factories.map((factory) => factory(file));

/** Adds extensions to every editor, open ones included; call the result to remove them. */
export const registerEditorExtensions = (factory: EditorExtensionFactory): (() => void) => {
  factories.push(factory);

  for (const listener of listeners) listener();

  return () => {
    const at = factories.indexOf(factory);

    if (at === -1) return;
    factories.splice(at, 1);

    for (const listener of listeners) listener();
  };
};

/** Called when the registered set changes, so open editors reconfigure. */
export const onRegistrationsChanged = (listener: () => void): (() => void) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};
