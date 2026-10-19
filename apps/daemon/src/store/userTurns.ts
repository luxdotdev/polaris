/**
 * User Turns (capability `session.user-turns`): how the fold numbers a session's Turns as the
 * user sees them, and which items give a Turn its reply preview. The SQL backfill shares it.
 */
import type { CurrentUserTurn, DomainEvent, TurnId } from "@polaris/protocol";
import { Predicate } from "effect";

/**
 * The user Turn after a new Turn starts: a Turn without a trigger opens the next one, and so
 * does a session's first Turn; a Turn the Harness started stays in the current one.
 */
export const userTurnAfter = (
  current: CurrentUserTurn | null,
  turn: { readonly id: TurnId; readonly startedAt: string; readonly harnessStarted: boolean }
): CurrentUserTurn =>
  current !== null && turn.harnessStarted
    ? current
    : { turnId: turn.id, number: (current?.number ?? 0) + 1, startedAt: turn.startedAt };

type ItemCompleted = Extract<DomainEvent, { readonly _tag: "TurnItemCompleted" }>;

/** The reply text a completed item gives its Turn: the Turn's own assistant message's. */
export const replyText = (event: ItemCompleted): string | null =>
  event.subagentId === null && Predicate.isTagged(event.item, "AssistantMessage")
    ? event.item.text
    : null;
