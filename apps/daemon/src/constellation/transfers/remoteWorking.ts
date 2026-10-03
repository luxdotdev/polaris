import {
  type Attempt,
  type AttemptId,
  type RemoteWorkerAssignment,
  type ConstellationTransferError,
} from "@polaris/protocol";
import { Effect, Exit, Layer, Scope } from "effect";
import { HostResources } from "../../resources/index.ts";
import { McpTokens } from "../../mcp/index.ts";
import { ConstellationOwner } from "../runtime.ts";
import { workerEnvironment, type WorkerEnvironment } from "../host.ts";
import { TransferStorage } from "./storage.ts";
import { RemoteWorkers, type RemoteWorkerHooks } from "./assignments.ts";
import { assignmentAttempt } from "./outbox.ts";

export interface RemoteWorkingHooks<E, R> {
  readonly prepare: RemoteWorkerHooks["prepare"];
  readonly start: (
    assignment: RemoteWorkerAssignment,
    env: Readonly<WorkerEnvironment>
  ) => Effect.Effect<void, E, R>;
  readonly resume: (
    assignment: RemoteWorkerAssignment,
    env: Readonly<WorkerEnvironment>
  ) => Effect.Effect<void, E, R>;
  readonly failed: (
    attempt: Attempt,
    error: E | ConstellationTransferError | import("@polaris/protocol").ResourceError
  ) => Effect.Effect<void, never, R>;
}

const retainsWorkerSlot = (attempt: Attempt) =>
  attempt.state === "working" || attempt.state === "blocked";

/** Worker slots follow remote mirrors and locally queued Claims, without committing owner events here. */
export const remoteWorkingAttemptsLayer = <E, R>(hooks: RemoteWorkingHooks<E, R>) =>
  Layer.effect(
    RemoteWorkers,
    Effect.gen(function* () {
      const resources = yield* HostResources;
      const tokens = yield* McpTokens;
      const storage = yield* TransferStorage;
      const hostId = yield* ConstellationOwner;
      const parent = yield* Effect.scope;
      const context = yield* Effect.context<R>();
      const started = new Set<AttemptId>();
      const working = new Map<AttemptId, Scope.Closeable>();

      const stop = Effect.fnUntraced(function* (id: AttemptId) {
        const scope = working.get(id);
        working.delete(id);

        if (scope !== undefined) yield* Scope.close(scope, Exit.void);
      });

      const start = Effect.fnUntraced(function* (
        assignment: RemoteWorkerAssignment,
        resume: boolean
      ) {
        const attempt = assignmentAttempt(assignment);
        const latest = assignment.graph.attempts.findLast((a) => a.taskId === attempt.taskId);

        if (
          attempt.hostId !== hostId ||
          !retainsWorkerSlot(attempt) ||
          latest?.id !== attempt.id ||
          assignment.graph.state === "completed" ||
          assignment.graph.state === "archived"
        ) {
          yield* stop(attempt.id);

          if (
            (attempt.state !== "review" && attempt.state !== "blocked") ||
            assignment.graph.state === "archived"
          )
            yield* tokens.revokeAttempt(attempt.id).pipe(Effect.orDie);

          return;
        }

        if ((yield* storage.claimedAttempts).has(attempt.id)) {
          yield* stop(attempt.id);

          return;
        }

        if (working.has(attempt.id)) return;
        const scope = yield* Scope.fork(parent);
        working.set(attempt.id, scope);
        yield* Effect.gen(function* () {
          yield* resources.acquireWorker(attempt.sessionId);
          const current = (yield* storage.assignments).find((a) => a.attemptId === attempt.id);

          if (current === undefined || !retainsWorkerSlot(assignmentAttempt(current))) {
            yield* stop(attempt.id).pipe(Effect.forkIn(parent), Effect.asVoid);

            return;
          }

          const continuing = resume || attempt.state === "blocked" || started.has(attempt.id);
          started.add(attempt.id);
          yield* (
            continuing
              ? hooks.resume(current, workerEnvironment(attempt))
              : hooks.start(current, workerEnvironment(attempt))
          ).pipe(Effect.provide(context));
        }).pipe(
          Effect.catch((error) =>
            hooks
              .failed(attempt, error)
              .pipe(
                Effect.provide(context),
                Effect.andThen(stop(attempt.id).pipe(Effect.forkIn(parent), Effect.asVoid))
              )
          ),
          Scope.provide(scope),
          Effect.forkIn(scope)
        );
      });

      return {
        prepare: hooks.prepare,
        assigned: (assignment) => start(assignment, false),
        resume: (assignment) => start(assignment, true),
        claimed: stop,
      } satisfies RemoteWorkerHooks;
    })
  );
