/**
 * Idle compaction's Turn (`Turn.idleCompaction`, ENG-570): the Daemon's `/compact` while the
 * prompt cache is warm. Never the user's Turn: it reads as a quiet line after the one before it.
 */
import { IDLE_COMPACTION_NOTE, type Turn } from "@polaris/protocol";

export const isIdleCompaction = (turn: Pick<Turn, "idleCompaction">): boolean =>
  turn.idleCompaction === true;

/** While it runs it says so; once done, Claude Code's own words, as the Desktop App says them. */
export const IDLE_COMPACTING = "Compacting while idle, before the prompt cache expires";

/** The quiet line in place of an idle compaction's `/compact`, or null for any other Turn. */
export const compactionLine = (turn: Pick<Turn, "idleCompaction" | "status">): string | null => {
  if (!isIdleCompaction(turn)) return null;

  return turn.status === "completed" ? IDLE_COMPACTION_NOTE : IDLE_COMPACTING;
};
