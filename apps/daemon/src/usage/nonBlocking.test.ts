/**
 * The first index pass over large logs runs in bounded steps in the
 * background: a session stream keeps delivering while it runs, and
 * `usage.query` answers from what is indexed, marked `indexing`, instead of
 * waiting for the whole pass.
 */
import { afterEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Command,
  SessionId,
  SessionPlacement,
  type SessionStreamItem,
  UsageStreamItem,
} from "@polaris/protocol";
import { Duration, Effect, Fiber, Layer, Predicate, Schema, Stream } from "effect";
import { RpcTest } from "effect/rpc";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
} from "../engine/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { UsageSessions } from "./sessions.ts";
import {
  claudeLine,
  codexMeta,
  codexTokenCount,
  codexTurnContext,
  type FixtureHost,
  fixtureHost,
} from "./testing.ts";
import { UsageIndexLive } from "./UsageIndex.ts";
import { UsageRpcs, UsageRpcsLive } from "./UsageRpcs.ts";

const hosts: Array<FixtureHost> = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.cleanup();
});

const isUsageChanged = Schema.is(UsageStreamItem.cases.UsageChanged);

/** This process's CPU time so far, in ms: it advances only while the process runs. */
const cpuMs = () => {
  const { user, system } = process.cpuUsage();

  return (user + system) / 1000;
};

/** When a delta arrived, in wall time and in this process's CPU time. */
interface Arrival {
  readonly wallMs: number;
  readonly cpuMs: number;
}

const gaps = (arrivals: ReadonlyArray<Arrival>, key: keyof Arrival) =>
  arrivals.slice(1).map((arrival, i) => arrival[key] - arrivals[i]![key]);

/**
 * The longest the session waited between deltas because this process was busy.
 * A stall on the Daemon's thread is long in wall time and in CPU time. A loaded
 * machine pausing the process is long in wall time only, and the process's other
 * threads (GC, I/O) add CPU time without delaying anything, so each gap counts
 * as the lesser of the two.
 */
const worstBusyGap = (arrivals: ReadonlyArray<Arrival>) => {
  const cpu = gaps(arrivals, "cpuMs");

  return Math.max(...gaps(arrivals, "wallMs").map((wall, i) => Math.min(wall, cpu[i]!)));
};

/** ~220 MB of logs: Codex rollouts whose usage lines sit among large tool outputs, and a long Claude transcript. */
const largeLogs = (host: FixtureHost) => {
  const filler = JSON.stringify({ type: "response_item", payload: { output: "x".repeat(20_000) } });
  let expectedOutput = 0;

  for (let f = 0; f < 3; f++) {
    const lines = [
      JSON.stringify(codexMeta(`big-${f}`, "2026-09-01T00:00:00Z")),
      JSON.stringify(codexTurnContext("2026-09-01T00:00:00Z", "gpt-5.5")),
    ];

    for (let t = 1; t <= 3000; t++) {
      const at = new Date(
        Date.parse("2026-09-01T00:00:00Z") + f * 3_600_000 + t * 1000
      ).toISOString();

      lines.push(filler, JSON.stringify(codexTokenCount(at, { input: t * 100, output: t * 10 })));
    }

    expectedOutput += 3000 * 10;
    writeFileSync(
      join(host.codexSessions, `rollout-2026-09-01-big-${f}.jsonl`),
      `${lines.join("\n")}\n`
    );
  }

  // One long transcript: 40k responses, whose writes would be one long transaction unsliced.
  const lines = Array.from({ length: 40_000 }, (_, i) =>
    JSON.stringify({
      ...claudeLine({
        session: "claude-long",
        ts: new Date(Date.parse("2026-09-02T00:00:00Z") + i * 1000).toISOString(),
        msg: `m-${i}`,
        output: 1,
      }),
      padding: "y".repeat(500),
    })
  );

  expectedOutput += 40_000;
  writeFileSync(join(host.claudeProjects, "claude-long.jsonl"), `${lines.join("\n")}\n`);

  return expectedOutput;
};

test("a session keeps streaming while the first index pass runs over large logs", async () => {
  const host = fixtureHost();
  hosts.push(host);
  const expectedOutput = largeLogs(host);
  const codex = makeFakeDriver("codex");

  const engine = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [codex],
  });

  const usage = UsageRpcsLive.pipe(
    Layer.provideMerge(
      UsageIndexLive({ env: host.env, dbPath: join(host.root, "usage.sqlite"), settleMs: 10 })
    ),
    Layer.provide(UsageSessions.layer)
  );

  const result = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const engineService = yield* Engine;

        const dispatch = (command: Command) =>
          engineService.dispatch({ commandId: cid(), command, deviceLabel: "test" });

        const repo = fakeRepo();
        yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
        const model = yield* waitFor((m) => m.workspaces.size > 0);
        const workspace = [...model.workspaces.values()][0]!;
        const sessionId = SessionId.make("streaming");

        yield* dispatch(
          Command.cases.StartSession.make({
            sessionId,
            workspaceId: workspace.id,
            harness: "codex",
            placement: SessionPlacement.cases.InPlace.make({}),
            permissionMode: "supervised",
            model: null,
            effort: null,
            prompt: "stream",
            attachments: [],
          })
        );

        yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
        const harness = codex.latest(sessionId)!;
        const turnId = harness.turns[0]!.turnId;

        // The subscriber records when each delta arrives (one is emitted every 10 ms).
        const arrivals: Array<Arrival> = [];

        const subscriber = yield* Stream.runForEach(
          engineService.subscribeSession({ sessionId, afterSequence: null, turnLimit: 1 }),
          (item: SessionStreamItem) =>
            Effect.sync(() => {
              if (Predicate.isTagged(item, "Delta"))
                arrivals.push({ wallMs: performance.now(), cpuMs: cpuMs() });
            })
        ).pipe(Effect.forkChild);

        let streaming = true;

        const emitter = yield* Effect.gen(function* () {
          while (streaming) {
            harness.emit(
              HarnessEvent.ItemDelta({
                turnId,
                itemId: "m1",
                field: "text",
                text: "x",
              })
            );
            yield* Effect.sleep(Duration.millis(10));
          }
        }).pipe(Effect.forkChild);

        yield* waitUntil(() => arrivals.length > 10, 5000);

        // The Usage view opens: the first watch and query start the first pass.
        const client = yield* RpcTest.makeClient(UsageRpcs);
        let passEnded = false;

        yield* client["usage.watch"]({}).pipe(
          Stream.filter((item) => isUsageChanged(item) && !item.indexing),
          Stream.take(1),
          Stream.runForEach(() => Effect.sync(() => (passEnded = true))),
          Effect.forkChild
        );

        // From the last delta before the pass, so a stall at its start counts.
        const duringFrom = arrivals.length - 1;

        const all = {
          from: "2026-01-01T00:00:00Z",
          to: "2027-01-01T00:00:00Z",
          harness: null,
          sessionId: null,
        };

        const t0 = performance.now();
        const first = yield* client["usage.query"](all);
        const queryMs = performance.now() - t0;
        yield* waitUntil(() => passEnded, 120_000);
        const during = arrivals.slice(duringFrom);
        const final = yield* client["usage.query"](all);
        streaming = false;
        yield* Fiber.interrupt(emitter);
        yield* Fiber.interrupt(subscriber);

        return { first, queryMs, during, final };
      }).pipe(Effect.provide(Layer.merge(usage, engine).pipe(Layer.provideMerge(engine))))
    )
  );

  // The query answered straight away, from an index still being built.
  expect(result.queryMs).toBeLessThan(2000);
  expect(result.first.indexing).toBe(true);

  // Never held up for long: 30–70 ms here, loaded or not; 260–490 ms without the
  // pass's yields and write slices (docs/adr/0009, Testing).
  expect(result.during.length).toBeGreaterThan(20);
  expect(worstBusyGap(result.during)).toBeLessThan(100);

  // And the pass finished with every response indexed.
  expect(result.final.indexing).toBe(false);
  expect(result.final.buckets.reduce((sum, b) => sum + b.tokens.output, 0)).toBe(expectedOutput);
}, 180_000);
