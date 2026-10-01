import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PlanLimit, SessionId, UsageStreamItem } from "@polaris/protocol";
import { Deferred, Effect, Fiber, Layer, Queue, Schema, type Scope, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { PlanLimitSink } from "../services.ts";
import { SessionActivity, type SessionLink, UsageSessions } from "./sessions.ts";
import { claudeLine, type FixtureHost, fixtureHost } from "./testing.ts";
import { UsageIndexLive, type UsageIndexOptions } from "./UsageIndex.ts";
import { UsageRpcs, UsageRpcsLive } from "./UsageRpcs.ts";

const hosts: Array<FixtureHost> = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.cleanup();
});

const session = SessionId.make("session-1");

/** Agent Sessions the test controls: links known up front, and activity it pushes. */
const fakeSessions = (links: ReadonlyArray<SessionLink>, activity: Queue.Queue<SessionActivity>) =>
  Layer.succeed(
    UsageSessions,
    UsageSessions.of({
      current: Effect.succeed(links),
      history: Effect.succeed(links),
      activity: Stream.fromQueue(activity),
    })
  );

const layerFor = (
  host: FixtureHost,
  dbPath: string,
  links: ReadonlyArray<SessionLink>,
  activity: Queue.Queue<SessionActivity>,
  options: UsageIndexOptions = {}
) =>
  UsageRpcsLive.pipe(
    Layer.provideMerge(UsageIndexLive({ env: host.env, dbPath, settleMs: 10, ...options })),
    Layer.provide(fakeSessions(links, activity))
  );

type Services = Layer.Success<ReturnType<typeof layerFor>> | Scope.Scope;

const setup = (links: ReadonlyArray<SessionLink> = [], options: UsageIndexOptions = {}) => {
  const host = fixtureHost();
  hosts.push(host);
  const dbPath = join(host.root, "usage.sqlite");
  const transcript = (name: string) => join(host.claudeProjects, "-code-app", `${name}.jsonl`);

  const run = <A, E>(
    body: (activity: Queue.Queue<SessionActivity>) => Effect.Effect<A, E, Services>
  ) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const activity = yield* Queue.unbounded<SessionActivity>();

          return yield* body(activity).pipe(
            Effect.provide(layerFor(host, dbPath, links, activity, options))
          );
        })
      )
    );

  return { host, dbPath, transcript, run };
};

const day = {
  from: "2026-09-01T00:00:00Z",
  to: "2026-09-02T00:00:00Z",
  harness: null,
  sessionId: null,
};

const limitWith = (usedPercent: number, overrides: Partial<PlanLimit> = {}) =>
  new PlanLimit({
    harness: "claude",
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent,
    status: "ok",
    resetsAt: "2026-09-01T15:00:00Z",
    observedAt: "2026-09-01T10:00:00Z",
    plan: "max",
    ...overrides,
  });

const limit = (usedPercent: number) => limitWith(usedPercent);

const isUsageChanged = Schema.is(UsageStreamItem.cases.UsageChanged);

const isPlanLimitChanged = Schema.is(UsageStreamItem.cases.PlanLimitChanged);

/** Responses in the index file, read beside the Daemon's own connection. */
const rowsIn = (dbPath: string) => {
  const db = new Database(dbPath, { readonly: true });

  try {
    return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM usage").get()?.n ?? 0;
  } finally {
    db.close();
  }
};

describe("UsageIndex", () => {
  test("a weekly reading carries how much of it a 5-hour window uses, from the history", async () => {
    const { run } = setup();
    const hour = 3_600_000;
    const t0 = Date.parse("2026-09-01T00:00:00Z");
    const iso = (ms: number) => new Date(ms).toISOString();
    const weeklyResets = iso(t0 + 7 * 24 * hour);

    const reported = await run(() =>
      Effect.gen(function* () {
        const sink = yield* PlanLimitSink;
        let weekly = 0;

        // Three finished 5-hour windows, each using 10% of the weekly for 50 points of its own.
        for (const start of [0, 6, 12].map((h) => t0 + h * hour)) {
          for (const [at, session, week] of [
            [start + hour, 10, weekly],
            [start + 4 * hour, 60, weekly + 10],
          ] as const) {
            const observedAt = iso(at);
            yield* sink.report(limitWith(session, { resetsAt: iso(start + 5 * hour), observedAt }));
            yield* sink.report(
              limitWith(week, {
                kind: "weekly",
                windowMinutes: 10_080,
                resetsAt: weeklyResets,
                observedAt,
              })
            );
          }

          weekly += 10;
        }

        // Later, once all three have ended, the weekly moves again.
        yield* sink.report(
          limitWith(35, {
            kind: "weekly",
            windowMinutes: 10_080,
            resetsAt: weeklyResets,
            observedAt: iso(t0 + 20 * hour),
          })
        );

        const client = yield* RpcTest.makeClient(UsageRpcs);
        const known = yield* client["usage.watch"]({}).pipe(Stream.take(2), Stream.runCollect);

        return known.flatMap((i) => (isPlanLimitChanged(i) ? [i.limit] : []));
      })
    );

    expect(reported.find((l) => l.kind === "weekly")?.weeklyPerSession).toBeCloseTo(20);
    expect(reported.find((l) => l.kind === "five-hour")?.weeklyPerSession).toBeNull();
  });

  test("opens nothing until a Client asks", async () => {
    const { dbPath, run } = setup();

    await run(() => Effect.void);

    expect(existsSync(dbPath)).toBe(false);
  });

  test("a watch for Plan Limits alone reads no logs; the first query starts indexing", async () => {
    const { host, dbPath, transcript, run } = setup();
    host.append(
      transcript("n"),
      claudeLine({ session: "n", ts: "2026-09-01T10:00:00Z", msg: "a" })
    );

    const indexedBeforeQuery = await run(() =>
      Effect.gen(function* () {
        const sink = yield* PlanLimitSink;
        yield* sink.report(limit(5));
        const client = yield* RpcTest.makeClient(UsageRpcs);
        const first = yield* client["usage.watch"]({}).pipe(Stream.take(1), Stream.runCollect);
        yield* Effect.sleep("300 millis");

        return { first, rows: rowsIn(dbPath) };
      })
    );

    expect(isPlanLimitChanged(indexedBeforeQuery.first[0])).toBe(true);
    expect(indexedBeforeQuery.rows).toBe(0);
  });

  test("usage.query catches up, and splits Usage Polaris drove from the rest", async () => {
    const { host, transcript, run } = setup([
      { harness: "claude", native: "polaris-native", sessionId: session },
    ]);

    host.append(
      transcript("polaris-native"),
      claudeLine({ session: "polaris-native", ts: "2026-09-01T10:10:00Z", msg: "a" })
    );
    host.append(
      transcript("outside"),
      claudeLine({ session: "outside", ts: "2026-09-01T10:20:00Z", msg: "b", output: 50 })
    );

    const report = await run(() =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UsageRpcs);

        return yield* client["usage.query"](day);
      })
    );

    expect(report.indexedAt).not.toBeNull();
    expect(report.buckets.map((b) => [b.hour, b.model, b.sessionId, b.tokens.output])).toEqual([
      ["2026-09-01T10:00:00.000Z", "claude-opus-5-5", null, 50],
      ["2026-09-01T10:00:00.000Z", "claude-opus-5-5", session, 20],
    ]);
  });

  test("filters by hour range, Harness and Agent Session", async () => {
    const { host, transcript, run } = setup([
      { harness: "claude", native: "n1", sessionId: session },
    ]);

    host.append(
      transcript("n1"),
      claudeLine({ session: "n1", ts: "2026-09-01T09:59:00Z", msg: "a" }),
      claudeLine({ session: "n1", ts: "2026-09-01T12:30:00Z", msg: "b" })
    );

    host.append(
      transcript("n2"),
      claudeLine({ session: "n2", ts: "2026-09-01T12:31:00Z", msg: "c" })
    );

    const [ranged, codex, mine] = await run(() =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UsageRpcs);
        const q = client["usage.query"];

        return [
          yield* q({ ...day, from: "2026-09-01T12:15:00Z", to: "2026-09-01T13:00:00Z" }),
          yield* q({ ...day, harness: "codex" }),
          yield* q({ ...day, sessionId: session }),
        ] as const;
      })
    );

    expect(ranged.buckets).toHaveLength(2);
    expect(codex.buckets).toHaveLength(0);
    expect(mine.buckets.map((b) => b.hour)).toEqual([
      "2026-09-01T09:00:00.000Z",
      "2026-09-01T12:00:00.000Z",
    ]);
  });

  test("usage.watch sends known Plan Limits first, then Usage as the watched logs grow", async () => {
    const { host, transcript, run } = setup();

    const file = host.append(
      transcript("n"),
      claudeLine({ session: "n", ts: "2026-09-01T10:00:00Z", msg: "a" })
    );

    const items = await run(() =>
      Effect.gen(function* () {
        const sink = yield* PlanLimitSink;
        yield* sink.report(limit(10));
        const client = yield* RpcTest.makeClient(UsageRpcs);
        const first = yield* Deferred.make<void>();

        const watching = yield* client["usage.watch"]({}).pipe(
          Stream.tap(() => Deferred.succeed(first, undefined)),
          Stream.take(4),
          Stream.runCollect,
          Effect.forkChild
        );

        yield* Deferred.await(first);
        // The subscription's own catch-up pass indexes the first line; then the log grows.
        yield* client["usage.query"](day);
        host.append(file, claudeLine({ session: "n", ts: "2026-09-01T11:00:00Z", msg: "b" }));
        yield* sink.report(limit(20));

        return yield* Fiber.join(watching);
      })
    );

    expect(isPlanLimitChanged(items[0]) && items[0].limit.usedPercent).toBe(10);
    expect(items.some((i) => isPlanLimitChanged(i) && i.limit.usedPercent === 20)).toBe(true);
    // Only the file watcher indexes the second line: nothing else runs a pass after it.
    const hours = items.flatMap((i) => (isUsageChanged(i) ? i.buckets.map((b) => b.hour) : []));
    expect(hours).toEqual(["2026-09-01T10:00:00.000Z", "2026-09-01T11:00:00.000Z"]);
  });

  test("a Turn's end catches the index up; a new cursor moves its Usage to the Agent Session", async () => {
    const { host, transcript, run } = setup();
    host.append(
      transcript("n"),
      claudeLine({ session: "n", ts: "2026-09-01T10:00:00Z", msg: "a" })
    );

    const [moved, afterTurn] = await run((activity) =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UsageRpcs);
        yield* client["usage.query"](day);
        const updates = yield* Queue.unbounded<UsageStreamItem>();
        yield* client["usage.watch"]({}).pipe(
          Stream.runForEach((i) => Queue.offer(updates, i)),
          Effect.forkChild
        );

        yield* Queue.offer(
          activity,
          SessionActivity.Linked({ link: { harness: "claude", native: "n", sessionId: session } })
        );

        const moved = yield* Queue.take(updates);
        host.append(
          transcript("n"),
          claudeLine({ session: "n", ts: "2026-09-01T10:30:00Z", msg: "b" })
        );
        yield* Queue.offer(activity, SessionActivity.TurnEnded({ harness: "claude" }));
        const afterTurn = yield* Queue.take(updates);

        return [moved, afterTurn] as const;
      })
    );

    const buckets = isUsageChanged(moved) ? moved.buckets : [];
    expect(buckets.map((b) => [b.sessionId, b.tokens.output])).toEqual([
      [session, 20],
      [null, 0],
    ]);
    expect(isUsageChanged(afterTurn) && afterTurn.buckets[0]?.tokens.output).toBe(40);
  });

  test("Plan Limits outlive the Daemon", async () => {
    const { run } = setup();

    await run(() => Effect.flatMap(PlanLimitSink, (sink) => sink.report(limit(33))));

    const first = await run(() =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UsageRpcs);

        return yield* client["usage.watch"]({}).pipe(Stream.take(1), Stream.runCollect);
      })
    );

    expect(isPlanLimitChanged(first[0]) && first[0].limit.usedPercent).toBe(33);
  });

  test("usage.watch seeds Plan Limits from the Harness logs, never over a newer value", async () => {
    let reads = 0;

    const planLimitSeed = Effect.sync(() => {
      reads++;

      return [
        limitWith(5, { observedAt: "2026-09-01T09:00:00Z" }),
        limitWith(7, { harness: "codex", kind: "weekly" }),
      ];
    });

    const { run } = setup([], { planLimitSeed });

    const items = await run(() =>
      Effect.gen(function* () {
        yield* Effect.flatMap(PlanLimitSink, (sink) => sink.report(limit(40)));
        const client = yield* RpcTest.makeClient(UsageRpcs);
        const watch = client["usage.watch"]({}).pipe(Stream.take(2), Stream.runCollect);
        const first = yield* watch;
        yield* watch;

        return first;
      })
    );

    // A second watch within a minute reuses the read.
    expect(reads).toBe(1);
    expect(
      items.map((i) => (isPlanLimitChanged(i) ? [i.limit.harness, i.limit.usedPercent] : null))
    ).toEqual([
      ["claude", 40],
      ["codex", 7],
    ]);
  });

  test("a later watch reads the logs again: Codex used outside Polaris moves its limits", async () => {
    const readings = [
      limitWith(7, { harness: "codex", kind: "weekly", observedAt: "2026-09-01T10:00:00Z" }),
      limitWith(15, { harness: "codex", kind: "weekly", observedAt: "2026-09-02T10:00:00Z" }),
    ];

    let reads = 0;
    const planLimitSeed = Effect.sync(() => [readings[Math.min(reads++, 1)]!]);
    const { run } = setup([], { planLimitSeed, seedEveryMs: 0 });

    const [first, second] = await run(() =>
      Effect.gen(function* () {
        const client = yield* RpcTest.makeClient(UsageRpcs);
        const watch = client["usage.watch"]({}).pipe(Stream.take(1), Stream.runCollect);

        return [yield* watch, yield* watch];
      })
    );

    const percent = (items: ReadonlyArray<unknown>) =>
      items.map((i) => (isPlanLimitChanged(i) ? i.limit.usedPercent : null));

    expect(reads).toBe(2);
    expect(percent(first ?? [])).toEqual([7]);
    expect(percent(second ?? [])).toEqual([15]);
  });
});
