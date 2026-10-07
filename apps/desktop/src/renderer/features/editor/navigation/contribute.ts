/**
 * Puts the language commands in the Command Palette through the registry's `contribute`
 * (slice 4a). Until that registry is merged here, the commands still run from their keys.
 */
import { useEffect } from "react";
import { useCommands } from "../../../shell/hooks.ts";
import { fileKey } from "../model/drafts.ts";
import { editorLanguageQueries } from "../runtime/app.ts";
import { getActiveEditor } from "../runtime/hooks.ts";
import { LANGUAGE_NAVIGATION } from "./commands.ts";
import { runNavigation } from "./run.ts";

/** The palette's contributed-command shape (`routes/commands.ts` on slice 4a). */
export interface NavigationContribution {
  readonly id: string;
  readonly title: string;
  readonly palette: {
    readonly group: "file";
    readonly detail: string;
    readonly keywords: readonly string[];
    readonly followUp: boolean;
  };
  readonly when: { readonly all: readonly ("editor.file" | "language.server")[] };
  readonly handler: { readonly run: () => void; readonly enabled: () => boolean };
}

interface Contributor {
  readonly register: unknown;
  readonly contribute?: (commands: readonly NavigationContribution[]) => () => void;
}

const activeKey = () => {
  const active = getActiveEditor();

  return active === null ? null : fileKey(active.hostKey, active.path);
};

export const navigationContributions = (): readonly NavigationContribution[] =>
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
  const registry: Contributor = useCommands();

  useEffect(() => registry.contribute?.(navigationContributions()), [registry]);
};
