/**
 * The CodeMirror side of the seam (`api.ts` holds the registry): which file a
 * state holds (`editorFile`), and the compartment other features' extensions
 * live in (the explorer's git gutter, the inline chat's selection bar).
 */
import { Compartment, type Extension, Facet } from "@codemirror/state";
import { type EditorFile, registeredFor } from "../api.ts";

export {
  type EditorExtensionFactory,
  type EditorFile,
  onRegistrationsChanged,
  registerEditorExtensions,
} from "../api.ts";

/** The file an editor state holds: `view.state.facet(editorFile)`. */
export const editorFile = Facet.define<EditorFile, EditorFile | null>({
  combine: (values) => values[0] ?? null,
});

/** The compartment registered extensions live in, one per editor state. */
export const registeredCompartment = new Compartment();

export const registeredExtensions = (file: EditorFile): Extension => registeredFor(file);
