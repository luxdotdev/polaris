/**
 * One ⌘Z undoes an accepted multi-file rename everywhere (DESIGN.md, Editor: Language
 * refactors): pressed in any file it touched, while that file still reads as the rename left it.
 */
import { Prec } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { refactorRegistry, type RefactorController } from "./controller.ts";

/** The controller whose applied multi-file change still owns this file's text, if any. */
export const undoOwner = (
  controllers: Iterable<RefactorController>,
  hostKey: string,
  path: string,
  text: string
): RefactorController | null => {
  for (const controller of controllers) {
    const { group, busy } = controller.state.getState();

    if (
      controller.hostKey === hostKey &&
      !busy &&
      group !== null &&
      group.state === "applied" &&
      group.touched.length > 1 &&
      group.touched.includes(path) &&
      group.documents.find((doc) => doc.canonicalPath === path)?.text === text
    )
      return controller;
  }

  return null;
};

export const refactorUndoKeys = (file: { readonly hostKey: string; readonly path: string }) =>
  Prec.highest(
    keymap.of([
      {
        key: "Mod-z",
        run: (view) => {
          const owner = undoOwner(
            refactorRegistry.getState().controllers.values(),
            file.hostKey,
            file.path,
            view.state.sliceDoc()
          );

          if (owner === null) return false;
          void owner.recover("undo");

          return true;
        },
      },
    ])
  );
