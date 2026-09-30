/**
 * The Usage index service: an incremental pass over the Harness logs, run
 * when a Client asks (`usage.query`), after each Turn, and on log changes
 * while a Client watches (`usage.watch`). Nothing runs on a timer when idle.
 */
import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import {
  type HarnessKind,
  PlanLimit,
  type SessionId,
  type UsageBucket,
  UsageReport,
  UsageStreamItem,
} from "@polaris/protocol";
import {
  Clock,
  Context,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { paths } from "../paths.ts";
import { PlanLimitSink } from "../services.ts";
import { openUsageDb, type UsageDb } from "./db.ts";
import { claudeRoots } from "./claude.ts";
import {
  codexHome,
  discoverLogs,
  type Env,
  GC_EVERY_BYTES,
  indexLogs,
  type UsageHarness,
} from "./indexer.ts";
import { bucketsInHours, queryBuckets, zeroBucket } from "./query.ts";
import { SessionActivity, type SessionLink, UsageSessions } from "./sessions.ts";
import { writerOver, type UsageWriter, type Vacated } from "./writer.ts";

const HARNESSES: ReadonlyArray<UsageHarness> = ["claude", "codex"];

export interface UsageQuery {
  readonly from: string;
  readonly to: string;
  readonly harness: HarnessKind | null;
  readonly sessionId: SessionId | null;
}

export class UsageIndex extends Context.Service<
  UsageIndex,
  {
    /** Brings the index up to date with the logs (only what was appended since the last pass). */
    readonly refresh: (harnesses?: ReadonlyArray<UsageHarness>) => Effect.Effect<void>;
    /** Refreshes, then answers from the index. */
    readonly query: (query: UsageQuery) => Effect.Effect<UsageReport>;
    /** Every known Plan Limit, then Usage and Plan Limit changes; watches the logs while subscribed. */
    readonly changes: Stream.Stream<UsageStreamItem>;
  }
>()("polaris/daemon/usage/UsageIndex") {}

export interface UsageIndexOptions {
  /** Where the logs are found (`HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`); the Daemon's by default. */
  readonly env?: Env;
  /** Defaults to `~/.polaris/usage.sqlite`. */
  readonly dbPath?: string;
  /** Collect garbage after this many log bytes read, so a first build stays small (Pi 4). */
  readonly gcEveryBytes?: number;
  /** How long log changes settle before a pass, while watched. */
  readonly settleMs?: number;
  /**
   * Last known Plan Limits from the Harnesses' own logs (ENG-206), read once
   * on the first `usage.watch`; they never replace a newer value.
   */
  readonly planLimitSeed?: Effect.Effect<ReadonlyArray<PlanLimit>>;
}

const planLimitKey = (limit: PlanLimit) =>
  `${limit.harness}\u0000${limit.kind}\u0000${limit.scope ?? ""}`;

const PlanLimitJson = Schema.fromJsonString(PlanLimit);

const decodePlanLimit = Schema.decodeUnknownOption(PlanLimitJson);

const encodePlanLimit = Schema.encodeSync(PlanLimitJson);

const isUsageHarness = (harness: string): harness is UsageHarness =>
  HARNESSES.some((known) => known === harness);

/** The buckets a pass touched, plus a zero bucket for any it emptied (a replaced response moved). */
const changedBuckets = (db: UsageDb, writer: UsageWriter): Array<UsageBucket> => {
  const hours = new Map<string, Set<number>>();
  const keys: Array<{ hour: number; harness: string; model: string; native: string }> = [];

  for (const key of writer.touched) {
    const [hour, harness, model, native] = key.split("\u0000");

    if (hour === undefined || harness === undefined || model === undefined || native === undefined)
      continue;
    keys.push({ hour: Number(hour), harness, model, native });
    hours.set(harness, (hours.get(harness) ?? new Set()).add(Number(hour)));
  }

  const buckets = [...hours].flatMap(([harness, set]) => bucketsInHours(db, harness, [...set]));

  const id = (hour: string, harness: string, model: string, session: string | null) =>
    `${hour}\u0000${harness}\u0000${model}\u0000${session ?? ""}`;

  const present = new Set(buckets.map((b) => id(b.hour, b.harness, b.model, b.sessionId)));

  const candidates: Array<Vacated> = [
    ...keys.map((key) => ({ ...key, sessionId: writer.sessionOf(key.harness, key.native) })),
    ...writer.vacated,
  ];

  for (const key of candidates) {
    const hour = new Date(key.hour).toISOString();

    if (present.has(id(hour, key.harness, key.model, key.sessionId))) continue;
    present.add(id(hour, key.harness, key.model, key.sessionId));
    buckets.push(zeroBucket(key));
  }

  return buckets;
};

export const makeUsageIndex = Effect.fnUntraced(function* (options: UsageIndexOptions = {}) {
  const sessions = yield* UsageSessions;
  const env = options.env ?? process.env;
  const gcEveryBytes = options.gcEveryBytes ?? GC_EVERY_BYTES;
  const settleMs = options.settleMs ?? 1_000;
  const lock = yield* Semaphore.make(1);
  const pubsub = yield* PubSub.unbounded<UsageStreamItem>();
  const wakeups = yield* Queue.unbounded<UsageHarness>();
  let indexedAt: string | null = null;

  // Opened on first use: an idle Daemon never touches the index.
  const opened = yield* Effect.cached(
    Effect.sync(() => {
      const db = openUsageDb(options.dbPath ?? join(paths().root, "usage.sqlite"));

      return { db, writer: writerOver(db) };
    })
  );

  const link = (writer: UsageWriter, links: ReadonlyArray<SessionLink>) =>
    writer.transaction(() => {
      for (const { harness, native, sessionId } of links) writer.link(harness, native, sessionId);
    });

  const syncLinks = Effect.fnUntraced(function* (writer: UsageWriter) {
    // A new index backfills every cursor from the event store once; later, current ones suffice.
    const backfilled = writer.meta("links") !== null;
    link(writer, yield* backfilled ? sessions.current : sessions.history);

    if (!backfilled) writer.putMeta("links", "1");
  });

  const publishChanges = Effect.fnUntraced(function* (
    db: UsageDb,
    writer: UsageWriter,
    at: string
  ) {
    if (writer.touched.size === 0 && writer.vacated.length === 0) return;
    const buckets = changedBuckets(db, writer);
    writer.touched.clear();
    writer.vacated.length = 0;
    yield* PubSub.publish(
      pubsub,
      UsageStreamItem.cases.UsageChanged.make({ buckets, indexedAt: at })
    );
  });

  const pass = (harnesses: ReadonlyArray<UsageHarness>) =>
    Semaphore.withPermit(
      lock,
      Effect.gen(function* () {
        const { db, writer } = yield* opened;
        yield* syncLinks(writer);
        yield* Effect.promise(() => indexLogs(writer, discoverLogs(env, harnesses), gcEveryBytes));
        indexedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
        yield* publishChanges(db, writer, indexedAt);
      })
    ).pipe(Effect.withSpan("usage.pass"));

  const refresh = (harnesses: ReadonlyArray<UsageHarness> = HARNESSES) => pass(harnesses);

  const query = Effect.fn("usage.query")(function* (q: UsageQuery) {
    yield* refresh(q.harness === null ? HARNESSES : HARNESSES.filter((h) => h === q.harness));
    const { db } = yield* opened;

    return new UsageReport({
      buckets: queryBuckets(db, {
        from: Date.parse(q.from),
        to: Date.parse(q.to),
        harness: q.harness,
        sessionId: q.sessionId,
      }),
      indexedAt,
    });
  });

  // Plan Limits (ENG-206): the drivers report them here; the last value of each survives restarts.
  const limits = new Map<string, PlanLimit>();

  const loadedLimits = yield* Effect.cached(
    Effect.map(opened, ({ writer }) => {
      for (const text of writer.planLimits()) {
        const limit = decodePlanLimit(text);

        if (Option.isSome(limit) && !limits.has(planLimitKey(limit.value)))
          limits.set(planLimitKey(limit.value), limit.value);
      }
    })
  );

  const reportPlanLimit = Effect.fn("usage.planLimit")(function* (limit: PlanLimit) {
    const { writer } = yield* opened;
    yield* loadedLimits;
    limits.set(planLimitKey(limit), limit);
    writer.putPlanLimit(planLimitKey(limit), encodePlanLimit(limit));
    yield* PubSub.publish(pubsub, UsageStreamItem.cases.PlanLimitChanged.make({ limit }));
  });

  const seededLimits = yield* Effect.cached(
    Effect.gen(function* () {
      yield* loadedLimits;

      for (const limit of options.planLimitSeed === undefined ? [] : yield* options.planLimitSeed) {
        const known = limits.get(planLimitKey(limit));

        if (known === undefined || known.observedAt < limit.observedAt)
          yield* reportPlanLimit(limit);
      }
    })
  );

  // Watching: fs.watch on the log roots while at least one Client is subscribed.
  let watchers: Array<FSWatcher> = [];
  let subscribers = 0;

  const roots = (): Array<[UsageHarness, string]> => [
    ...claudeRoots(env, env.HOME ?? "").map((root): [UsageHarness, string] => ["claude", root]),
    ["codex", join(codexHome(env), "sessions")],
    ["codex", join(codexHome(env), "archived_sessions")],
  ];

  const startWatching = Effect.sync(() => {
    if (subscribers++ > 0) return;
    watchers = roots().flatMap(([harness, root]) => {
      try {
        return [watch(root, { recursive: true }, () => Queue.offerUnsafe(wakeups, harness))];
      } catch {
        return [];
      }
    });
  });

  const stopWatching = Effect.sync(() => {
    if (--subscribers > 0) return;

    for (const watcher of watchers) watcher.close();
    watchers = [];
  });

  const changes = Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(startWatching, () => stopWatching);
      // Seeded before subscribing, so seeded values come once, with the known ones.
      yield* seededLimits;
      const subscription = yield* PubSub.subscribe(pubsub);

      const known = [...limits.values()].map((limit) =>
        UsageStreamItem.cases.PlanLimitChanged.make({ limit })
      );

      // Catch up now, so the watcher starts from an index that matches the logs.
      yield* Effect.forkScoped(refresh());

      return Stream.concat(Stream.fromIterable(known), Stream.fromSubscription(subscription));
    })
  );

  // Log changes (while watched) and Turn ends wake a pass, once they settle.
  const settle = Effect.gen(function* () {
    const first = yield* Queue.take(wakeups);
    yield* Effect.sleep(settleMs);
    const rest = yield* Queue.clear(wakeups);
    const harnesses = HARNESSES.filter((h) => h === first || rest.includes(h));
    yield* refresh(harnesses);
  });

  yield* Effect.forkScoped(Effect.forever(settle));

  // After each Turn, and to link new cursors. Only once the index exists: a Turn never builds it.
  const follow = Stream.runForEach(sessions.activity, (activity) =>
    indexedAt === null
      ? Effect.void
      : SessionActivity.$match(activity, {
          TurnEnded: ({ harness }) =>
            Effect.sync(() => {
              if (isUsageHarness(harness)) Queue.offerUnsafe(wakeups, harness);
            }),
          Linked: ({ link: next }) =>
            Effect.gen(function* () {
              const { db, writer } = yield* opened;
              link(writer, [next]);
              yield* publishChanges(db, writer, indexedAt ?? "");
            }),
        })
  );

  yield* Effect.forkScoped(Effect.forever(follow));

  const service = UsageIndex.of({ refresh, query, changes });

  return { service, planLimits: PlanLimitSink.of({ report: reportPlanLimit }) };
});

export const UsageIndexLive = (options: UsageIndexOptions = {}) =>
  Layer.effectContext(
    Effect.map(makeUsageIndex(options), ({ service, planLimits }) =>
      Context.make(UsageIndex, service).pipe(Context.add(PlanLimitSink, planLimits))
    )
  );
