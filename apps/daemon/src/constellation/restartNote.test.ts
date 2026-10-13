import { expect, test } from "bun:test";
import { BackgroundTask, DomainEvent, Subagent, SubagentId } from "@polaris/protocol";
import { Effect } from "effect";
import { AT } from "../engine/constellation.testing.ts";
import { EventStore } from "../store/EventStore.ts";
import { WORKER, send, signal, session } from "./delivery/testing.ts";
import { sessionRestartNote } from "./restartNote.ts";

const run = <A, E>(effect: Effect.Effect<A, E, EventStore>) =>
  Effect.runPromise(effect.pipe(Effect.provide(EventStore.layerSqlite(":memory:"))));

const seed = Effect.gen(function* () {
  const store = yield* EventStore;
  yield* store.commit({
    commandId: null,
    decide: () =>
      Effect.succeed([DomainEvent.cases.SessionCreated.make({ session: session(WORKER) })]),
  });
  yield* send(WORKER);
  yield* signal(WORKER, { type: "harness.opened" });
  const turn = (yield* store.model).sessions.get(WORKER)!.turns.at(-1)!;
  yield* signal(WORKER, {
    type: "harness.backgroundTasksChanged",
    tasks: [new BackgroundTask({ id: "shell-1", kind: "command", description: "bun dev" })],
  });
  yield* signal(WORKER, {
    type: "harness.subagentStarted",
    subagent: new Subagent({
      id: SubagentId.make("sub-1"),
      sessionId: WORKER,
      turnId: turn.id,
      parentItemId: null,
      title: "Explore the parser",
      agent: "Explore",
      model: null,
      status: "working",
      startedAt: AT,
      endedAt: null,
    }),
  });

  return store;
});

test("after a Daemon restart the next Turn learns which background work was stopped", async () => {
  const note = await run(
    Effect.gen(function* () {
      const store = yield* seed;
      expect(yield* sessionRestartNote(store, WORKER)).toBeNull();
      yield* signal(WORKER, { type: "daemon.recover", cause: "restart", at: AT });
      // The Session machine keeps its rule: Needs You, interrupted; nothing continues.
      expect((yield* store.model).sessions.get(WORKER)!.session.state).toBe("needs-you");

      return yield* sessionRestartNote(store, WORKER);
    })
  );

  expect(note).toBe(
    [
      "The Polaris Daemon restarted, so this background work was stopped. It will not report back:",
      "- command: bun dev",
      "- subagent: Explore the parser",
      "Start again whatever you still need; do not wait for it.",
    ].join("\n")
  );
});

test("the note is said once: a Turn after the restart clears it, and ordinary ends never set it", async () => {
  await run(
    Effect.gen(function* () {
      const store = yield* seed;
      yield* signal(WORKER, {
        type: "harness.backgroundTasksChanged",
        tasks: [],
      });
      expect(yield* sessionRestartNote(store, WORKER)).toBeNull();
      // A real restart commits from a new process, never in the same millisecond as this.
      yield* Effect.promise(() => Bun.sleep(5));
      yield* signal(WORKER, { type: "daemon.recover", cause: "restart", at: AT });
      const note = yield* sessionRestartNote(store, WORKER);
      expect(note).toContain("subagent: Explore the parser");
      // The shell ended before the restart, so the restart did not stop it.
      expect(note).not.toContain("bun dev");
      const before = (yield* store.model).sequence;
      yield* signal(WORKER, { type: "turn.continue" });
      expect(yield* sessionRestartNote(store, WORKER)).toBeNull();
      // Read as of just before the Continue commit, it is that Turn's note.
      expect(yield* sessionRestartNote(store, WORKER, before)).toContain("Explore the parser");
    })
  );
});
