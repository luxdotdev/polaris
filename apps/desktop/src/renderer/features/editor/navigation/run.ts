/** Runs one language command for an open file. */
import type { LanguageQueries } from "../lsp/queries.ts";
import { viewOf } from "../runtime/buffers.ts";
import type { NavigationAction } from "./commands.ts";
import { openRename, openSymbolSearch } from "./store.ts";

/** The rename field opens on the symbol under the cursor, pre-filled with its name. */
const startRename = (key: string) => {
  const view = viewOf(key);

  if (view === null) return;
  const head = view.state.selection.main.head;
  const word = view.state.wordAt(head);
  const coords = view.coordsAtPos(word?.from ?? head);

  if (coords === null) return;
  openRename({
    key,
    initial: word === null ? "" : view.state.sliceDoc(word.from, word.to),
    left: coords.left,
    top: coords.top,
    bottom: coords.bottom,
  });
};

export const runNavigation = (
  key: string,
  action: NavigationAction,
  queries: Pick<LanguageQueries, "run" | "back"> | null
) => {
  if (action === "back") queries?.back();
  else if (action === "rename-field") startRename(key);
  else if (action === "symbol-search") openSymbolSearch(key);
  else void queries?.run(key, action);
};
