/**
 * Shell mode: a draft that starts with `!` is a shell command for the session's directory
 * (`RunShellCommand`), where the Host and Harness take one. Deleting the `!` or esc leaves it.
 */

export const SHELL_SIGIL = "!";

/** Whether the composer is in shell mode for this draft. */
export const isShellDraft = (draft: string, canRunShell: boolean): boolean =>
  canRunShell && draft.startsWith(SHELL_SIGIL);

/** The command a shell draft runs, trimmed; null when there is none yet (`!` alone). */
export const shellCommandOf = (draft: string): string | null => {
  const command = draft.slice(SHELL_SIGIL.length).trim();

  return command === "" ? null : command;
};

/** The draft with shell mode left (esc): the `!` gone, the rest kept. */
export const leaveShell = (draft: string): string =>
  draft.startsWith(SHELL_SIGIL) ? draft.slice(SHELL_SIGIL.length) : draft;

/** How a sent shell command comes back with ↑: in shell mode again. */
export const shellDraft = (command: string): string => `${SHELL_SIGIL}${command}`;
