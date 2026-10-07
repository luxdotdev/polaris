/**
 * Settings → Editor (DESIGN.md, Settings: Editor · languages): the page body
 * and a way for the Editor to open it.
 */
import { useCallback } from "react";
import { useShellActions } from "../../../shell/hooks.ts";

export { EditorSettings, type EditorSettingsProps } from "./EditorSettings.tsx";

/** Opens Settings → Editor, where the Languages list lives. */
export const useOpenEditorSettings = (): (() => void) => {
  const { openSettings } = useShellActions();

  return useCallback(() => openSettings("editor"), [openSettings]);
};
