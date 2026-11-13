/**
 * Origins (ENG-932, ADR 0111) as the Daemon holds it before first use: the service, the follower of
 * after-checkpoints and the backfill's schedule. The rest (`index.ts`) loads with the first lookup,
 * the first after-checkpoint or the backfill.
 */
import {
  type GitError,
  type NotFound,
  type OriginLine,
  type OriginLineQuery,
  OriginRpcs,
  type OriginSession,
  type SessionId,
  type TurnId,
  type WorkspaceId,
  type WorktreeId,
} from "@polaris/protocol";
import { Context, Deferred, type Duration, Effect, Layer, Predicate, Stream } from "effect";
import type { LiveItem } from "../store/hub.ts";
import type { ReadModel } from "../store/model.ts";
import type { ServiceError } from "../services.ts";
import { EventStore } from "../store/EventStore.ts";
import { cacheDaemonBuild } from "../transport/lazy.ts";

export interface BlameRequest {
  readonly workspaceId: WorkspaceId;
  readonly worktreeId?: WorktreeId | null;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
}

export interface Blamed {
  readonly repoKey: string;
  readonly lines: ReadonlyArray<{
    readonly line: number;
    readonly path: string;
    readonly hash: string | null;
    readonly commit: {
      readonly sha: string;
      readonly subject: string;
      readonly authorName: string;
      readonly authorEmail: string;
      readonly time: number;
    } | null;
  }>;
}

export interface Matched {
  readonly lines: ReadonlyArray<OriginLine>;
  readonly sessions: ReadonlyArray<OriginSession>;
}

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

/** What `index.ts` builds on first use. */
export interface OriginsEngine {
  readonly blame: (request: BlameRequest) => Effect.Effect<Blamed, NotFound | GitError>;
  readonly match: (
    repoKey: string,
    lines: ReadonlyArray<OriginLineQuery>
  ) => Effect.Effect<Matched>;
  readonly forCommit: (
    workspaceId: WorkspaceId,
    sha: string
  ) => Effect.Effect<ReadonlyArray<OriginSession>, NotFound | GitError>;
  readonly indexTurn: (sessionId: SessionId, turnId: TurnId, at: number) => Effect.Effect<boolean>;
  /** Fingerprints the Turns not yet indexed of these sessions; how many failed. */
  readonly backfillSessions: (
    sessionIds: ReadonlyArray<SessionId>
  ) => Effect.Effect<number, ServiceError>;
}

export class Origins extends Context.Service<
  Origins,
  {
    readonly blame: OriginsEngine["blame"];
    /** Each line's Origins from this Host's fingerprints of `repoKey`. */
    readonly match: OriginsEngine["match"];
    readonly forCommit: OriginsEngine["forCommit"];
    /** Fingerprints one Turn now (the follower and backfill do this on their own); false if git failed. */
    readonly indexTurn: OriginsEngine["indexTurn"];
    /** Deletes a session's fingerprints, as deleting the Agent Session must. */
    readonly forgetSession: (sessionId: SessionId) => Effect.Effect<void>;
    /** Once this start's backfill has ended: how many Turns it failed on (0 when it is done). */
    readonly backfillFinished: Effect.Effect<number>;
  }
>()("polaris/daemon/origins/Origins") {
  /** Follows new checkpoints and runs the upgrade's backfill for as long as it lives; loads on first use. */
  static readonly layer = Layer.effect(
    Origins,
    Effect.suspend(() => make)
  );
}

const isAfterCheckpoint = (item: LiveItem): boolean =>
  Predicate.isTagged(item, "Event") &&
  Predicate.isTagged(item.envelope.event, "CheckpointRecorded") &&
  item.envelope.event.ref.endsWith("/after");

/** The sessions the backfill fingerprints: those of git Workspaces. */
const gitSessions = (model: ReadModel) =>
  [...model.sessions.values()].flatMap(({ session }) =>
    model.workspaces.get(session.workspaceId)?.isGitRepo === true ? [session.id] : []
  );

const make = Effect.gen(function* () {
  const store = yield* EventStore;

  const engine = yield* cacheDaemonBuild(
    Effect.gen(function* () {
      const { makeOrigins } = yield* Effect.promise(() => import("./index.ts"));

      return yield* Effect.provideService(makeOrigins, EventStore, store);
    })
  );

  const indexTurn = (sessionId: SessionId, turnId: TurnId, at: number) =>
    Effect.flatMap(engine, (loaded) => loaded.indexTurn(sessionId, turnId, at)).pipe(
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

  /**
   * Once per database: every logged Turn of a git Workspace, one at a time. A Turn that failed
   * leaves it undone, so the next start tries the Turns still unmarked.
   */
  const backfill = Effect.gen(function* () {
    if (yield* store.origins.backfillDone) return 0;
    const sessionIds = gitSessions(yield* store.model);

    if (sessionIds.length > 0) {
      yield* Effect.sleep((yield* OriginsConfig).backfillDelay);
      const failed = yield* Effect.flatMap(engine, (loaded) => loaded.backfillSessions(sessionIds));

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

  const finished = yield* Deferred.make<number>();

  yield* Effect.forkScoped(follow);
  yield* Effect.forkScoped(
    Effect.flatMap(backfill, (failed) => Deferred.succeed(finished, failed))
  );

  return Origins.of({
    blame: (request) => Effect.flatMap(engine, (loaded) => loaded.blame(request)),
    match: (repoKey, lines) => Effect.flatMap(engine, (loaded) => loaded.match(repoKey, lines)),
    forCommit: (workspaceId, sha) =>
      Effect.flatMap(engine, (loaded) => loaded.forCommit(workspaceId, sha)),
    indexTurn,
    forgetSession: store.origins.dropSession,
    backfillFinished: Deferred.await(finished),
  });
});

/** Handlers for `git.blame`, `origins.match` and `origins.forCommit` (capability `origins`). */
export const OriginRpcsLive = OriginRpcs.toLayer(
  Effect.gen(function* () {
    const origins = yield* Origins;

    return {
      "git.blame": (request) => origins.blame(request),
      "origins.match": ({ repoKey, lines }) => origins.match(repoKey, lines),
      "origins.forCommit": ({ workspaceId, sha }) =>
        Effect.map(origins.forCommit(workspaceId, sha), (sessions) => ({ sessions })),
    };
  })
);
