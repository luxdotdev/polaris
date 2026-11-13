/**
 * Writes Origins' fingerprints (ADR 0111): each Turn's added lines when its after-checkpoint is
 * recorded, and once on upgrade, every Turn whose checkpoints survive, throttled in the background.
 */
import type { SessionId, TurnId, Workspace } from "@polaris/protocol";
import { Context, Deferred, Duration, Effect, Predicate, Stream } from "effect";
import type { LiveItem } from "../store/hub.ts";
import { EventStore } from "../store/EventStore.ts";
import { type Fingerprint, turnKey } from "../store/origins.ts";
import type { AddedLine } from "./addedLines.ts";
import { turnAddedLines } from "./git.ts";
import { lineHash } from "./lineHash.ts";

/** A Turn past this many distinct lines wrote a dump (a lockfile, a vendored tree): the rest go unindexed. */
export const MAX_FINGERPRINTS_PER_TURN = 50_000;

export interface OriginsSettings {
  /** How long after start the upgrade's backfill waits, so it never competes with a start. */
  readonly backfillDelay: Duration.Input;
  /** The pause between two Turns of the backfill. */
  readonly backfillPause: Duration.Input;
}

export class OriginsConfig extends Context.Reference<OriginsSettings>(
  "polaris/daemon/origins/OriginsConfig",
  { defaultValue: () => ({ backfillDelay: "2 minutes", backfillPause: "250 millis" }) }
) {}

/** Each distinct (hash, path) the lines carry, skipping lines too common to identify. */
export const fingerprintsOf = (lines: ReadonlyArray<AddedLine>): ReadonlyArray<Fingerprint> => {
  const seen = new Map<string, Fingerprint>();

  for (const { path, text } of lines) {
    const hash = lineHash(text);

    if (hash === null) continue;
    seen.set(`${hash}\0${path}`, { lineHash: hash, path });

    if (seen.size >= MAX_FINGERPRINTS_PER_TURN) break;
  }

  return [...seen.values()];
};

const isAfterCheckpoint = (item: LiveItem): boolean =>
  Predicate.isTagged(item, "Event") &&
  Predicate.isTagged(item.envelope.event, "CheckpointRecorded") &&
  item.envelope.event.ref.endsWith("/after");

export const indexing = <E>(repoKeyOf: (workspace: Workspace) => Effect.Effect<string | null, E>) =>
  Effect.gen(function* () {
    const store = yield* EventStore;

    /**
     * Fingerprints one Turn; a Turn whose checkpoints are gone is marked with none. False when
     * git or the store failed, so the backfill tries it again on the next start.
     */
    const indexTurn = (sessionId: SessionId, turnId: TurnId, at: number) =>
      Effect.gen(function* () {
        const model = yield* store.model;
        const workspaceId = model.sessions.get(sessionId)?.session.workspaceId;
        const workspace = workspaceId === undefined ? undefined : model.workspaces.get(workspaceId);

        if (workspace?.isGitRepo !== true) return true;
        const repoKey = yield* repoKeyOf(workspace);

        if (repoKey === null) return true;

        const added = yield* Effect.tryPromise(() =>
          turnAddedLines(workspace.path, sessionId, turnId)
        );

        yield* store.origins.record({
          workspaceId: workspace.id,
          repoKey,
          sessionId,
          turnId,
          at,
          fingerprints: fingerprintsOf(added ?? []),
        });

        // Removed while git ran: its rows went with the Workspace, so these go too.
        if (!(yield* store.model).sessions.has(sessionId))
          yield* store.origins.dropSession(sessionId);

        return true;
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.as(Effect.logWarning(`fingerprinting ${turnId}`, cause), false)
        )
      );

    /** Re-subscribes if the store drops this subscriber for falling behind. */
    const follow = Effect.scoped(
      Effect.gen(function* () {
        const live = yield* store.subscribe({ filter: isAfterCheckpoint });
        yield* Stream.runForEach(live, (item) => {
          if (!Predicate.isTagged(item, "Event")) return Effect.void;
          const { event, occurredAt } = item.envelope;

          return Predicate.isTagged(event, "CheckpointRecorded")
            ? Effect.asVoid(indexTurn(event.sessionId, event.turnId, Date.parse(occurredAt)))
            : Effect.void;
        });
      })
    ).pipe(Effect.forever);

    /** How many Turns failed; the backfill is done only when none did. */
    const backfillSessions = (sessionIds: ReadonlyArray<SessionId>) =>
      Effect.gen(function* () {
        let failed = 0;
        const { backfillPause } = yield* OriginsConfig;
        const turnIds = yield* store.readTurnIds(sessionIds);
        const indexed = yield* store.origins.indexedTurns(sessionIds);

        for (const [sessionId, turns] of turnIds) {
          for (const turnId of turns) {
            if (indexed.has(turnKey(sessionId, turnId))) continue;
            const turn = yield* store.readTurn({ sessionId, turnId });

            if (turn === null || turn.status === "working") continue;
            const at = Date.parse(turn.endedAt ?? turn.startedAt);

            if (!(yield* indexTurn(sessionId, turnId, at))) failed++;
            yield* Effect.sleep(backfillPause);
          }
        }

        return failed;
      });

    /**
     * Once per database: every logged Turn of a git Workspace, one at a time. A Turn that failed
     * leaves it undone, so the next start tries the Turns still unmarked.
     */
    const run = Effect.gen(function* () {
      if (yield* store.origins.backfillDone) return 0;
      const model = yield* store.model;

      const sessionIds = [...model.sessions.values()].flatMap(({ session }) =>
        model.workspaces.get(session.workspaceId)?.isGitRepo === true ? [session.id] : []
      );

      if (sessionIds.length > 0) {
        yield* Effect.sleep((yield* OriginsConfig).backfillDelay);
        const failed = yield* backfillSessions(sessionIds);

        if (failed > 0) {
          yield* Effect.logWarning(`Origins backfill: ${failed} Turns failed, retried next start`);

          return failed;
        }
      }

      yield* store.origins.markBackfillDone;

      return 0;
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.as(Effect.logWarning("Origins backfill stopped", cause), Number.POSITIVE_INFINITY)
      )
    );

    /** How many Turns this start's backfill failed on, once it has ended. */
    const finished = yield* Deferred.make<number>();
    const backfill = Effect.flatMap(run, (failed) => Deferred.succeed(finished, failed));

    return { indexTurn, follow, backfill, backfillFinished: Deferred.await(finished) };
  });
