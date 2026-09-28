/**
 * Context for a Fork's first Turn.
 *
 * A Fork never reuses its parent's Harness cursor: the Fork may run a different
 * Harness, and even with the same one, resuming the parent's native session
 * would carry every Turn after the fork point too. The Fork's Harness starts a
 * fresh native session instead, and its first Turn is prefixed with a short
 * account of the parent's conversation up to the fork point: each Turn's prompt
 * and the Harness's last reply, newest kept when the budget runs out. The Turn
 * the user sees keeps their own prompt; only the Harness gets the preamble.
 */
import type { TurnItem } from "@polaris/protocol"

/** Characters of earlier conversation to include, at most. */
export const FORK_CONTEXT_BUDGET = 24_000
/** Characters of one prompt or reply, at most. */
const PART_LIMIT = 2_000

export interface ForkedTurn {
  readonly prompt: string
  /** The Harness's final reply, when it gave one. */
  readonly reply: string | null
}

const clip = (text: string, limit = PART_LIMIT): string => {
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit - 1)}…` : trimmed
}

/** The last assistant message of a Turn: what the Harness answered in the end. */
export const finalReply = (items: ReadonlyArray<TurnItem> | undefined): string | null => {
  if (items === undefined) return null
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!
    if (item._tag === "AssistantMessage" && item.text.trim() !== "") return item.text
  }
  return null
}

export const forkPreamble = (options: {
  readonly parentTitle: string
  /** The Turns up to and including the one forked from, oldest first. */
  readonly turns: ReadonlyArray<ForkedTurn>
  /** The Fork works in its own Worktree created at the forked Turn's checkpoint. */
  readonly ownWorktree: boolean
  readonly prompt: string
}): string => {
  const blocks: Array<string> = []
  let used = 0
  let omitted = 0
  for (let i = options.turns.length - 1; i >= 0; i--) {
    const turn = options.turns[i]!
    const block = [
      `Turn ${i + 1}`,
      `User: ${clip(turn.prompt) || "(no prompt recorded)"}`,
      `Assistant: ${turn.reply === null ? "(no reply recorded)" : clip(turn.reply)}`,
    ].join("\n")
    if (used + block.length > FORK_CONTEXT_BUDGET && blocks.length > 0) {
      omitted = i + 1
      break
    }
    blocks.unshift(block)
    used += block.length
  }
  const where = options.ownWorktree
    ? "The working directory is a new git worktree holding the files exactly as they were right after the last Turn below."
    : "The working directory is shared with that session, so files may have changed since."
  return [
    `[Context from Polaris] This session is a fork of the session "${clip(options.parentTitle, 200)}". You have not seen its conversation, so here it is for context. ${where}`,
    "",
    "<earlier-conversation>",
    ...(omitted > 0 ? [`(${omitted} earlier Turn${omitted === 1 ? "" : "s"} omitted)`, ""] : []),
    blocks.join("\n\n"),
    "</earlier-conversation>",
    "",
    "The user's new request follows.",
    "",
    options.prompt,
  ].join("\n")
}
