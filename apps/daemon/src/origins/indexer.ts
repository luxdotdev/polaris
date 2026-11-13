/**
 * Writes Origins' fingerprints (ADR 0111): each Turn's added lines when its after-checkpoint is
 * recorded, and once on upgrade, every Turn whose checkpoints survive (`service.ts` schedules both).
 */
import type { SessionId, TurnId, Workspace } from "@polaris/protocol";
import { Effect } from "effect";
import { EventStore } from "../store/EventStore.ts";
import { type Fingerprint, turnKey } from "../store/origins.ts";
import type { AddedLine } from "./addedLines.ts";
import { turnAddedLines } from "./git.ts";
import { lineHash } from "./lineHash.ts";
import { OriginsConfig } from "./service.ts";

/** A Turn past this many distinct lines wrote a dump (a lockfile, a vendored tree): the rest go unindexed. */
export const MAX_FINGERPRINTS_PER_TURN = 50_000;

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

    return { indexTurn, backfillSessions };
  });
