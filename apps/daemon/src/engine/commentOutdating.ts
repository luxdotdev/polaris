/**
 * `CommentOutdating` (ADR 0113): when a Turn's after-checkpoint is recorded, a `DiffLines`
 * Comment on the new side of an earlier Turn whose lines that Turn's tree changed since is
 * marked outdated (`CommentOutdated`). It is never moved; removed-line Comments never go stale.
 */
import {
  type Comment,
  DomainEvent,
  type SessionId,
  type Turn,
  type TurnId,
} from "@polaris/protocol";
import { Context, Effect, Layer, Predicate, Stream } from "effect";
import type { LineSpan } from "../git/changedLines.ts";
import { commentsOf } from "../store/comments.ts";
import type { LiveItem } from "../store/EventStore.ts";
import type { SessionRecord } from "../store/model.ts";
import { EngineRuntime } from "./runtime.ts";

/** Whether a change of `spans` touches lines `start` to `end` (inclusive). */
export const touchesLines = (spans: ReadonlyArray<LineSpan>, start: number, end: number) =>
  spans.some((span) =>
    span.count === 0
      ? span.start >= start && span.start < end
      : span.start <= end && span.start + span.count - 1 >= start
  );

/** The Comments `turn` could make outdated: new-side line Comments of other Turns, still current. */
export const outdatingCandidates = (
  record: SessionRecord,
  turnId: TurnId
): ReadonlyArray<Comment> =>
  [...commentsOf(record).values()].filter(
    (comment) =>
      comment.outdatedInTurnId == null &&
      Predicate.isTagged(comment.anchor, "DiffLines") &&
      comment.anchor.side === "new" &&
      comment.anchor.turnId !== turnId
  );

const isAfterCheckpoint = (item: LiveItem): boolean =>
  Predicate.isTagged(item, "Event") &&
  Predicate.isTagged(item.envelope.event, "CheckpointRecorded") &&
  item.envelope.event.ref.endsWith("/after");

const make = Effect.gen(function* () {
  const rt = yield* EngineRuntime;
  const changedLines = rt.checkpoints.changedLines;

  /** Whether the lines `comment` is anchored to changed from its Turn's tree to `to`. */
  const changed = (record: SessionRecord, comment: Comment, turn: Turn, to: string) =>
    Effect.gen(function* () {
      const anchor = comment.anchor;

      if (changedLines === undefined || !Predicate.isTagged(anchor, "DiffLines")) return false;
      const anchored = yield* rt.findTurn(record.session.id, anchor.turnId);

      if (anchored?.checkpointAfter == null || anchored.index >= turn.index) return false;

      const spans = yield* changedLines({
        cwd: record.session.cwd,
        from: anchored.checkpointAfter,
        to,
        path: anchor.path,
      });

      return touchesLines(spans, anchor.start, anchor.end);
    }).pipe(
      Effect.catch((error) =>
        Effect.as(Effect.logWarning(`outdating Comment ${comment.id}: ${error.message}`), false)
      )
    );

  const onCheckpoint = (sessionId: SessionId, turnId: TurnId, to: string) =>
    Effect.gen(function* () {
      const record = (yield* rt.store.model).sessions.get(sessionId);
      const turn = record === undefined ? null : yield* rt.findTurn(sessionId, turnId);

      if (record === undefined || turn === null) return;
      const outdated: Array<Comment> = [];

      for (const comment of outdatingCandidates(record, turnId))
        if (yield* changed(record, comment, turn, to)) outdated.push(comment);

      if (outdated.length === 0) return;
      yield* rt.recordFor(sessionId, (now) =>
        outdated.flatMap((c) =>
          commentsOf(now).get(c.id)?.outdatedInTurnId == null
            ? [DomainEvent.cases.CommentOutdated.make({ sessionId, commentId: c.id, turnId })]
            : []
        )
      );
    });

  /** Re-subscribes if the store drops this subscriber for falling behind. */
  const follow = Effect.forkIn(
    Effect.scoped(
      Effect.gen(function* () {
        const live = yield* rt.store.subscribe({ filter: isAfterCheckpoint });
        yield* Stream.runForEach(live, (item) => {
          if (!Predicate.isTagged(item, "Event")) return Effect.void;
          const event = item.envelope.event;

          if (!Predicate.isTagged(event, "CheckpointRecorded")) return Effect.void;

          return onCheckpoint(event.sessionId, event.turnId, event.ref).pipe(
            Effect.catchCause((cause) => Effect.logError("marking Comments outdated", cause))
          );
        });
      })
    ).pipe(Effect.forever),
    rt.engineScope
  ).pipe(Effect.asVoid);

  return CommentOutdating.of({ follow });
});

export class CommentOutdating extends Context.Service<
  CommentOutdating,
  {
    /** Fork the follower of after-checkpoints into the Engine's scope. */
    readonly follow: Effect.Effect<void>;
  }
>()("polaris/daemon/engine/CommentOutdating") {
  static readonly layer = Layer.effect(CommentOutdating, make);
}
