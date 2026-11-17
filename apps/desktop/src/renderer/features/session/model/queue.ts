/**
 * A shared session's queue as the composer shows it (DESIGN.md, Shared Sessions; Paper SS1):
 * each queued Turn with its author, who may cancel or edit it, and whether the queue is paused.
 */
import type { Actor } from "@polaris/protocol";
import { Predicate } from "effect";
import type { SessionModel } from "../../../store/sessionModel.ts";
import type { SessionQueuedTurn } from "../../../store/sessionQueue.ts";

export type { SessionQueuedTurn };

/** Who is looking: the owner (any of their own Clients), or a Teammate by the names they go by. */
export type QueueViewer =
  | { readonly kind: "owner" }
  | { readonly kind: "teammate"; readonly names: ReadonlyArray<string> };

export interface QueueView {
  readonly turns: ReadonlyArray<SessionQueuedTurn>;
  /** Turns wait behind none: the one before them was interrupted, so someone must Resume. */
  readonly paused: boolean;
}

/** The queue, and paused when Turns wait with no Turn in flight (the Daemon's `isPaused`). */
export const queueView = (model: SessionModel): QueueView => {
  const turns = model.queuedTurns ?? [];
  const working = model.turns.at(-1)?.turn.status === "working";

  return { turns, paused: turns.length > 0 && !working };
};

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Whether `actor` is the viewer: a Teammate's Turns are theirs, the rest are the owner's. */
export const isViewer = (actor: Actor, viewer: QueueViewer): boolean => {
  if (viewer.kind === "owner") return !Predicate.isTagged(actor, "Teammate");

  return (
    Predicate.isTagged(actor, "Teammate") && viewer.names.some((name) => sameName(name, actor.name))
  );
};

/** Its author or the owner may cancel or edit a queued Turn (`mayChangeQueuedTurn`). */
export const mayChange = (queued: SessionQueuedTurn, viewer: QueueViewer): boolean =>
  viewer.kind === "owner" || isViewer(queued.actor, viewer);

const turns = (n: number) => `${n} turn${n === 1 ? "" : "s"}`;

/** The paused queue's line: "Queue paused · 2 turns". */
export const pausedLine = (count: number): string => `Queue paused · ${turns(count)}`;
