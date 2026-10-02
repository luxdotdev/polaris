/** The shared "open in editor" action for components (`routes/editor.ts`). */
import { PixelFailedIcon, showToast } from "@polaris/ui";
import { createElement, useCallback } from "react";
import { type EditorLocation, openInEditor } from "../../routes/editor.ts";
import { useConnection, useNavigation } from "../../shell/hooks.ts";

export type OpenInEditor = (location: EditorLocation) => boolean;

/** Opens a file in Edit; a file outside every Workspace on its Host says so in a toast. */
export const useOpenInEditor = (): OpenInEditor => {
  const { store } = useConnection();
  const navigation = useNavigation();

  return useCallback(
    (location) => {
      const app = store.getState();
      const selection = navigation.current();

      const opened = openInEditor(
        { app, actions: navigation.actions, selected: selection },
        location
      );

      if (!opened) {
        const host = app.hosts.find((h) => h.key === location.hostKey)?.label ?? "this host";

        showToast({
          source: "starlight",
          icon: createElement(PixelFailedIcon, { size: 16 }),
          title: `Not in a workspace on ${host}`,
          message: "Add its folder as a workspace (⌘O) to edit it.",
        });
      }

      return opened;
    },
    [store, navigation]
  );
};
