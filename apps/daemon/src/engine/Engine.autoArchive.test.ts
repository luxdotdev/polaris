import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  AgentSession,
  AutoArchiveSettings,
  Command,
  type ConstellationState,
  SessionId,
  SessionPlacement,
  WorkspaceId,
} from "@polaris/protocol";
import { Clock, Duration, Effect, Layer, Predicate } from "effect";
import type { SessionRecord } from "../store/model.ts";
import { EventStore } from "../store/EventStore.ts";
import { type ArchiveView, dueForArchive } from "./autoArchive.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  fakeRepo,
  type FakeDriver,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

type Env = Engine | EventStore;

const DAY_MS = 24 * 60 * 60 * 1000;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

/** The live clock, moved ahead by `skip`: sleeps stay real, so timers and waits run as usual. */
const skippingClock = () => {
  const live = Effect.runSync(
    Effect.gen(function* () {
      return yield* Clock.Clock;
    })
  );

  let offset = 0;
  const now = () => live.currentTimeMillisUnsafe() + offset;
  const nanos = () => BigInt(now()) * 1_000_000n;

  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: now,
    currentTimeMillis: Effect.sync(now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: () => live.monotonicTimeNanosUnsafe(),
    monotonicTimeNanos: live.monotonicTimeNanos,
    sleep: (duration) => live.sleep(duration),
  };

  return {
    clock,
    skip: (duration: Duration.Input) => void (offset += Duration.toMillis(duration)),
  };
};

type Skipping = ReturnType<typeof skippingClock>;

/** Idle sessions go Dormant at once and the sweep runs every few milliseconds, on `time`. */
const archiveLayer = (driver: FakeDriver, time: Skipping, filename: string) =>
  engineLayer({
    filename,
    fakes: makeFakes(),
    drivers: [driver],
    idleTimeout: Duration.millis(10),
    autoArchiveSweepInterval: Duration.millis(10),
  }).pipe(Layer.provide(Layer.succeed(Clock.Clock)(time.clock)));

const runAt = <A, E>(time: Skipping, layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  run(layer, program.pipe(Effect.provideService(Clock.Clock, time.clock)));

const state = (sessionId: SessionId) =>
  Effect.map(
    Effect.flatMap(EventStore, (store) => store.model),
    (model) => model.sessions.get(sessionId)?.session.state
  );

const registerWorkspace = Effect.gen(function* () {
  const repo = fakeRepo();
  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
  const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

  return [...model.workspaces.values()].find((w) => w.path === repo)!.id;
});

/** A session whose one Turn has ended and whose Harness has since stopped. */
const dormantSession = (workspaceId: WorkspaceId, id: string) =>
  Effect.gen(function* () {
    const sessionId = SessionId.make(id);
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "Fix the flaky test",
        attachments: [],
      })
    );
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "dormant");

    return sessionId;
  });

/** Long enough for several sweeps at the test's interval. */
const sweeps = Effect.sleep(Duration.millis(60));

test("a Dormant session is archived after 7 days without activity; pinned and recent ones stay", async () => {
  const time = skippingClock();
  await runAt(
    time,
    archiveLayer(
      makeFakeDriver("claude", { onTurn: completesTurns() }),
      time,
      join(tempDir(), "state.sqlite")
    ),
    Effect.gen(function* () {
      const workspace = yield* registerWorkspace;
      const old = yield* dormantSession(workspace, "s-old");
      const pinned = yield* dormantSession(workspace, "s-pinned");
      yield* dispatch(Command.cases.PinSession.make({ sessionId: pinned, pinned: true }));
      time.skip(Duration.days(6));
      const recent = yield* dormantSession(workspace, "s-recent");
      time.skip(Duration.hours(23));
      yield* sweeps;
      expect(yield* state(old)).toBe("dormant");

      time.skip(Duration.hours(2));
      yield* waitFor((m) => m.sessions.get(old)?.session.state === "archived");
      yield* sweeps;
      expect(yield* state(pinned)).toBe("dormant");
      expect(yield* state(recent)).toBe("dormant");

      const store = yield* EventStore;

      const events = yield* store.readEvents({
        after: 0,
        upTo: (yield* store.model).sequence,
        sessionId: old,
      });

      const archived = events.findLast(
        (e) => Predicate.isTagged(e.event, "SessionStateChanged") && e.event.state === "archived"
      );

      expect(archived?.commandId).toStartWith("auto-archive:");
    })
  );
});

test("a shorter setting archives at once, and Never survives a restart", async () => {
  const filename = join(tempDir(), "state.sqlite");
  const time = skippingClock();

  await runAt(
    time,
    archiveLayer(makeFakeDriver("claude", { onTurn: completesTurns() }), time, filename),
    Effect.gen(function* () {
      const engine = yield* Engine;
      expect((yield* engine.autoArchiveSettings).afterDays).toBe(7);
      const workspace = yield* registerWorkspace;
      const short = yield* dormantSession(workspace, "s-short");
      time.skip(Duration.days(3));
      yield* sweeps;
      expect(yield* state(short)).toBe("dormant");

      yield* engine.setAutoArchiveSettings(AutoArchiveSettings.make({ afterDays: 1 }));
      yield* waitFor((m) => m.sessions.get(short)?.session.state === "archived");

      yield* dormantSession(workspace, "s-kept");
      yield* engine.setAutoArchiveSettings(AutoArchiveSettings.make({ afterDays: null }));
    })
  );

  time.skip(Duration.days(30));
  await runAt(
    time,
    archiveLayer(makeFakeDriver("claude"), time, filename),
    Effect.gen(function* () {
      expect((yield* (yield* Engine).autoArchiveSettings).afterDays).toBeNull();
      yield* sweeps;
      expect(yield* state(SessionId.make("s-kept"))).toBe("dormant");
    })
  );
});

const record = (id: string, patch: Partial<AgentSession> = {}): SessionRecord => ({
  session: AgentSession.make({
    id: SessionId.make(id),
    workspaceId: WorkspaceId.make("w"),
    harness: "claude",
    title: id,
    cwd: "/repo",
    worktreeId: null,
    state: "dormant",
    permissionMode: "supervised",
    model: null,
    effort: null,
    parentSessionId: null,
    forkedFromTurnId: null,
    harnessCursor: null,
    turnCount: 1,
    contextUsage: null,
    lastError: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...patch,
  }),
  titleLocked: false,
  turns: [],
  pending: new Map(),
  subagents: new Map(),
});

const constellation = (state: ConstellationState, lead: string, worker: string) => ({
  graph: {
    state,
    leadSessionId: SessionId.make(lead),
    attempts: [{ sessionId: SessionId.make(worker) }],
  },
});

test("sessions a Constellation still needs, and Reviewer sessions, are never auto-archived", () => {
  const sessions = [
    record("lead"),
    record("worker"),
    record("done-lead"),
    record("done-worker"),
    record("reviewer", { origin: "reviewer" }),
    record("idle", { state: "idle" }),
    record("plain"),
    record("fresh", { updatedAt: new Date(2 * DAY_MS).toISOString() }),
  ];

  const model: ArchiveView = {
    sessions: new Map(sessions.map((r) => [r.session.id, r])),
    constellations: new Map([
      ["open", constellation("running", "lead", "worker")],
      ["done", constellation("completed", "done-lead", "done-worker")],
    ]),
  };

  const due = dueForArchive(model, AutoArchiveSettings.make({ afterDays: 7 }), 8 * DAY_MS);
  expect(due.map((r): string => r.session.id)).toEqual(["done-lead", "done-worker", "plain"]);
});
