import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { CID, HOST, LEAD } from "../engine/constellation.testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { observeWorkerHost, recoverWorkingAttempts, RECOVERY_PROMPT } from "./recovery.ts";
import { setup, world, WORKER, STANDALONE, send, signal } from "./delivery/testing.ts";

const recovery = (sessionId = WORKER, interruptionId = "restart-1") => ({
  sessionId,
  interruptionId,
});

test("resources resume first, then one delegated Continue; Lead and standalone Sessions remain Needs You", async () => {
  const w = world();
  await w.run(
    Effect.gen(function* () {
      yield* setup();

      for (const id of [LEAD, WORKER, STANDALONE]) {
        yield* send(id);
        yield* signal(id, {
          type: "daemon.recover",
          cause: "restart",
          at: "2026-10-01T01:00:00.000Z",
        });
      }

      let resumed = false;

      const runtime = {
        ...w.runtime,
        resumeWorking: () =>
          Effect.sync(() => {
            resumed = true;
            expect(w.turns).toHaveLength(0);
          }),
      };

      yield* recoverWorkingAttempts(runtime, [
        recovery(),
        recovery(LEAD),
        recovery(STANDALONE),
      ]).pipe(Effect.provideService(importOwner, HOST));
      expect(resumed).toBe(true);
      expect(w.turns).toHaveLength(1);
      expect(w.prompts[0]).toBe(RECOVERY_PROMPT);
      // The continued Turn retains its original record; the Harness receives the recovery instruction.
      const store = yield* EventStore;
      expect((yield* store.model).constellations.get(CID)!.recoveries.size).toBe(1);
      expect((yield* store.model).sessions.get(LEAD)!.session.state).toBe("needs-you");
      expect((yield* store.model).sessions.get(STANDALONE)!.session.state).toBe("needs-you");
      yield* recoverWorkingAttempts(w.runtime, [recovery()]).pipe(
        Effect.provideService(importOwner, HOST)
      );
      expect(w.turns).toHaveLength(1);
      yield* signal(WORKER, {
        type: "daemon.recover",
        cause: "restart",
        at: "2026-10-01T02:00:00.000Z",
      });
      yield* recoverWorkingAttempts(w.runtime, [recovery(WORKER, "restart-2")]).pipe(
        Effect.provideService(importOwner, HOST)
      );
      expect(w.turns).toHaveLength(1);
      expect((yield* store.model).sessions.get(WORKER)!.session.state).toBe("needs-you");
    })
  );
});

import { ConstellationOwner as importOwner } from "./runtime.ts";

test("stale is durable through restart, never advances Attempt revision or mechanically settles, and clears on return", async () => {
  const directory = mkdtempSync(join(tmpdir(), "polaris-l-stale-"));
  const file = join(directory, "state.sqlite");

  try {
    const w = world(file);
    await w.run(
      Effect.gen(function* () {
        yield* setup();
        yield* observeWorkerHost(HOST, true).pipe(Effect.provideService(importOwner, HOST));
        yield* observeWorkerHost(HOST, true).pipe(Effect.provideService(importOwner, HOST));
        const record = (yield* (yield* EventStore).model).constellations.get(CID)!;
        expect(record.stale.size).toBe(1);
        expect(record.graph.attempts[0]!.revision).toBe(0);
        expect(record.graph.attempts[0]!.state).toBe("working");
        yield* send(WORKER);
        yield* signal(WORKER, {
          type: "daemon.recover",
          cause: "restart",
          at: "2026-10-01T01:00:00.000Z",
        });
        yield* recoverWorkingAttempts(w.runtime, [recovery()]).pipe(
          Effect.provideService(importOwner, HOST)
        );
        expect(w.turns).toHaveLength(0);
      })
    );
    await world(file).run(
      Effect.gen(function* () {
        const store = yield* EventStore;
        expect((yield* store.model).constellations.get(CID)!.stale.size).toBe(1);
        yield* observeWorkerHost(HOST, false).pipe(Effect.provideService(importOwner, HOST));
        yield* observeWorkerHost(HOST, false).pipe(Effect.provideService(importOwner, HOST));
        expect((yield* store.model).constellations.get(CID)!.stale.size).toBe(0);
        expect((yield* store.model).constellations.get(CID)!.graph.attempts[0]!.state).toBe(
          "working"
        );
      })
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
