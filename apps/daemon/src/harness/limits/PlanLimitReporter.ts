/**
 * Where drivers report the Plan Limits their Harness exposed (ADR 0001). A thin
 * front for the Usage index's `PlanLimitSink`, which persists them and sends
 * them on `usage.watch`: it keeps the newest reading per window and drops repeats.
 */
import type { PlanLimit } from "@polaris/protocol";
import { Context, Effect, Layer, Queue } from "effect";
import { PlanLimitSink } from "../../services.ts";

export class PlanLimitReporter extends Context.Service<
  PlanLimitReporter,
  {
    /** Synchronous, for SDK callbacks and notification handlers. */
    readonly report: (limits: ReadonlyArray<PlanLimit>) => void;
  }
>()("polaris/daemon/harness/PlanLimitReporter") {
  /** Drops every report: for a registry run without the Usage index (scripts, tests). */
  static readonly none = Layer.succeed(
    PlanLimitReporter,
    PlanLimitReporter.of({ report: () => {} })
  );

  /** Requires `PlanLimitSink`. */
  static readonly layer = Layer.effect(
    PlanLimitReporter,
    Effect.gen(function* () {
      const sink = yield* PlanLimitSink;
      const known = new Map<string, PlanLimit>();
      const pending = yield* Queue.unbounded<PlanLimit>();

      // Blocked on the queue while nothing is reported: no wakeups when idle.
      yield* Effect.forkScoped(
        Effect.forever(Effect.flatMap(Queue.take(pending), (limit) => sink.report(limit)))
      );

      return PlanLimitReporter.of({
        report: (limits) => {
          for (const limit of mergeLimits(known, limits)) Queue.offerUnsafe(pending, limit);
        },
      });
    })
  );
}

/** A value that only confirms the last one is re-announced at most this often (ms). */
export const REANNOUNCE_AFTER_MS = 60_000;

const keyOf = (limit: PlanLimit) => JSON.stringify([limit.harness, limit.kind, limit.scope]);

const sameValue = (a: PlanLimit, b: PlanLimit) =>
  a.usedPercent === b.usedPercent &&
  a.status === b.status &&
  a.resetsAt === b.resetsAt &&
  a.windowMinutes === b.windowMinutes &&
  a.plan === b.plan;

/** `limits` merged into `known`, newest wins; returns the ones worth sending on. */
export const mergeLimits = (
  known: Map<string, PlanLimit>,
  limits: ReadonlyArray<PlanLimit>
): ReadonlyArray<PlanLimit> => {
  const changed: Array<PlanLimit> = [];

  for (const limit of limits) {
    const key = keyOf(limit);
    const previous = known.get(key);
    const at = Date.parse(limit.observedAt);

    if (previous !== undefined) {
      const before = Date.parse(previous.observedAt);

      if (at < before) continue;

      if (sameValue(previous, limit) && at - before < REANNOUNCE_AFTER_MS) continue;
    }

    known.set(key, limit);
    changed.push(limit);
  }

  return changed;
};
