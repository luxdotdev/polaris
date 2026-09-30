/**
 * Index passes, run in the background. Requests coalesce:
 * while a pass runs, every new request joins the next one. A pass that takes
 * a while is announced to `usage.watch` as `indexing`, and its end tells
 * watchers to query again; a short one sends the buckets it changed.
 */
import type { UsageBucket } from "@polaris/protocol";
import { UsageStreamItem } from "@polaris/protocol";
import { Clock, Deferred, Effect, Fiber, Option } from "effect";
import type { UsageHarness } from "./indexer.ts";
import type { SessionLink } from "./sessions.ts";
import type { IndexRunner } from "./runner.ts";

/** A pass still running after this is announced to watchers as indexing. */
const ANNOUNCE_AFTER_MS = 300;

export interface PassesOptions {
  /** Built on the first pass: an idle Daemon never opens the index. */
  readonly runner: Effect.Effect<IndexRunner>;
  readonly publish: (item: UsageStreamItem) => void;
  /** The links a pass starts with: every cursor ever for a new index, else the current ones. */
  readonly links: Effect.Effect<{ links: ReadonlyArray<SessionLink>; backfill: boolean }>;
  /** When the index last caught up, if ever. */
  readonly indexedAt: Effect.Effect<string | null>;
}

export const passScheduler = Effect.fnUntraced(function* (options: PassesOptions) {
  const scope = yield* Effect.scope;
  const pending = new Set<UsageHarness>();
  let next: Deferred.Deferred<void> | null = null;
  let looping = false;
  let running = false;

  const now = Effect.map(Clock.currentTimeMillis, (ms) => new Date(ms).toISOString());

  const changed = (buckets: ReadonlyArray<UsageBucket>, indexedAt: string, indexing: boolean) =>
    options.publish(UsageStreamItem.cases.UsageChanged.make({ buckets, indexedAt, indexing }));

  const runPass = Effect.fnUntraced(function* (harnesses: ReadonlyArray<UsageHarness>) {
    const runner = yield* options.runner;
    const { links, backfill } = yield* options.links;
    const before = (yield* options.indexedAt) ?? (yield* now);
    let announced = false;

    const announce = yield* Effect.forkIn(
      Effect.sleep(ANNOUNCE_AFTER_MS).pipe(
        Effect.andThen(
          Effect.sync(() => {
            announced = true;
            changed([], before, true);
          })
        )
      ),
      scope
    );

    const result = yield* Effect.tryPromise(() =>
      runner.run({ op: "pass", harnesses, links, backfill })
    ).pipe(
      Effect.tapError((error) => Effect.logWarning("Usage index pass failed", error)),
      Effect.option
    );

    yield* Fiber.interrupt(announce);

    const indexedAt = Option.flatMapNullishOr(result, (r) => r).pipe(
      Option.getOrElse(() => before)
    );

    // A long pass touched too much to send bucket by bucket: its watchers query again.
    if (announced) {
      runner.dropChanges();
      changed([], indexedAt, false);

      return;
    }

    const buckets = runner.takeChanges();

    if (buckets.length > 0) changed(buckets, indexedAt, false);
  });

  const loop = Effect.gen(function* () {
    while (pending.size > 0 && next !== null) {
      const harnesses = [...pending];
      const done = next;
      pending.clear();
      next = null;
      running = true;
      yield* runPass(harnesses).pipe(Effect.withSpan("usage.pass"));
      running = false;
      yield* Deferred.succeed(done, undefined);
    }

    looping = false;
  });

  /** Asks for a pass over `harnesses`; the Deferred completes when a pass that includes them has. */
  const request = (harnesses: ReadonlyArray<UsageHarness>) =>
    Effect.gen(function* () {
      for (const harness of harnesses) pending.add(harness);
      next ??= yield* Deferred.make<void>();
      const done = next;

      if (!looping) {
        looping = true;
        yield* Effect.forkIn(loop, scope);
      }

      return done;
    });

  /** Links cursors now, and sends the buckets that moved. */
  const link = (links: ReadonlyArray<SessionLink>) =>
    Effect.gen(function* () {
      const runner = yield* options.runner;

      const done = yield* Effect.tryPromise(() => runner.run({ op: "link", links })).pipe(
        Effect.option
      );

      // A pass in flight sends these with its own changes.
      if (Option.isNone(done) || running) return;
      const buckets = runner.takeChanges();

      if (buckets.length > 0) changed(buckets, (yield* options.indexedAt) ?? (yield* now), false);
    });

  return { request, link, isRunning: () => running };
});
