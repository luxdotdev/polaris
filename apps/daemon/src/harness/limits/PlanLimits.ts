/**
 * The last known value of every Plan Limit on this Host, and its changes.
 * Drivers report what their Harness exposed (ADR 0001); nothing here polls:
 * values arrive with Agent Sessions, and persist so a restarted Daemon still
 * knows them (Clients show their age).
 */
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PlanLimit } from "@polaris/protocol";
import { Context, Effect, Layer, PubSub, Schema, Stream } from "effect";
import { polarisHome } from "../../paths.ts";

/** Where drivers hand what their Harness reported. Synchronous: SDK callbacks call it. */
export interface PlanLimitSink {
  readonly report: (limits: ReadonlyArray<PlanLimit>) => void;
}

export class PlanLimits extends Context.Service<
  PlanLimits,
  PlanLimitSink & {
    /** Every Plan Limit known, seeded from the Harness logs on the first ask. */
    readonly current: Effect.Effect<ReadonlyArray<PlanLimit>>;
    /** Every known Plan Limit, then each one as it changes. */
    readonly changes: Stream.Stream<PlanLimit>;
  }
>()("polaris/daemon/harness/PlanLimits") {
  static readonly layer = (options: PlanLimitsOptions = {}) =>
    Layer.effect(PlanLimits, makePlanLimits(options));
}

export interface PlanLimitsOptions {
  /** The persisted values; default `~/.polaris/plan-limits.json`, null to keep them in memory. */
  readonly file?: string | null;
  /** Read once, on the first ask: last known values from the Harnesses' own logs. */
  readonly seed?: Effect.Effect<ReadonlyArray<PlanLimit>>;
}

/** A value that only confirms the last one is re-announced at most this often (ms). */
export const REANNOUNCE_AFTER_MS = 60_000;

const PersistedLimits = Schema.fromJsonString(Schema.Struct({ limits: Schema.Array(PlanLimit) }));

const keyOf = (limit: PlanLimit) => JSON.stringify([limit.harness, limit.kind, limit.scope]);

const sameValue = (a: PlanLimit, b: PlanLimit) =>
  a.usedPercent === b.usedPercent &&
  a.status === b.status &&
  a.resetsAt === b.resetsAt &&
  a.windowMinutes === b.windowMinutes &&
  a.plan === b.plan;

const readPersisted = (file: string | null): ReadonlyArray<PlanLimit> => {
  if (file === null) return [];

  try {
    return Schema.decodeUnknownSync(PersistedLimits)(readFileSync(file, "utf8")).limits;
  } catch {
    return [];
  }
};

/** `limits` merged into `known`, newest wins; returns the ones Clients should hear about. */
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
      known.set(key, limit);

      if (sameValue(previous, limit) && at - before < REANNOUNCE_AFTER_MS) continue;
    } else {
      known.set(key, limit);
    }

    changed.push(limit);
  }

  return changed;
};

const makePlanLimits = Effect.fnUntraced(function* (options: PlanLimitsOptions) {
  const file = options.file === undefined ? join(polarisHome(), "plan-limits.json") : options.file;
  const known = new Map<string, PlanLimit>();
  mergeLimits(known, readPersisted(file));
  const hub = yield* PubSub.unbounded<PlanLimit>();
  let writing: Promise<void> = Promise.resolve();

  const persist = () => {
    if (file === null) return;
    const json = Schema.encodeSync(PersistedLimits)({ limits: [...known.values()] });
    const temp = `${file}.tmp`;

    // Serialized, and renamed into place so a crash never leaves half a file.
    writing = writing
      .then(async () => {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(temp, json, { mode: 0o600 });
        await rename(temp, file);
      })
      .catch(() => {});
  };

  const report = (limits: ReadonlyArray<PlanLimit>) => {
    const changed = mergeLimits(known, limits);

    if (changed.length === 0) return;

    persist();

    for (const limit of changed) PubSub.publishUnsafe(hub, limit);
  };

  const seeded = yield* Effect.cached(
    options.seed === undefined
      ? Effect.void
      : options.seed.pipe(Effect.flatMap((limits) => Effect.sync(() => report(limits))))
  );

  const current = Effect.andThen(
    seeded,
    Effect.sync(() => [...known.values()])
  );

  // Seed first (its values belong in the snapshot), then subscribe before reading the
  // snapshot, so nothing reported in between is missed.
  const changes = Stream.unwrap(
    Effect.gen(function* () {
      yield* seeded;
      const subscription = yield* PubSub.subscribe(hub);
      const snapshot = [...known.values()];

      return Stream.concat(Stream.fromIterable(snapshot), Stream.fromSubscription(subscription));
    })
  );

  return PlanLimits.of({ report, current, changes });
});
