/** Puts the language commands in the Command Palette through the registry's `contribute`. */
import { useEffect } from "react";
import type { ContributedCommand } from "../../../routes/commands.ts";
import { useCommands } from "../../../shell/hooks.ts";
import { bindVimCommands } from "../cm/vim.ts";
import { fileKey } from "../model/drafts.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { getActiveEditor } from "../runtime/hooks.ts";
import { LANGUAGE_NAVIGATION, type NavigationAction, shortcutOf } from "./commands.ts";
import { editorPlaces } from "./places.ts";
import { runNavigation } from "./run.ts";

const activeKey = () => {
  const active = getActiveEditor();

  return active === null ? null : fileKey(active.hostKey, active.path);
};

/** Back and Forward run only with somewhere to go, so ⌃o/⌃i fall back to vim's own jumps. */
const canRun = (action: NavigationAction) => {
  if (action === "back") return editorPlaces.canGoBack();

  if (action === "forward") return editorPlaces.canGoForward();

  return true;
};

export const navigationContributions = (): readonly ContributedCommand[] =>
  LANGUAGE_NAVIGATION.map((command) => ({
    id: command.id,
    title: command.title,
    palette: {
      group: "file",
      detail: shortcutOf(command),
      keywords: ["language", command.action],
      followUp: command.followUp === true,
    },
    when: { all: command.anyFile === true ? ["editor.file"] : ["editor.file", "language.server"] },
    handler: {
      enabled: () => activeKey() !== null && canRun(command.action),
      run: () => {
        const key = activeKey();

        if (key !== null) runNavigation(key, command.action, editorLanguageQueries);
      },
    },
  }));

export const useLanguageNavigationCommands = () => {
  const registry = useCommands();

  useEffect(() => {
    const removeCommands = registry.contribute(navigationContributions());
    const unbindVim = bindVimCommands(registry.runAny);

    return () => {
      removeCommands();
      unbindVim();
    };
  }, [registry]);
};
