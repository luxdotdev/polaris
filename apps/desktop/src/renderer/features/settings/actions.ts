/** Settings' commands (`shared/keymap.ts`): "Settings…" (⌘,) and one per section, for the K menu. */
import type { CommandHandlers } from "../../routes/commands.ts";
import type { ShellActions } from "../../routes/navigation.ts";

export const settingsCommands = (shell: ShellActions): CommandHandlers => ({
  "settings.open": { run: () => shell.openSettings() },
  "settings.appearance": { run: () => shell.openSettings("appearance") },
  "settings.sessions": { run: () => shell.openSettings("sessions") },
  "settings.harnesses": { run: () => shell.openSettings("harnesses") },
  "settings.usage": { run: () => shell.openSettings("usage") },
  "settings.hosts": { run: () => shell.openSettings("hosts") },
});
