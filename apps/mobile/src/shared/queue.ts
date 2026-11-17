/**
 * A shared session's queue in the thread (DESIGN.md, Shared Sessions): each queued Turn with its
 * author, who may cancel or edit it, and whether the queue waits paused for Resume.
 */
import type { QueuedTurn } from "@polaris/protocol";
import { Predicate } from "effect";
import type { SessionFold } from "../thread/fold.ts";
import type { Viewer } from "./model.ts";

export interface QueueView {
  readonly turns: ReadonlyArray<QueuedTurn>;
  /** Turns wait behind none: the one before them was stopped, so someone must Resume. */
  readonly paused: boolean;
}

export const queueView = (fold: SessionFold | null): QueueView => {
  const turns = fold?.queuedTurns ?? [];
  const working = fold?.turns.at(-1)?.turn.status === "working";

  return { turns, paused: turns.length > 0 && !working };
};

/** Its author or the owner may cancel or edit a queued Turn (`mayChangeQueuedTurn`). */
export const mayChangeQueued = (queued: QueuedTurn, viewer: Viewer): boolean =>
  viewer.kind === "owner" ||
  (Predicate.isTagged(queued.actor, "Teammate") && queued.actor.personId === viewer.personId);

/** "Queue paused · 2 Turns". */
export const pausedLine = (count: number): string =>
  `Queue paused · ${count} Turn${count === 1 ? "" : "s"}`;
