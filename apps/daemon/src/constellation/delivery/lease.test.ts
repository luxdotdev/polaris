import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { AttemptId, CommandId } from "@polaris/protocol";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { C, CID, HOST } from "../../engine/constellation.testing.ts";
import { recoverSession } from "../../engine/recovery.constellation.ts";
import { newTempDir, removeTempDir } from "../../platform/tempDir.testing.ts";
import { EventStore } from "../../store/EventStore.ts";
import { observeWorkerHost, recoverAttempt } from "../recovery.ts";
import { ConstellationOwner } from "../runtime.ts";
import { Constellations } from "../service.ts";
import { ConstellationDelivery } from "./index.ts";
import { LEASE_MS } from "./lease.ts";
import { WORKER, send, setup, silentTwice, wait, world } from "./testing.ts";

const dirs: Array<string> = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) removeTempDir(dir);
});

const ATTEMPT = AttemptId.make("a1");

const iso = (ms: number) => new Date(ms).toISOString();

const graph = Effect.fnUntraced(function* () {
  return (yield* (yield* EventStore).model).constellations.get(CID)!;
});

const attempt = Effect.map(graph(), (r) => r.graph.attempts.find((a) => a.id === ATTEMPT)!);

/** Waits until the fold satisfies `ok`. */
const until = Effect.fnUntraced(function* (
  ok: (record: Effect.Success<ReturnType<typeof graph>>) => boolean
) {
  const store = yield* EventStore;
  yield* wait(() => graph().pipe(Effect.map(ok), Effect.provideService(EventStore, store)));
});

const lostSoon = () =>
  until((r) => r.graph.attempts.find((a) => a.id === ATTEMPT)?.state === "lost");

const delivered = () => until((r) => r.graph.pendingNotifications.length === 0);

test("a worker silent after its Stopped notice settles lost when the 10-minute lease runs out, and the Lead hears it", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const since = yield* silentTwice(w, ATTEMPT);
      const delivery = yield* ConstellationDelivery;
      // The Stopped digest goes out; then only the lease wake is left.
      yield* TestClock.setTime(since + 30_000);
      yield* delivered();
      expect(yield* delivery.pendingTimers).toBe(1);

      yield* TestClock.setTime(since + LEASE_MS - 1);
      yield* delivery.flush();
      expect((yield* attempt).state).toBe("working");
      yield* TestClock.adjust(1);
      yield* lostSoon();
      const lost = yield* attempt;
      expect(lost.settleReason).toBe("10 min silent · stopped notice unanswered");

      // The Settled notice arms the digest; the Lead hears it, live or in a new Turn.
      yield* wait(() => Effect.map(delivery.pendingTimers, (n) => n === 1));
      yield* TestClock.adjust(30_000);
      yield* delivered();
      expect([...w.prompts, ...w.steers].join("\n")).toContain(
        "A: attempt 1 lost (10 min silent · stopped notice unanswered)."
      );
      expect(yield* delivery.pendingTimers).toBe(0);
    })
  );
});

test("activity from the Attempt within the lease cancels it: a Turn, or a progress report", async () => {
  for (const activity of ["turn", "progress"] as const) {
    const w = world();
    await w.run(
      Effect.gen(function* () {
        yield* setup();
        const since = yield* silentTwice(w, ATTEMPT);
        const delivery = yield* ConstellationDelivery;
        yield* TestClock.setTime(since + 60_000);

        if (activity === "turn") yield* send(WORKER, "Keep going");
        else
          yield* (yield* Constellations).command(
            { kind: "session", sessionId: WORKER },
            CommandId.make("progress"),
            C.WorkerProgress.make({
              constellationId: CID,
              attemptId: ATTEMPT,
              note: "Still here",
              completed: null,
              total: null,
            })
          );
        yield* delivery.flush();
        yield* TestClock.setTime(since + 2 * LEASE_MS);
        yield* delivery.flush();
        expect((yield* attempt).state).toBe("working");
      })
    );
  }
});

test("a stale Attempt on an Offline Host never expires", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const since = yield* silentTwice(w, ATTEMPT);
      const delivery = yield* ConstellationDelivery;
      yield* observeWorkerHost(HOST, true).pipe(Effect.provideService(ConstellationOwner, HOST));
      yield* TestClock.setTime(since + 30_000);
      yield* delivered();
      expect(yield* delivery.pendingTimers).toBe(0);
      yield* TestClock.setTime(since + 6 * LEASE_MS);
      yield* delivery.flush();
      expect((yield* attempt).state).toBe("working");
    })
  );
});

test("a worker interrupted a second time settles lost after the lease, re-armed from the fold on restart", async () => {
  const dir = newTempDir("lease-", { short: true });
  dirs.push(dir);
  const file = join(dir, "state.sqlite");
  const first = Date.now() + 60_000;
  const second = first + 60_000;

  const w = world(file);
  await w.run(
    Effect.gen(function* () {
      yield* setup();
      const store = yield* EventStore;
      yield* send(WORKER);
      yield* recoverSession({ store }, WORKER, "restart", iso(first));
      const proof = (yield* graph()).interruptions.get(ATTEMPT)!;
      yield* recoverAttempt({ sessionId: WORKER, interruptionId: proof.interruptionId }).pipe(
        Effect.provideService(ConstellationOwner, HOST)
      );
      expect(w.turns).toHaveLength(1);
      yield* recoverSession({ store }, WORKER, "restart", iso(second));
    })
  );

  const restarted = world(file);
  await restarted.run(
    Effect.gen(function* () {
      const delivery = yield* ConstellationDelivery;
      yield* TestClock.setTime(second + 1000);
      yield* delivery.start();
      expect(yield* delivery.pendingTimers).toBe(1);
      yield* TestClock.setTime(second + LEASE_MS - 1);
      expect((yield* attempt).state).toBe("working");
      yield* TestClock.adjust(1);
      yield* lostSoon();
      expect((yield* attempt).settleReason).toBe("10 min silent · interrupted twice");
    })
  );
});
