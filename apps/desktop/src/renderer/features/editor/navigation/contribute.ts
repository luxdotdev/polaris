/** Puts the language commands in the Command Palette through the registry's `contribute`. */
import { useEffect } from "react";
import type { ContributedCommand } from "../../../routes/commands.ts";
import { useCommands } from "../../../shell/hooks.ts";
import { fileKey } from "../model/drafts.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { getActiveEditor } from "../runtime/hooks.ts";
import { LANGUAGE_NAVIGATION } from "./commands.ts";
import { runNavigation } from "./run.ts";

const activeKey = () => {
  const active = getActiveEditor();

  return active === null ? null : fileKey(active.hostKey, active.path);
};

export const navigationContributions = (): readonly ContributedCommand[] =>
  LANGUAGE_NAVIGATION.map((command) => ({
    id: command.id,
    title: command.title,
    palette: {
      group: "file",
      detail: command.shortcut ?? "",
      keywords: ["language", command.action],
      followUp: command.followUp === true,
    },
    when: { all: ["editor.file", "language.server"] },
    handler: {
      enabled: () => activeKey() !== null,
      run: () => {
        const key = activeKey();

        if (key !== null) runNavigation(key, command.action, editorLanguageQueries);
      },
    },
  }));

export const useLanguageNavigationCommands = () => {
  const registry = useCommands();

  useEffect(() => registry.contribute(navigationContributions()), [registry]);
};
