import { describe, expect, test } from "bun:test";
import { PlanLimit } from "@polaris/protocol";
import { Effect, Layer } from "effect";
import { PlanLimitSink } from "../../services.ts";
import { mergeLimits, PlanLimitReporter } from "./PlanLimitReporter.ts";

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

const at = (seconds: number) =>
  new Date(Date.parse("2026-09-29T05:00:00.000Z") + seconds * 1000).toISOString();

describe("mergeLimits", () => {
  test("a changed value goes on; a mere confirmation waits a minute", () => {
    const known = new Map<string, PlanLimit>();

    expect(mergeLimits(known, [limit()])).toHaveLength(1);
    expect(mergeLimits(known, [limit({ observedAt: at(5) })])).toHaveLength(0);
    expect(mergeLimits(known, [limit({ usedPercent: 12, observedAt: at(10) })])).toHaveLength(1);
    expect(mergeLimits(known, [limit({ usedPercent: 12, observedAt: at(69) })])).toHaveLength(0);
    expect(mergeLimits(known, [limit({ usedPercent: 12, observedAt: at(70) })])).toHaveLength(1);
  });

  test("an older reading never replaces a newer one; windows are keyed by harness, kind and scope", () => {
    const known = new Map<string, PlanLimit>();
    mergeLimits(known, [limit({ usedPercent: 20, observedAt: at(60) })]);

    expect(mergeLimits(known, [limit({ usedPercent: 5 })])).toEqual([]);
    expect(
      mergeLimits(known, [limit({ kind: "weekly", scope: "Fable" }), limit({ harness: "codex" })])
    ).toHaveLength(2);
    expect([...known.values()].map((l) => [l.harness, l.kind, l.scope, l.usedPercent])).toEqual([
      ["claude", "five-hour", null, 20],
      ["claude", "weekly", "Fable", 10],
      ["codex", "five-hour", null, 10],
    ]);
  });
});

describe("PlanLimitReporter", () => {
  test("hands what the drivers report to the Usage index's sink, in order and without repeats", async () => {
    const sent: Array<PlanLimit> = [];

    const sink = Layer.succeed(
      PlanLimitSink,
      PlanLimitSink.of({ report: (l) => Effect.sync(() => sent.push(l)) })
    );

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const reporter = yield* PlanLimitReporter;
          reporter.report([limit(), limit({ kind: "weekly", windowMinutes: 10080 })]);
          reporter.report([limit({ observedAt: at(1) })]);
          reporter.report([limit({ usedPercent: 11, observedAt: at(2) })]);
          yield* Effect.sleep("20 millis");
        }).pipe(Effect.provide(PlanLimitReporter.layer.pipe(Layer.provide(sink))))
      )
    );

    expect(sent.map((l) => [l.kind, l.usedPercent])).toEqual([
      ["five-hour", 10],
      ["weekly", 10],
      ["five-hour", 11],
    ]);
  });
});
