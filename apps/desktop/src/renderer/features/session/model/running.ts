/**
 * The commands running while a Turn works, for the Working strip (DESIGN.md, Working strip):
 * the Turn's own and its Subagents' commands in flight, and the session's background
 * commands (Claude Code's background shells, Codex's commands the model moved on from).
 */
import type { BackgroundTask } from "@polaris/protocol";
import { Predicate } from "effect";
import type { LiveItem } from "../../../store/sessionModel.ts";

/** What of a Turn the count reads (a `TurnView` is one). */
export interface LiveTurn {
  readonly live: ReadonlyMap<string, LiveItem>;
  readonly subagents: ReadonlyArray<{ readonly live: ReadonlyMap<string, LiveItem> }>;
}

const runningIds = (live: ReadonlyMap<string, LiveItem>) =>
  [...live.values()].flatMap(({ item }) =>
    item !== null && Predicate.isTagged(item, "CommandExecution") && item.status === "running"
      ? [item.id]
      : []
  );

/** How many commands run now; one both in flight and in the background counts once. */
export const runningCommands = (
  turn: LiveTurn | undefined,
  backgroundTasks: ReadonlyArray<BackgroundTask>
): number => {
  const ids = new Set([
    ...(turn === undefined ? [] : runningIds(turn.live)),
    ...(turn?.subagents ?? []).flatMap((s) => runningIds(s.live)),
    ...backgroundTasks.flatMap((t) => (t.kind === "command" ? [t.id] : [])),
  ]);

  return ids.size;
};

/** "2 commands running"; null when none is. */
export const runningPhrase = (count: number): string | null =>
  count === 0 ? null : `${count} ${count === 1 ? "command" : "commands"} running`;
