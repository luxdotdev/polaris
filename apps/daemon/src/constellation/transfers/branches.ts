import {
  type AttemptId,
  type Constellation,
  type ConstellationId,
  ConstellationStreamItem,
} from "@polaris/protocol";
import { type Cause, Context, Effect, Layer, Queue, Stream, type Scope } from "effect";
import { constellationRef } from "../../git/constellationBundles.ts";
import { resolveCommit } from "../../git/git.ts";
import { EventStore } from "../../store/EventStore.ts";
import { gitOperation } from "../worktrees.ts";

type Update = Extract<ConstellationStreamItem, { _tag: "BranchFetched" }>;

export interface BranchStatusService {
  readonly read: (graph: Constellation) => Effect.Effect<ReadonlySet<AttemptId>>;
  readonly changed: (id: ConstellationId, attemptId: AttemptId) => Effect.Effect<void>;
  readonly subscribe: (
    id: ConstellationId
  ) => Effect.Effect<Stream.Stream<Update>, never, Scope.Scope>;
}

export class ConstellationBranchStatus extends Context.Reference<BranchStatusService>(
  "polaris/constellation/BranchStatus",
  {
    defaultValue: () => ({
      read: () => Effect.succeed(new Set<AttemptId>()),
      changed: () => Effect.void,
      subscribe: () => Effect.succeed(Stream.empty),
    }),
  }
) {
  static readonly layer = Layer.effect(
    ConstellationBranchStatus,
    Effect.gen(function* () {
      const store = yield* EventStore;
      const subscribers = new Map<ConstellationId, Set<Queue.Queue<Update, Cause.Done>>>();

      return {
        read: Effect.fnUntraced(function* (graph) {
          const model = yield* store.model;

          const repo =
            model.sessions.get(graph.leadSessionId)?.session.cwd ??
            model.workspaces.get(graph.workspaceId)?.path;

          const result = new Set<AttemptId>();

          if (repo === undefined) return result;

          for (const attempt of graph.attempts) {
            if (attempt.hostId === graph.hostId || attempt.claim === null) continue;

            const head = yield* gitOperation(() =>
              resolveCommit(repo, constellationRef(graph.id, attempt.id))
            ).pipe(Effect.catchTag("ConstellationTransferError", () => Effect.succeed(null)));

            if (head === attempt.claim.head) result.add(attempt.id);
          }

          return result;
        }),
        changed: (id, attemptId) =>
          Effect.sync(() => {
            const item = ConstellationStreamItem.cases.BranchFetched.make({
              attemptId,
              branchFetched: true,
            });

            for (const queue of subscribers.get(id) ?? []) Queue.offerUnsafe(queue, item);
          }),
        subscribe: Effect.fnUntraced(function* (id) {
          const queue = yield* Queue.sliding<Update, Cause.Done>(256);
          const bucket = subscribers.get(id) ?? new Set();
          bucket.add(queue);
          subscribers.set(id, bucket);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              bucket.delete(queue);

              if (bucket.size === 0) subscribers.delete(id);
              Queue.endUnsafe(queue);
            })
          );

          return Stream.fromQueue(queue);
        }),
      } satisfies BranchStatusService;
    })
  );
}
