/**
 * Harness availability on this Host, cached: probed on the first ask, again
 * only when a Client asks to refresh. No timers, so an idle Daemon stays idle.
 * A probe that fails or whose callers all left is never cached.
 */
import { HARNESS_CATALOGUE, HarnessAvailability, HostHarnesses } from "@polaris/protocol";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Layer,
  Predicate,
  Stream,
  SubscriptionRef,
} from "effect";
import { isBenchKind } from "../bench/kinds.ts";
import { type ProbeEnv, probeHarness } from "./probe.ts";

export class Availability extends Context.Service<
  Availability,
  {
    /** The cached report; `refresh` probes every Harness again first. */
    readonly get: (refresh: boolean) => Effect.Effect<HostHarnesses>;
    /** The current report (probing if there is none yet), then each new one. */
    readonly changes: Stream.Stream<HostHarnesses>;
  }
>()("polaris/daemon/harness/Availability") {
  static readonly layer = (options: AvailabilityOptions = {}) =>
    Layer.effect(Availability, makeAvailability(options));
}

export interface AvailabilityOptions {
  /** Defaults to the Daemon's environment. */
  readonly env?: ProbeEnv;
  /**
   * Benchmarks: Claude Code and Codex are the scripted bench Harness, ready; the
   * others are probed as usual. Defaults to `POLARIS_BENCH_HARNESS=1`.
   */
  readonly bench?: boolean;
}

const benchReady = (entry: (typeof HARNESS_CATALOGUE)[number]) =>
  Effect.succeed(
    new HarnessAvailability({
      harness: entry.kind,
      status: "ready",
      version: "bench",
      minVersion: entry.minVersion,
      olderThanTested: null,
      detail: null,
      signInArgv: null,
    })
  );

const makeAvailability = Effect.fnUntraced(function* (options: AvailabilityOptions) {
  const env = options.env ?? process.env;
  const bench = options.bench ?? env.POLARIS_BENCH_HARNESS === "1";
  const latest = yield* SubscriptionRef.make<HostHarnesses | null>(null);

  const probeAll = Effect.gen(function* () {
    const harnesses = yield* Effect.forEach(
      HARNESS_CATALOGUE,
      (entry) => (bench && isBenchKind(entry.kind) ? benchReady(entry) : probeHarness(entry, env)),
      { concurrency: "unbounded" }
    );

    const report = new HostHarnesses({
      harnesses,
      checkedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
    });

    yield* SubscriptionRef.set(latest, report);

    return report;
  });

  // One probe at a time, run in the layer's scope: a caller that goes away (a
  // Client unsubscribing mid-probe) never stops it, and only a report is kept.
  const scope = yield* Effect.scope;
  let inFlight: Deferred.Deferred<HostHarnesses> | null = null;

  const probe = Effect.suspend(() => {
    if (inFlight !== null) return Deferred.await(inFlight);
    const done = Deferred.makeUnsafe<HostHarnesses>();
    inFlight = done;

    return Effect.forkIn(
      probeAll.pipe(
        Effect.exit,
        Effect.flatMap((exit) =>
          Effect.suspend(() => {
            inFlight = null;

            return Deferred.done(done, exit);
          })
        )
      ),
      scope
    ).pipe(Effect.andThen(Deferred.await(done)));
  });

  const current = Effect.suspend(() => {
    const report = SubscriptionRef.getUnsafe(latest);

    return report === null ? probe : Effect.succeed(report);
  });

  // A refresh wants a probe that started after it: one already running may predate a sign-in.
  const fresh = Effect.suspend(() =>
    inFlight === null ? probe : Deferred.await(inFlight).pipe(Effect.exit, Effect.andThen(probe))
  );

  return Availability.of({
    get: (refresh) => (refresh ? fresh : current),
    changes: Stream.unwrap(
      Effect.as(current, SubscriptionRef.changes(latest).pipe(Stream.filter(Predicate.isNotNull)))
    ),
  });
});
