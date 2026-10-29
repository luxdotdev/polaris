/**
 * Idle compaction's Turn (`Turn.idleCompaction`, ENG-562): the Daemon's `/compact` while the
 * prompt cache is warm. Never the user's Turn: it folds into the one before it as a quiet line.
 */
import { IDLE_COMPACTION_NOTE, type Turn } from "@polaris/protocol";
import { triggerPhrase } from "./background.ts";

export const isIdleCompaction = (turn: Pick<Turn, "idleCompaction">): boolean =>
  turn.idleCompaction === true;

/** While it runs it says so; once done, Claude Code's own words. */
export const IDLE_COMPACTING = "Compacting while idle, before the prompt cache expires";

/** The quiet line for a Turn the user didn't send, or null for the user's own. */
export const quietOpening = (
  turn: Pick<Turn, "trigger" | "idleCompaction" | "status">
): string | null => {
  if (isIdleCompaction(turn))
    return turn.status === "completed" ? IDLE_COMPACTION_NOTE : IDLE_COMPACTING;

  return turn.trigger === null ? null : triggerPhrase(turn.trigger);
};
