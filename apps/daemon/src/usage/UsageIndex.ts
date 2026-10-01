/**
 * The Usage index service: incremental passes over the Harness logs, run on
 * in the background, in bounded steps, when a Client asks (`usage.query`,
 * `usage.watch`), after each Turn, and on log changes while a Client watches.
 * Nothing runs on a timer when idle.
 */
import { type FSWatcher, watch } from "node:fs";
import { join } from "node:path";
import {
  type HarnessKind,
  PlanLimit,
  type SessionId,
  UsageReport,
  UsageStreamItem,
} from "@polaris/protocol";
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Layer,
  Option,
  PubSub,
  Queue,
  Schema,
  Stream,
} from "effect";
import { paths } from "../paths.ts";
import { PlanLimitSink } from "../services.ts";
import {
  historyKey,
  type LimitHistory,
  limitHistory,
  RETAIN_MS,
  weeklyPerSession,
} from "./limitHistory.ts";
import { claudeRoots } from "./claude.ts";
import { openUsageDb } from "./db.ts";
import { codexHome, type Env, GC_EVERY_BYTES, type UsageHarness } from "./indexer.ts";
import { passScheduler } from "./passes.ts";
import { queryBuckets } from "./query.ts";
import { SessionActivity, UsageSessions } from "./sessions.ts";
import { inProcessRunner } from "./runner.ts";
import { writerOver } from "./writer.ts";

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
    /** Answers from the index, once a pass it starts has finished or ~250 ms have passed. */
    readonly query: (query: UsageQuery) => Effect.Effect<UsageReport>;
    /** Every known Plan Limit, then Usage and Plan Limit changes; watches the logs while subscribed. */
    readonly changes: Stream.Stream<UsageStreamItem>;
    /** The latest value of every Plan Limit window known (the Reviewer's near-limit note). */
    readonly planLimits: Effect.Effect<ReadonlyArray<PlanLimit>>;
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
  /** How long `usage.query` waits for its pass before answering from what is indexed. */
  readonly answerWithinMs?: number;
  /**
   * Last known Plan Limits from the Harnesses' own logs (ENG-206), read on a
   * new `usage.watch` (at most every `seedEveryMs`) and after a pass over that
   * Harness's logs; they never replace a newer value.
   */
  readonly planLimitSeed?: Effect.Effect<ReadonlyArray<PlanLimit>>;
  /** How long a seed read stands before a new watch reads the logs again. */
  readonly seedEveryMs?: number;
}

/** A Harness used outside Polaris moves its limits; a watch opened later reads them again. */
const SEED_EVERY_MS = 60_000;

/** Long enough for an incremental pass; a first pass over gigabytes answers with `indexing`. */
const ANSWER_WITHIN_MS = 250;

const planLimitKey = (limit: PlanLimit) =>
  `${limit.harness}\u0000${limit.kind}\u0000${limit.scope ?? ""}`;

const PlanLimitJson = Schema.fromJsonString(PlanLimit);

const decodePlanLimit = Schema.decodeUnknownOption(PlanLimitJson);

const encodePlanLimit = Schema.encodeSync(PlanLimitJson);

const isUsageHarness = (harness: string): harness is UsageHarness =>
  HARNESSES.some((known) => known === harness);

export const makeUsageIndex = Effect.fnUntraced(function* (options: UsageIndexOptions = {}) {
  const sessions = yield* UsageSessions;
  const env = options.env ?? process.env;
  const settleMs = options.settleMs ?? 1_000;
  const answerWithinMs = options.answerWithinMs ?? ANSWER_WITHIN_MS;
  const pubsub = yield* PubSub.unbounded<UsageStreamItem>();
  const wakeups = yield* Queue.unbounded<UsageHarness>();
  const dbPath = options.dbPath ?? join(paths().root, "usage.sqlite");
  // Set once this Daemon has run a pass: before that, a Turn's end doesn't start one.
  let used = false;

  // Opened on first use: an idle Daemon never touches the index.
  const opened = yield* Effect.cached(
    Effect.sync(() => {
      const db = openUsageDb(dbPath);

      return { db, writer: writerOver(db), history: limitHistory(db) };
    })
  );

  const indexedAt = Effect.map(opened, ({ writer }) => writer.meta("indexedAt"));

  const passes = yield* passScheduler({
    runner: Effect.map(opened, ({ db, writer }) =>
      inProcessRunner({ db, writer, env, gcEveryBytes: options.gcEveryBytes ?? GC_EVERY_BYTES })
    ),
    publish: (item) => PubSub.publishUnsafe(pubsub, item),
    indexedAt,
    // A new index backfills every cursor from the event store once; later, current ones suffice.
    links: Effect.gen(function* () {
      const { writer } = yield* opened;
      const backfilled = writer.meta("links") !== null;

      return {
        links: yield* backfilled ? sessions.current : sessions.history,
        backfill: !backfilled,
      };
    }),
  });

  const request = (harnesses: ReadonlyArray<UsageHarness>) =>
    Effect.gen(function* () {
      yield* opened;
      used = true;
      syncWatchers();

      return yield* passes.request(harnesses);
    });

  const refresh = (harnesses: ReadonlyArray<UsageHarness> = HARNESSES) =>
    Effect.flatMap(request(harnesses), Deferred.await);

  const query = Effect.fn("usage.query")(function* (q: UsageQuery) {
    const done = yield* request(
      q.harness === null ? HARNESSES : HARNESSES.filter((h) => h === q.harness)
    );

    // A quick pass finishes first; a long one (the first over big logs) goes on in the background.
    yield* Deferred.await(done).pipe(Effect.timeoutOption(answerWithinMs));
    const { db, writer } = yield* opened;

    return new UsageReport({
      buckets: queryBuckets(db, {
        from: Date.parse(q.from),
        to: Date.parse(q.to),
        harness: q.harness,
        sessionId: q.sessionId,
      }),
      indexedAt: writer.meta("indexedAt"),
      indexing: passes.isRunning(),
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

  /** The whole-plan weekly window carries how much of it a 5-hour window uses (the forecast's estimate). */
  const withSessionBurn = (limit: PlanLimit, history: LimitHistory): PlanLimit => {
    if (limit.kind !== "weekly" || limit.scope !== null) return limit;
    const now = Date.parse(limit.observedAt);
    const since = now - RETAIN_MS;

    const fiveHour = history.readings(
      historyKey({ harness: limit.harness, kind: "five-hour", scope: null }),
      since
    );

    const weekly = history.readings(historyKey(limit), since);

    return new PlanLimit({
      harness: limit.harness,
      kind: limit.kind,
      scope: limit.scope,
      windowMinutes: limit.windowMinutes,
      usedPercent: limit.usedPercent,
      status: limit.status,
      resetsAt: limit.resetsAt,
      observedAt: limit.observedAt,
      plan: limit.plan,
      weeklyPerSession: weeklyPerSession(fiveHour, weekly, now),
    });
  };

  const reportPlanLimit = Effect.fn("usage.planLimit")(function* (reported: PlanLimit) {
    const { writer, history } = yield* opened;
    yield* loadedLimits;
    history.record(reported);
    const limit = withSessionBurn(reported, history);
    limits.set(planLimitKey(limit), limit);
    writer.putPlanLimit(planLimitKey(limit), encodePlanLimit(limit));
    yield* PubSub.publish(pubsub, UsageStreamItem.cases.PlanLimitChanged.make({ limit }));
  });

  const seedEveryMs = options.seedEveryMs ?? SEED_EVERY_MS;
  let seededAt = Number.NEGATIVE_INFINITY;

  // `fresh`: read again even if the last read is recent (the logs just changed).
  const seedLimits = (fresh: boolean) =>
    Effect.gen(function* () {
      yield* loadedLimits;
      const now = yield* Clock.currentTimeMillis;

      if (options.planLimitSeed === undefined || (!fresh && now - seededAt < seedEveryMs)) return;
      seededAt = now;

      for (const limit of yield* options.planLimitSeed) {
        const known = limits.get(planLimitKey(limit));

        if (known === undefined || known.observedAt < limit.observedAt)
          yield* reportPlanLimit(limit);
      }
    });

  // Watching: fs.watch on the log roots while a Client is subscribed and the index
  // is in use. A watch for Plan Limits alone (the Desktop's Harness menu) costs nothing.
  let watchers: Array<FSWatcher> = [];
  let subscribers = 0;

  const roots = (): Array<[UsageHarness, string]> => [
    ...claudeRoots(env, env.HOME ?? "").map((root): [UsageHarness, string] => ["claude", root]),
    ["codex", join(codexHome(env), "sessions")],
    ["codex", join(codexHome(env), "archived_sessions")],
  ];

  const syncWatchers = () => {
    const wanted = subscribers > 0 && used;

    if (wanted && watchers.length === 0) {
      watchers = roots().flatMap(([harness, root]) => {
        try {
          const watcher = watch(root, { recursive: true }, () =>
            Queue.offerUnsafe(wakeups, harness)
          );

          // Unhandled, a watcher's error event (a socket it can't open) kills the Daemon.
          watcher.on("error", () => undefined);

          return [watcher];
        } catch {
          return [];
        }
      });
    }

    if (!wanted) {
      for (const watcher of watchers) watcher.close();
      watchers = [];
    }
  };

  const startWatching = Effect.sync(() => {
    subscribers++;
    syncWatchers();
  });

  const stopWatching = Effect.sync(() => {
    subscribers--;
    syncWatchers();
  });

  const changes = Stream.unwrap(
    Effect.gen(function* () {
      yield* Effect.acquireRelease(startWatching, () => stopWatching);
      // Seeded before subscribing, so seeded values come once, with the known ones.
      yield* seedLimits(false);
      const subscription = yield* PubSub.subscribe(pubsub);

      const known = [...limits.values()].map((limit) =>
        UsageStreamItem.cases.PlanLimitChanged.make({ limit })
      );

      // Catch up in the background, once the index is in use (a Client queried it).
      if (used) yield* request(HARNESSES);

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

    if (harnesses.includes("codex")) yield* seedLimits(true);
  });

  yield* Effect.forkScoped(Effect.forever(settle));

  // After each Turn, and to link new cursors. Only once this Daemon has used the index.
  const follow = Stream.runForEach(sessions.activity, (activity) =>
    used
      ? SessionActivity.$match(activity, {
          TurnEnded: ({ harness }) =>
            Effect.sync(() => {
              if (isUsageHarness(harness)) Queue.offerUnsafe(wakeups, harness);
            }),
          Linked: ({ link: next }) => passes.link([next]),
        })
      : Effect.void
  );

  yield* Effect.forkScoped(Effect.forever(follow));

  const planLimits = Effect.sync(() => [...limits.values()]);
  const service = UsageIndex.of({ refresh, query, changes, planLimits });

  return { service, planLimits: PlanLimitSink.of({ report: reportPlanLimit }) };
});

export const UsageIndexLive = (options: UsageIndexOptions = {}) =>
  Layer.effectContext(
    Effect.map(makeUsageIndex(options), ({ service, planLimits }) =>
      Context.make(UsageIndex, service).pipe(Context.add(PlanLimitSink, planLimits))
    )
  );
