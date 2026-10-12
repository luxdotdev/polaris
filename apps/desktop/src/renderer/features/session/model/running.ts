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

/** A command running now: its id, and what it runs (the background task's description). */
export interface Running {
  readonly id: string;
  readonly command: string;
}

const inFlight = (live: ReadonlyMap<string, LiveItem>): ReadonlyArray<Running> =>
  [...live.values()].flatMap(({ item }) =>
    item !== null && Predicate.isTagged(item, "CommandExecution") && item.status === "running"
      ? [{ id: item.id, command: item.command }]
      : []
  );

/** The commands running now, in flight first; one both in flight and in the background is listed once. */
export const runningCommands = (
  turn: LiveTurn | undefined,
  backgroundTasks: ReadonlyArray<BackgroundTask>
): ReadonlyArray<Running> => {
  const all = [
    ...(turn === undefined ? [] : inFlight(turn.live)),
    ...(turn?.subagents ?? []).flatMap((s) => inFlight(s.live)),
    ...backgroundTasks.flatMap((t) =>
      t.kind === "command" ? [{ id: t.id, command: t.description }] : []
    ),
  ];

  return all.filter((r, i) => all.findIndex((o) => o.id === r.id) === i);
};

/** "running bun test" for one (its first line), "2 commands running" for more; null for none. */
export const runningPhrase = (running: ReadonlyArray<Running>): string | null => {
  const [only] = running;

  if (only === undefined) return null;

  if (running.length > 1) return `${running.length} commands running`;
  const line = only.command.trim().split("\n", 1)[0] ?? "";

  return line === "" ? "1 command running" : `running ${line}`;
};
