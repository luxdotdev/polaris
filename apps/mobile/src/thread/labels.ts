/** Names and hues the thread shows for a session: its Harness, Model and working time. */
import { harnessEntry, type HarnessKind } from "@polaris/protocol";
import { midnight } from "@polaris/ui/tokens";

/** The Harness's product name ("Claude Code"), or its kind when this build doesn't list it. */
export const harnessName = (kind: HarnessKind): string => harnessEntry(kind)?.name ?? kind;

const HUES = new Map([
  ["claude", midnight.harnessClaudeCode],
  ["codex", midnight.harnessCodex],
  ["opencode", midnight.harnessOpencode],
]);

/** A hued Harness's colour; the others read in plain text (DESIGN.md, Harness hue). */
export const harnessHue = (kind: HarnessKind): string => HUES.get(kind) ?? midnight.textDefault;

/** "1m 12s", "45s", "1h 3m": how long the Turn in flight has worked. */
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;

  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
};

/** "Claude Code · Mac Studio · polaris", leaving out what isn't known yet. */
export const subtitle = (parts: ReadonlyArray<string | null>): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" · ");
