import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  DomainEvent,
  type HostStreamItem,
  SessionId,
  SessionPlacement,
  TurnId,
  TurnItem,
  TurnTrigger,
} from "@polaris/protocol";
import { Effect, type Layer, Predicate, Stream } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

type Env = Engine | EventStore;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "test" })
  );

const reply = (turnId: TurnId, id: string, text: string) =>
  HarnessEvent.ItemCompleted({ turnId, item: TurnItem.cases.AssistantMessage.make({ id, text }) });

const ended = (turnId: TurnId) =>
  HarnessEvent.TurnEnded({ turnId, status: "completed", error: null });

/** The session as a Client that connects now gets it in the Host snapshot. */
const hostSummary = (sessionId: SessionId) =>
  Effect.gen(function* () {
    const engine = yield* Engine;

    const items: ReadonlyArray<HostStreamItem> = yield* engine
      .subscribeHost(null)
      .pipe(Stream.take(1), Stream.runCollect);

    const snapshot = items[0];

    if (!Predicate.isTagged(snapshot, "Snapshot")) throw new Error("expected a snapshot");

    return snapshot.sessions.find((s) => s.session.id === sessionId)!.session;
  });

/** The Host stream's Turn events, as user-Turn number and reply preview, in order. */
const hostTurnEvents = Effect.gen(function* () {
  const store = yield* EventStore;
  const { sequence } = yield* store.model;
  const events = yield* store.readEvents({ after: 0, upTo: sequence, sessionId: null });

  return events.flatMap(({ event }) =>
    DomainEvent.guards.TurnStarted(event) || DomainEvent.guards.TurnEnded(event)
      ? [[event._tag, event.turn.userTurnNumber, event.turn.replyPreview]]
      : []
  );
});

test("the Host stream numbers user Turns, previews replies, and names the current user Turn", async () => {
  const driver = makeFakeDriver("codex");

  const layer = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
  });

  await run(
    layer,
    Effect.gen(function* () {
      const sessionId = SessionId.make("s-user-turns");
      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
      const workspace = [...(yield* waitFor((m) => m.workspaces.size > 0)).workspaces.values()][0]!;
      yield* dispatch(
        Command.cases.StartSession.make({
          sessionId,
          workspaceId: workspace.id,
          harness: "codex",
          placement: SessionPlacement.cases.InPlace.make({}),
          permissionMode: "supervised",
          model: null,
          effort: null,
          prompt: "go",
          attachments: [],
        })
      );
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
      const harness = driver.latest(sessionId)!;
      const first = harness.turns[0]!.turnId;

      harness.emit(
        reply(first, "m1", "A first **draft**."),
        reply(first, "m2", "## Done\n\nAll [tests](https://ci.example/run) pass."),
        ended(first)
      );
      const idle = yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
      const firstStarted = idle.sessions.get(sessionId)!.turns[0]!.startedAt;

      // The Harness reports background work on its own: a continuation of user Turn 1.
      const auto = TurnId.make("auto-1");
      const trigger = TurnTrigger.cases.BackgroundTasksReported.make({ tasks: [] });
      harness.emit(
        HarnessEvent.TurnStarted({ turnId: auto, prompt: null, trigger }),
        reply(auto, "m3", "The `build` finished."),
        ended(auto)
      );
      yield* waitFor(
        (m) => m.sessions.get(sessionId)?.turns.find((t) => t.id === auto)?.status === "completed"
      );

      expect(yield* hostSummary(sessionId)).toMatchObject({
        currentUserTurn: { turnId: first, number: 1, startedAt: firstStarted },
        lastReplyPreview: "The build finished.",
      });

      yield* dispatch(Command.cases.SendTurn.make({ sessionId, prompt: "next", attachments: [] }));
      const working = yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
      const next = working.sessions.get(sessionId)!.turns.at(-1)!;

      expect(yield* hostSummary(sessionId)).toMatchObject({
        currentUserTurn: { turnId: next.id, number: 2, startedAt: next.startedAt },
        lastReplyPreview: "The build finished.",
      });

      harness.emit(ended(next.id));
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");

      expect(yield* hostTurnEvents).toEqual([
        ["TurnStarted", 1, null],
        ["TurnEnded", 1, "Done All tests pass."],
        ["TurnStarted", 1, null],
        ["TurnEnded", 1, "The build finished."],
        ["TurnStarted", 2, null],
        ["TurnEnded", 2, null],
      ]);
      expect((yield* hostSummary(sessionId)).lastReplyPreview).toBeNull();
    })
  );
});
