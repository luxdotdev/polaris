/** Where paths inside a view live: its Host and the folder they are relative to. */
import type { WorkspaceId } from "@polaris/protocol";
import { createContext, useContext } from "react";

export interface EditorPlace {
  readonly hostKey: string;
  /** A session's cwd, a Review Checkout, a Worktree; relative paths resolve against it. */
  readonly root: string | null;
  readonly workspaceId?: WorkspaceId | null;
}

export const EditorPlaceContext = createContext<EditorPlace | null>(null);

export const EditorPlaceProvider = EditorPlaceContext.Provider;

export const useEditorPlace = (): EditorPlace | null => useContext(EditorPlaceContext);
