import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  CommandId,
  DomainEvent,
  SessionId,
  SessionPlacement,
  TurnId,
  TurnItem,
  TurnTrigger,
  WorktreeSetupRun,
  ConstellationId,
  TaskId,
} from "@polaris/protocol";
import { Deferred, Duration, Effect, Fiber, Layer, Stream } from "effect";
import { Checkpoints } from "../services.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore, LiveItem } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import { decideSession } from "./session.ts";
import { abstractEvent } from "../verification/engine.reference.testing.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
  waitUntil,
  type FakeDriver,
} from "./testing.ts";

const S = SessionId.make("s1");

const AUTO = TurnId.make("native-input");

const commands: Record<string, { device: string; command: Command }> = {};

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) => {
    const commandId = CommandId.make(
      Command.guards.StartSession(command) ? `setup-s1-${cid()}` : cid()
    );

    commands[commandId] = { device: "mac", command };

    return engine.dispatch({ commandId, command, deviceLabel: "test" });
  });

const trace = (store: EventStore["Service"], label: string) =>
  Effect.gen(function* () {
    const directory = process.env.POLARIS_TRACE_DIR;

    if (directory === undefined) return;
    const model = yield* store.model;
    const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: S });
    yield* Effect.promise(() =>
      Bun.write(
        join(directory, `deferred-${label}.json`),
        JSON.stringify({
          log: events.map(abstractEvent),
          commands,
          restarts: [],
        })
      )
    );
  });

const send = (prompt: string) =>
  dispatch(Command.cases.SendTurn.make({ sessionId: S, prompt, attachments: [] }));

const ended = (turnId: TurnId) =>
  HarnessEvent.TurnEnded({ turnId, status: "completed", error: null });

const startAutonomous = (driver: FakeDriver) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
    const model = yield* waitFor((m) => m.workspaces.size > 0);
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId: S,
        workspaceId: [...model.workspaces.keys()][0]!,
        harness: "codex",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "go",
        attachments: [],
      })
    );
    yield* waitUntil(() => driver.latest(S)?.turns.length === 1);
    const harness = driver.latest(S)!;
    harness.emit(ended(harness.turns[0]!.turnId));
    yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
    harness.emit(
      HarnessEvent.TurnStarted({
        turnId: AUTO,
        prompt: null,
        trigger: TurnTrigger.cases.BackgroundTasksReported.make({ tasks: [] }),
      })
    );
    yield* waitFor((m) => m.sessions.get(S)?.turns.some((t) => t.id === AUTO) === true);

    return harness;
  });

test("filtered wait survives unrelated traffic; Interrupt runs while the native end is pending", async () => {
  const driver = makeFakeDriver("codex", { onInterrupt: () => [ended(AUTO)] });
  let attempts = 0;
  const open = driver.driver.open;

  const declining = {
    ...driver,
    driver: {
      ...driver.driver,
      open: (options: Parameters<typeof open>[0]) =>
        open(options).pipe(
          Effect.map((session) => ({
            ...session,
            steerTurn: () =>
              Effect.sync(() => {
                attempts++;

                return false;
              }),
          }))
        ),
    },
  };

  await Effect.runPromise(
    Effect.gen(function* () {
      const store = yield* EventStore;
      const harness = yield* startAutonomous(driver);
      const subscribers = yield* store.subscriberCount;
      yield* send("next");
      yield* waitUntil(() => attempts === 1);
      yield* store.subscriberCount.pipe(
        Effect.repeat({ until: (count) => count === subscribers + 1 })
      );
      yield* store.commit({
        commandId: null,
        decide: () =>
          Effect.succeed(
            Array.from({ length: 5000 }, (_, i) =>
              DomainEvent.cases.TurnItemCompleted.make({
                sessionId: S,
                turnId: AUTO,
                subagentId: null,
                item: TurnItem.cases.AssistantMessage.make({
                  id: `traffic:${i}`,
                  text: "progress",
                }),
              })
            )
          ),
      });

      for (let i = 0; i < 5000; i++)
        yield* store.publishEphemeral(
          LiveItem.Delta({
            sessionId: S,
            turnId: AUTO,
            itemId: "delta",
            subagentId: null,
            field: "text",
            text: "x",
          })
        );
      harness.emit(ended(TurnId.make("unrelated")));
      yield* Effect.sleep(Duration.millis(20));
      expect(yield* store.subscriberCount).toBe(subscribers + 1);
      expect(attempts).toBe(1);
      expect(harness.turns).toHaveLength(1);
      yield* dispatch(Command.cases.Interrupt.make({ sessionId: S }));
      yield* waitUntil(() => harness.interrupts === 1);
      yield* waitUntil(() => harness.turns.length === 2);
      expect(harness.turns[1]!.prompt).toBe("next");
      expect(harness.turns[1]!.turnId).not.toBe(AUTO);
      harness.emit(ended(harness.turns[1]!.turnId));
      yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
    }).pipe(
      Effect.timeout(Duration.seconds(5)),
      Effect.provide(
        engineLayer({
          filename: join(tempDir(), "state.sqlite"),
          fakes: makeFakes(),
          drivers: [declining],
          subscriberCapacity: 8,
        })
      )
    )
  );
});

test.each(["archived", "setup"])(
  "a queued input refused by %s is recorded and streamed",
  async (state) => {
    const entered = Deferred.makeUnsafe<void>();
    const release = Deferred.makeUnsafe<void>();
    const driver = makeFakeDriver("codex");

    const checkpoints = Layer.succeed(Checkpoints)({
      capture: ({ turnId, label }) =>
        turnId === AUTO && label === "before"
          ? Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(null)
            )
          : Effect.succeed(null),
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* EventStore;
        const harness = yield* startAutonomous(driver);
        const subscribers = yield* store.subscriberCount;
        yield* send("keep this prompt");
        yield* Deferred.await(entered);
        expect(yield* store.subscriberCount).toBe(subscribers);
        const live = yield* store.subscribe({ sessionId: S });
        const streamed: Array<LiveItem> = [];

        const consumer = yield* live.pipe(
          Stream.runForEach((item) =>
            Effect.sync(() => {
              streamed.push(item);
            })
          ),
          Effect.forkChild
        );

        harness.emit(ended(AUTO));
        yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");

        if (state === "archived")
          yield* dispatch(
            Command.cases.ArchiveSession.make({ sessionId: S, deleteMergedBranch: false })
          );
        else
          yield* store.commit({
            commandId: null,
            decide: (model) =>
              Effect.succeed(
                decideSession(model.sessions.get(S), {
                  type: "session.setup",
                  setup: WorktreeSetupRun.make({
                    id: "setup",
                    constellationId: ConstellationId.make("c"),
                    taskId: TaskId.make("A"),
                    command: "bun install",
                    cwd: "/tmp",
                    status: "running",
                    output: "",
                    exitCode: null,
                    startedAt: "2026-10-03T00:00:00.000Z",
                    endedAt: null,
                  }),
                }).events
              ),
          });
        yield* Deferred.succeed(release, undefined);
        yield* waitUntil(() => harness.closed || state === "setup");
        const model = yield* store.model;
        const record = model.sessions.get(S)!;
        const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: S });
        // Wait for the asynchronous delivery lane's durable refusal, not a synchronous fake Turn.
        let items = events.filter((e) => DomainEvent.guards.TurnItemCompleted(e.event));

        while (items.length < 2) {
          yield* Effect.sleep(Duration.millis(5));
          const current = yield* store.model;
          items = (yield* store.readEvents({
            after: 0,
            upTo: current.sequence,
            sessionId: S,
          })).filter((e) => DomainEvent.guards.TurnItemCompleted(e.event));
        }

        const recordedItems = items.flatMap((envelope) =>
          DomainEvent.guards.TurnItemCompleted(envelope.event) ? [envelope.event] : []
        );

        expect(recordedItems.map((event) => event.turnId)).toEqual([AUTO, AUTO]);
        expect(
          recordedItems.flatMap((event) =>
            TurnItem.guards.UserMessage(event.item) ? [event.item.text] : []
          )
        ).toEqual(["keep this prompt"]);

        const errors = recordedItems.flatMap((event) =>
          TurnItem.guards.Error(event.item) ? [event.item.message] : []
        );

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(state === "archived" ? "Archived" : "setup is still running");
        expect(record.turns).toHaveLength(2);
        expect(harness.turns).toHaveLength(1);
        yield* waitUntil(
          () =>
            streamed.filter(
              (item) =>
                LiveItem.$is("Event")(item) &&
                DomainEvent.guards.TurnItemCompleted(item.envelope.event)
            ).length === 2
        );
        yield* Fiber.interrupt(consumer);
        yield* trace(store, state);
      }).pipe(
        Effect.scoped,
        Effect.timeout(Duration.seconds(5)),
        Effect.ensuring(Deferred.succeed(release, undefined)),
        Effect.provide(
          engineLayer({
            filename: join(tempDir(), "state.sqlite"),
            fakes: makeFakes(),
            drivers: [driver],
            checkpoints,
          })
        )
      )
    );
  }
);

test("a second accepted prompt waits after successful steering and gets its own user Turn", async () => {
  const driver = makeFakeDriver("codex");

  await Effect.runPromise(
    Effect.gen(function* () {
      const harness = yield* startAutonomous(driver);
      yield* send("first");
      yield* waitUntil(() => harness.turns.length === 2);
      yield* send("second");
      yield* Effect.sleep(Duration.millis(20));
      expect(harness.turns.map((turn) => turn.prompt)).toEqual(["go", "first"]);
      expect(harness.turns[1]!.turnId).toBe(AUTO);
      harness.emit(ended(AUTO));
      yield* waitUntil(() => harness.turns.length === 3);
      expect(harness.turns[2]!.prompt).toBe("second");
      expect(harness.turns[2]!.turnId).not.toBe(AUTO);
      harness.emit(ended(harness.turns[2]!.turnId));
      const model = yield* waitFor((m) => m.sessions.get(S)?.session.state === "idle");
      expect(model.sessions.get(S)!.turns.at(-1)?.trigger).toBeNull();
      yield* trace(yield* EventStore, "ordered");
    }).pipe(
      Effect.timeout(Duration.seconds(5)),
      Effect.provide(
        engineLayer({
          filename: join(tempDir(), "state.sqlite"),
          fakes: makeFakes(),
          drivers: [driver],
        })
      )
    )
  );
});
