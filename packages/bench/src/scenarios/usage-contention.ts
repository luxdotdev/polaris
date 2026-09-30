/**
 * usage-contention: what the rest of the Daemon feels while the Usage index
 * builds from nothing over a multi-GB log tree (2.7 GB / 1.1 GB). One Client
 * streams a scripted session and times a cheap RPC every 50 ms, then opens
 * `usage.watch` and `usage.query` on the same connection, as the Usage view does.
 */
import { Effect, Predicate, Ref, Stream } from "effect";
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
import { smallRepo } from "../fixtures.ts";
import { summarize } from "../stats.ts";
import { latency, type Metric, type Scenario, time } from "../types.ts";
import { usageLogs } from "../usage-logs.ts";

const ALL_TIME = {
  from: "2000-01-01T00:00:00Z",
  to: "2100-01-01T00:00:00Z",
  harness: null,
  sessionId: null,
};

/** An LLM's pace: 20 deltas per item at 50/s. */
const STREAMING: TurnScript = { items: 10, deltasPerItem: 20, deltaBytes: 48, deltaIntervalMs: 20 };

export const usageContention: Scenario = {
  name: "usage-contention",
  description: "RPC and session stream latency while the Usage index builds over GBs of logs",
  run: (ctx) =>
    Effect.gen(function* () {
      const logs = usageLogs(ctx.quick ? "full" : "large");

      const repo = yield* Effect.acquireRelease(
        Effect.sync(() => smallRepo(createTempDir("usage-contention"))),
        (d) => Effect.sync(() => cleanup(d))
      );

      const daemon = yield* ctx.launch({
        env: { CLAUDE_CONFIG_DIR: logs.claude, CODEX_HOME: logs.codex },
      });

      yield* awaitReady(daemon);
      const worker = yield* connect(daemon, ctx.transport, "sessions");
      // One connection per Host, as the Desktop App has.
      const viewer = worker;
      const workspaceId = yield* registerWorkspace(worker, repo, "usage-contention");

      // A session that keeps streaming, Turn after Turn.
      const deltaLatencies: Array<number> = [];
      yield* startSession(worker, { sessionId: "contention", workspaceId, script: STREAMING });

      const watch = yield* watchSession(worker, "contention", {
        deltaLatencies,
        autoApprove: true,
      });

      const stop = yield* Ref.make(false);

      yield* Effect.forkScoped(
        Effect.gen(function* () {
          for (let turn = 1; !(yield* Ref.get(stop)); turn++) {
            yield* waitUntil(
              () => watch.turnEnded.length >= turn && watch.state === "idle",
              60_000,
              "Turn end"
            );
            yield* sendTurn(worker, "contention", STREAMING);
            yield* waitUntil(() => watch.turnStarted.length > turn, 30_000, "TurnStarted");
          }
        }).pipe(Effect.ignore)
      );

      // A cheap RPC every 50 ms, timed.
      const rpc: Array<{ at: number; ms: number }> = [];

      yield* Effect.forkScoped(
        Effect.forever(
          Effect.gen(function* () {
            const t0 = performance.now();
            yield* worker.connection.client["files.stat"]({ path: repo });
            rpc.push({ at: t0, ms: performance.now() - t0 });
            yield* settle(50);
          })
        ).pipe(Effect.ignore)
      );

      yield* waitUntil(() => watch.deltas > 0, 30_000, "the first delta");
      yield* settle(3000);
      const quiet = summarize(rpc.map((r) => r.ms));
      deltaLatencies.length = 0;

      // The Usage view opens: the first watch and query start the first index pass.
      const start = performance.now();
      let passEnd = 0;

      yield* Effect.forkScoped(
        viewer.connection.client["usage.watch"]({}).pipe(
          Stream.filter(
            (item) =>
              Predicate.isTagged(item, "UsageChanged") &&
              !("indexing" in item && item.indexing === true)
          ),
          Stream.take(1),
          Stream.runForEach(() => Effect.sync(() => (passEnd = performance.now())))
        )
      );

      const q0 = performance.now();
      yield* viewer.connection.client["usage.query"](ALL_TIME);
      const queryMs = performance.now() - q0;
      yield* waitUntil(() => passEnd > 0, 600_000, "the first index pass");
      const during = rpc.flatMap((r) => (r.at >= start && r.at <= passEnd ? [r.ms] : []));
      const busy = summarize(during);
      const deltas = summarize(deltaLatencies);
      yield* Ref.set(stop, true);

      const metrics: Record<string, Metric> = {};

      Object.assign(metrics, {
        first_pass_ms: time(passEnd - start, { tolerance: { relative: 0.3, absolute: 500 } }),
        first_query_ms: latency(queryMs, { tolerance: { relative: 0.5, absolute: 50 } }),
        rpc_quiet_p99_ms: latency(quiet.p99, { tolerance: { relative: 0.5, absolute: 5 } }),
        rpc_during_p50_ms: latency(busy.median, { tolerance: { relative: 0.5, absolute: 5 } }),
        rpc_during_p99_ms: latency(busy.p99, { tolerance: { relative: 0.5, absolute: 20 } }),
        rpc_during_max_ms: latency(busy.max, { tolerance: { relative: 0.5, absolute: 50 } }),
        delta_latency_during_p99_ms: latency(deltas.p99, {
          tolerance: { relative: 0.5, absolute: 20 },
        }),
        delta_latency_during_max_ms: latency(deltas.max, {
          tolerance: { relative: 0.5, absolute: 50 },
        }),
      } satisfies Record<string, Metric>);

      return {
        metrics,
        notes: [
          `${(logs.bytes / 1e9).toFixed(2)} GB of logs; ${during.length} RPCs and ${deltaLatencies.length} deltas during the first pass`,
        ],
      };
    }),
};
