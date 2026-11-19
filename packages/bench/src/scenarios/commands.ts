/**
 * commands: a session running many shell commands on a large working tree (full: 50k files).
 *
 * Each command is a real `sh -c` that appends to a file, run by the scripted Harness between
 * the two working-tree snapshots of ADR 0117 (`git add -A` + `write-tree` through Polaris's
 * own index, then `diff-tree` and the patch). The first Turn warms that index, as any Turn's
 * `before` checkpoint does.
 *
 *   command_before: what a command waits before it runs (the snapshot before it)
 *   command_after:  the snapshot after it, the diff of the two trees and the patches
 */
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import { awaitReady, cleanup, connect, createTempDir } from "../daemon.ts";
import {
  registerWorkspace,
  sendTurn,
  settle,
  startSession,
  type TurnScript,
  waitUntil,
  watchSession,
} from "../drive.ts";
import { copyTree, git, sourceTree } from "../fixtures.ts";
import { median, quantile } from "../stats.ts";
import { cpu, type Metric, peakMemory, rss, type Scenario, time } from "../types.ts";

/** Mirrors `ShellCommandTimings` in apps/daemon/src/harness/bench/BenchDriver.ts. */
const Timings = Schema.Struct({
  beforeMs: Schema.Number,
  afterMs: Schema.Number,
  mode: Schema.Literals(["patches", "names", "off"]),
});

const decodeTimings = Schema.decodeUnknownOption(Schema.fromJsonString(Timings));

export const commands: Scenario = {
  name: "commands",
  description: "per-command working-tree snapshots: many shell commands on a large tree",
  run: (ctx) =>
    Effect.gen(function* () {
      const count = ctx.quick ? 5_000 : 50_000;
      const perTurn = ctx.quick ? 10 : 40;
      ctx.log(`commands: preparing a ${count}-file repo (cached after the first run)…`);
      const source = sourceTree(count);

      const dir = yield* Effect.acquireRelease(
        Effect.sync(() => createTempDir("commands")),
        (d) => Effect.sync(() => cleanup(d))
      );

      const repo = copyTree(source, join(dir, "repo"));
      git(repo, "update-index", "-q", "--refresh");

      const daemon = yield* ctx.launch();
      yield* awaitReady(daemon);
      const sampler = yield* ctx.sample(daemon, 100);
      const client = yield* connect(daemon, ctx.transport, "commands");
      const workspaceId = yield* registerWorkspace(client, repo, "commands");
      const sessionId = "commands-0";
      const warm: TurnScript = { items: 1, deltasPerItem: 0 };
      const script: TurnScript = { items: 0, deltasPerItem: 0, shellCommands: perTurn };

      yield* startSession(client, { sessionId, workspaceId, script: warm });
      const watch = yield* watchSession(client, sessionId);

      const turnDone = (turn: number) =>
        waitUntil(
          () => watch.turnEnded.length >= turn && watch.state === "idle",
          300_000,
          `Turn ${turn}`
        );

      yield* turnDone(1);
      yield* settle(200);
      const startedAt = performance.now();
      yield* sendTurn(client, sessionId, script);
      yield* turnDone(2);
      const turnMs = (watch.turnEnded[1] ?? performance.now()) - startedAt;
      const report = sampler.report();

      const ran = watch.commands.flatMap((command) =>
        Option.match(decodeTimings(command.output), {
          onNone: () => [],
          onSome: (timings) => [{ ...timings, changed: command.changed }],
        })
      );

      const wrong = ran.filter((command) => command.changed !== 1).length;

      if (ran.length !== perTurn || wrong > 0)
        return yield* Effect.die(
          new Error(
            `${ran.length} of ${perTurn} commands reported, ${wrong} without their one changed file`
          )
        );

      const sorted = (values: ReadonlyArray<number>) => values.toSorted((a, b) => a - b);
      const before = sorted(ran.map((command) => command.beforeMs));
      const after = sorted(ran.map((command) => command.afterMs));
      const modes = [...new Set(ran.map((command) => command.mode))].join(", ");

      const metrics: Record<string, Metric> = {};

      Object.assign(metrics, {
        command_before_ms: time(median(before)),
        command_before_p95_ms: time(quantile(before, 0.95)),
        command_after_ms: time(median(after)),
        command_after_p95_ms: time(quantile(after, 0.95)),
        commands_turn_ms: time(turnMs),
        cpu_avg_pct: cpu(report.cpuAvgPct, { info: true }),
        rss_peak_mib: rss(peakMemory(report.rssBytes.max)),
      } satisfies Record<string, Metric>);

      if (report.footprintBytes) metrics.footprint_peak_mib = peakMemory(report.footprintBytes.max);

      return {
        metrics,
        notes: [
          `${count} files; one Turn of ${perTurn} shell commands, each appending to one of 10 files`,
          `snapshot mode after each command: ${modes}`,
        ],
      };
    }),
};
