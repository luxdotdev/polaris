import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  IdleCompactionSettings,
  RequestId,
  SessionId,
  SessionPlacement,
  TurnItem,
} from "@polaris/protocol";
import { Clock, Effect, Layer, Predicate, Scope } from "effect";
import { TestClock } from "effect/testing";
import { HarnessEvent, type TurnInput } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import type { ReadModel } from "../store/model.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  type FakeDriver,
  type FakeHarnessSession,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

type Env = Engine | EventStore;

const MIN = 60_000;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

/** The test's clock: commands run on it, so their stamps and the timers they start agree. */
let engineClock: TestClock.TestClock | null = null;

const onEngineClock = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  engineClock === null ? effect : Effect.provideService(effect, Clock.Clock, engineClock);

const dispatch = (command: Command) =>
  onEngineClock(
    Effect.flatMap(Engine, (engine) =>
      engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
    )
  );

/** Prompts that leave the window small; every other Turn leaves 250k tokens in it. */
const SMALL = "Rename one variable";

/** Prompts the Harness takes up and never ends; one asks for approval first. */
const HANGS = "Run the whole suite";

const ASKS = "Delete the build folder";

const turnEvents = (input: TurnInput): ReadonlyArray<HarnessEvent> => {
  const { turnId, prompt } = input;

  // A summary that still holds more than the threshold: only the Turn itself stops a repeat.
  if (prompt === "/compact")
    return [
      HarnessEvent.TurnStarted({ turnId, prompt }),
      HarnessEvent.ContextUsed({
        usedTokens: 210_000,
        windowTokens: 1_000_000,
        compacted: { trigger: "manual", beforeTokens: 250_000, afterTokens: 210_000 },
      }),
      HarnessEvent.ItemCompleted({
        turnId,
        item: TurnItem.cases.AssistantMessage.make({ id: `msg-${turnId}`, text: "Compacted." }),
      }),
      HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }),
    ];

  const started = [
    HarnessEvent.CursorAssigned({ cursor: `cursor-${turnId}` }),
    HarnessEvent.TurnStarted({ turnId, prompt }),
    HarnessEvent.ContextUsed({
      usedTokens: prompt === SMALL ? 150_000 : 250_000,
      windowTokens: 1_000_000,
    }),
  ];

  if (prompt === HANGS) return started;

  if (prompt === ASKS)
    return [
      ...started,
      HarnessEvent.ApprovalRequested({
        turnId,
        requestId: RequestId.make(`req-${turnId}`),
        kind: "command",
        title: "rm -rf build",
        detail: null,
        options: [],
      }),
    ];

  return [
    ...started,
    HarnessEvent.ItemCompleted({
      turnId,
      item: TurnItem.cases.AssistantMessage.make({ id: `msg-${turnId}`, text: `re: ${prompt}` }),
    }),
    HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }),
  ];
};

const compactingDriver = () =>
  makeFakeDriver("claude", {
    compact: true,
    onTurn: (input: TurnInput, _session: FakeHarnessSession) => turnEvents(input),
  });

const testClock = () => {
  engineClock = Effect.runSync(
    TestClock.make().pipe(Effect.provideService(Scope.Scope, Scope.makeUnsafe()))
  );

  return engineClock;
};

/** The Engine's timers run on `clock` (starting at 0); the test's own waits stay live. */
const layerFor = (driver: FakeDriver, clock: TestClock.TestClock, filename?: string) =>
  engineLayer({
    filename: filename ?? join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
  }).pipe(Layer.provide(Layer.succeed(Clock.Clock)(clock)));

const compactions = (model: ReadModel, sessionId: SessionId) =>
  model.sessions.get(sessionId)?.turns.filter((turn) => turn.idleCompaction === true) ?? [];

const compacted = (sessionId: SessionId) =>
  waitFor((m) => compactions(m, sessionId).some((turn) => turn.status === "completed"));

/** Long enough on the live clock for a timer that fired to have committed its Turn. */
const settle = Effect.sleep("150 millis");

const currentModel = Effect.flatMap(EventStore, (store) => store.model);

let workspaceRepo: string | null = null;

const startSession = (sessionId: SessionId, prompt: string) =>
  Effect.gen(function* () {
    if (workspaceRepo === null) workspaceRepo = fakeRepo();
    const repo = workspaceRepo;
    const existing = [...(yield* currentModel).workspaces.values()].find((w) => w.path === repo);

    if (existing === undefined)
      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
    const workspace = [...model.workspaces.values()].find((w) => w.path === repo)!;
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt,
        attachments: [],
      })
    );
  });

const idle = (sessionId: SessionId) =>
  waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");

const sendTurn = (sessionId: SessionId, prompt: string) =>
  dispatch(Command.cases.SendTurn.make({ sessionId, prompt, attachments: [] }));

const setSettings = (enabled: boolean) =>
  onEngineClock(
    Effect.flatMap(Engine, (engine) =>
      engine.setIdleCompactionSettings(IdleCompactionSettings.make({ enabled, minTokens: 200_000 }))
    )
  );

const S1 = SessionId.make("s-idle");

const CONTROL = SessionId.make("s-control");

test("55 Idle minutes above the threshold compact the session once, as a quiet Turn", async () => {
  workspaceRepo = null;
  const driver = compactingDriver();
  const clock = testClock();
  await run(
    layerFor(driver, clock),
    Effect.gen(function* () {
      yield* startSession(S1, "Refactor the parser");
      yield* idle(S1);
      yield* clock.adjust(54 * MIN);
      // Dormant since 30 minutes; a compaction reopens its Harness from the cursor.
      yield* waitFor((m) => m.sessions.get(S1)?.session.state === "dormant");
      yield* settle;
      expect(compactions(yield* currentModel, S1)).toHaveLength(0);

      yield* clock.adjust(1 * MIN);
      const model = yield* compacted(S1);
      const record = model.sessions.get(S1)!;
      const [user, compaction] = record.turns;

      expect(compaction).toMatchObject({ prompt: "/compact", userTurnNumber: 1 });
      expect(driver.latest(S1)!.turns.at(-1)?.prompt).toBe("/compact");
      expect(record.session.currentUserTurn?.turnId).toBe(user!.id);
      expect(record.session.lastReplyPreview).toBe("re: Refactor the parser");
      expect(record.session.lastCompaction).toMatchObject({
        beforeTokens: 250_000,
        afterTokens: 210_000,
      });
      yield* waitFor((m) => m.sessions.get(S1)?.session.state === "idle");

      const store = yield* EventStore;
      const events = yield* store.readEvents({ after: 0, upTo: model.sequence, sessionId: S1 });
      const started = events.findLast((e) => Predicate.isTagged(e.event, "TurnStarted"));
      expect(started?.commandId).toStartWith("idle-compaction:");

      // Its own Turn never re-arms it: nothing more however long the session sits.
      yield* clock.adjust(120 * MIN);
      yield* settle;
      expect(compactions(yield* currentModel, S1)).toHaveLength(1);
    })
  );
});

test("a session below the threshold, Working or awaiting an approval is left alone", async () => {
  workspaceRepo = null;
  const small = SessionId.make("s-small");
  const working = SessionId.make("s-working");
  const asking = SessionId.make("s-asking");
  const driver = compactingDriver();
  const clock = testClock();
  await run(
    layerFor(driver, clock),
    Effect.gen(function* () {
      yield* startSession(small, SMALL);
      yield* startSession(working, "Refactor the parser");
      yield* startSession(asking, "Refactor the lexer");
      yield* Effect.forEach([small, working, asking], idle);

      yield* clock.adjust(10 * MIN);
      yield* sendTurn(working, HANGS);
      yield* sendTurn(asking, ASKS);
      yield* waitFor((m) => m.sessions.get(working)?.session.state === "working");
      yield* waitFor((m) => m.sessions.get(asking)?.session.state === "needs-you");

      // Due after all three would have been.
      yield* clock.adjust(1 * MIN);
      yield* startSession(CONTROL, "Refactor the printer");
      yield* idle(CONTROL);
      yield* clock.adjust(56 * MIN);
      yield* compacted(CONTROL);
      yield* settle;

      const model = yield* currentModel;

      for (const sessionId of [small, working, asking])
        expect(compactions(model, sessionId)).toHaveLength(0);
    })
  );
});

test("turned off, nothing compacts; turned back on inside the cache's hour, it does", async () => {
  workspaceRepo = null;
  const driver = compactingDriver();
  const clock = testClock();
  await run(
    layerFor(driver, clock),
    Effect.gen(function* () {
      yield* setSettings(false);
      yield* startSession(S1, "Refactor the parser");
      yield* idle(S1);
      yield* clock.adjust(56 * MIN);
      yield* settle;
      expect(compactions(yield* currentModel, S1)).toHaveLength(0);

      yield* setSettings(true);
      yield* compacted(S1);
    })
  );
});

test("activity re-arms it: the 55 minutes run from the latest Turn's end", async () => {
  workspaceRepo = null;
  const driver = compactingDriver();
  const clock = testClock();
  await run(
    layerFor(driver, clock),
    Effect.gen(function* () {
      yield* startSession(S1, "Refactor the parser");
      yield* idle(S1);
      yield* clock.adjust(40 * MIN);
      yield* sendTurn(S1, "Now the lexer");
      yield* waitFor((m) => m.sessions.get(S1)?.turns.at(-1)?.status === "completed");

      yield* clock.adjust(16 * MIN);
      yield* settle;
      expect(compactions(yield* currentModel, S1)).toHaveLength(0);

      yield* clock.adjust(39 * MIN);
      const model = yield* compacted(S1);
      expect(model.sessions.get(S1)!.turns.map((t) => t.prompt)).toEqual([
        "Refactor the parser",
        "Now the lexer",
        "/compact",
      ]);
    })
  );
});

test("a Daemon restart before it is due re-arms it from the log", async () => {
  workspaceRepo = null;
  const filename = join(tempDir(), "state.sqlite");
  const before = compactingDriver();

  await run(
    layerFor(before, testClock(), filename),
    Effect.gen(function* () {
      yield* startSession(S1, "Refactor the parser");
      yield* idle(S1);
      // The Daemon stops here, minutes after the Turn.
    })
  );

  const after = compactingDriver();
  const clock = testClock();
  await run(
    layerFor(after, clock, filename),
    Effect.gen(function* () {
      yield* clock.adjust(55 * MIN);
      yield* compacted(S1);
      expect(after.latest(S1)!.turns.at(-1)?.prompt).toBe("/compact");
    })
  );
});

test("a Daemon back after the cache's hour leaves the session to its next Turn", async () => {
  workspaceRepo = null;
  const filename = join(tempDir(), "state.sqlite");

  await run(
    layerFor(compactingDriver(), testClock(), filename),
    Effect.gen(function* () {
      yield* startSession(S1, "Refactor the parser");
      yield* idle(S1);
    })
  );

  // Down for 61 minutes: the second Daemon starts with its clock already there.
  const clock = testClock();
  await Effect.runPromise(clock.adjust(61 * MIN));
  await run(
    layerFor(compactingDriver(), clock, filename),
    Effect.gen(function* () {
      yield* startSession(CONTROL, "Refactor the printer");
      yield* idle(CONTROL);
      yield* clock.adjust(55 * MIN);
      yield* compacted(CONTROL);
      yield* settle;
      expect(compactions(yield* currentModel, S1)).toHaveLength(0);
    })
  );
});
