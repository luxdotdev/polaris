import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PlanLimit, UsageReport, UsageStreamItem } from "@polaris/protocol";
import { Effect, Fiber, type Scope, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { PlanLimitRpcs, PlanLimitRpcsLive } from "./PlanLimitRpcs.ts";
import { PlanLimits, type PlanLimitsOptions } from "./PlanLimits.ts";

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempFile = () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-plan-limits-"));
  dirs.push(dir);

  return join(dir, "plan-limits.json");
};

const limit = (overrides: Partial<PlanLimit> = {}) =>
  new PlanLimit({
    harness: "claude",
    kind: "five-hour",
    scope: null,
    windowMinutes: 300,
    usedPercent: 10,
    status: "ok",
    resetsAt: "2026-09-29T08:50:00.000Z",
    observedAt: "2026-09-29T05:00:00.000Z",
    plan: "max",
    ...overrides,
  });

const run = <A, E>(
  options: PlanLimitsOptions,
  body: Effect.Effect<A, E, PlanLimits | Scope.Scope>
): Promise<A> =>
  Effect.runPromise(Effect.scoped(body).pipe(Effect.provide(PlanLimits.layer(options))));

/** The first `n` items of `changes`, collected while `act` runs. */
const collect = (n: number, act: Effect.Effect<void, never, PlanLimits>) =>
  Effect.gen(function* () {
    const planLimits = yield* PlanLimits;

    const fiber = yield* planLimits.changes.pipe(
      Stream.take(n),
      Stream.runCollect,
      Effect.forkScoped
    );

    yield* Effect.sleep("10 millis");
    yield* act;

    return yield* Fiber.join(fiber);
  });

describe("PlanLimits", () => {
  test("a subscriber gets every known limit, then changes; a mere confirmation is not a change", async () => {
    const items = await run(
      { file: null },
      Effect.gen(function* () {
        const planLimits = yield* PlanLimits;
        planLimits.report([limit()]);

        return yield* collect(
          2,
          Effect.sync(() => {
            // Same value seconds later: stored, not announced.
            planLimits.report([limit({ observedAt: "2026-09-29T05:00:05.000Z" })]);
            planLimits.report([limit({ usedPercent: 12, observedAt: "2026-09-29T05:00:10.000Z" })]);
          })
        );
      })
    );

    expect(items.map((l) => [l.usedPercent, l.observedAt])).toEqual([
      [10, "2026-09-29T05:00:00.000Z"],
      [12, "2026-09-29T05:00:10.000Z"],
    ]);
  });

  test("an older reading never replaces a newer one; windows are keyed by harness, kind and scope", async () => {
    const current = await run(
      { file: null },
      Effect.gen(function* () {
        const planLimits = yield* PlanLimits;
        planLimits.report([limit({ usedPercent: 20, observedAt: "2026-09-29T06:00:00.000Z" })]);
        planLimits.report([limit({ usedPercent: 5 })]);
        planLimits.report([limit({ kind: "weekly", scope: "Fable" }), limit({ harness: "codex" })]);

        return yield* planLimits.current;
      })
    );

    expect(current.map((l) => [l.harness, l.kind, l.scope, l.usedPercent])).toEqual([
      ["claude", "five-hour", null, 20],
      ["claude", "weekly", "Fable", 10],
      ["codex", "five-hour", null, 10],
    ]);
  });

  test("a confirmation re-announces the value once it is a minute old, so Clients see it is fresh", async () => {
    const items = await run(
      { file: null },
      Effect.gen(function* () {
        const planLimits = yield* PlanLimits;
        planLimits.report([limit()]);

        return yield* collect(
          2,
          Effect.sync(() => planLimits.report([limit({ observedAt: "2026-09-29T05:01:00.000Z" })]))
        );
      })
    );

    expect(items.map((l) => l.observedAt)).toEqual([
      "2026-09-29T05:00:00.000Z",
      "2026-09-29T05:01:00.000Z",
    ]);
  });

  test("persists, so a restarted Daemon still knows the last values", async () => {
    const file = tempFile();

    await run(
      { file },
      Effect.gen(function* () {
        (yield* PlanLimits).report([limit({ usedPercent: 33 })]);
        yield* Effect.sleep("50 millis");
      })
    );

    const restored = await run(
      { file },
      Effect.flatMap(PlanLimits, (p) => p.current)
    );

    expect(restored.map((l) => l.usedPercent)).toEqual([33]);
  });

  test("the seed (the Harness logs) is read once, on the first ask, and never over newer values", async () => {
    let reads = 0;

    const seed = Effect.sync(() => {
      reads++;

      return [
        limit({ usedPercent: 1, observedAt: "2026-09-29T04:00:00.000Z" }),
        limit({ harness: "codex" }),
      ];
    });

    const [before, after] = await run(
      { file: null, seed },
      Effect.gen(function* () {
        const planLimits = yield* PlanLimits;
        planLimits.report([limit({ usedPercent: 50 })]);
        const before = reads;
        yield* planLimits.current;
        yield* planLimits.current;

        return [before, yield* planLimits.current] as const;
      })
    );

    expect(before).toBe(0);
    expect(reads).toBe(1);
    expect(after.map((l) => [l.harness, l.usedPercent])).toEqual([
      ["claude", 50],
      ["codex", 10],
    ]);
  });
});

describe("usage.watch", () => {
  const client = RpcTest.makeClient(PlanLimitRpcs).pipe(Effect.provide(PlanLimitRpcsLive));

  test("sends every known Plan Limit, then each change, as PlanLimitChanged", async () => {
    const items = await run(
      { file: null },
      Effect.gen(function* () {
        const planLimits = yield* PlanLimits;
        const rpc = yield* client;

        planLimits.report([limit()]);

        const fiber = yield* rpc["usage.watch"]({}).pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkScoped
        );

        yield* Effect.sleep("10 millis");
        planLimits.report([limit({ harness: "codex", kind: "weekly" })]);

        return yield* Fiber.join(fiber);
      })
    );

    expect(items).toEqual([
      UsageStreamItem.cases.PlanLimitChanged.make({ limit: limit() }),
      UsageStreamItem.cases.PlanLimitChanged.make({
        limit: limit({ harness: "codex", kind: "weekly" }),
      }),
    ]);
  });

  test("usage.query reports nothing indexed yet", async () => {
    const report = await run(
      { file: null },
      Effect.flatMap(client, (rpc) =>
        rpc["usage.query"]({
          from: "2026-09-01T00:00:00Z",
          to: "2026-10-01T00:00:00Z",
          harness: null,
          sessionId: null,
        })
      )
    );

    expect(report).toEqual(new UsageReport({ buckets: [], indexedAt: null }));
  });
});
