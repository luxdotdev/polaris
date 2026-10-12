import { expect, test } from "bun:test";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement, type TurnId } from "@polaris/protocol";
import { Effect, type Layer, Predicate } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { CONTINUE_PROMPT } from "./decider.ts";
import { Engine } from "./Engine.ts";
import { RESUME_DEVICE } from "./limitResume.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  type FakeDriver,
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
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const SESSION = SessionId.make("s-limited");

/** A session whose first Turn the Harness ended at a usage limit. */
const limitedSession = (driver: FakeDriver, limit: { resetsAt: string | null } | undefined) =>
  Effect.gen(function* () {
    const repo = fakeRepo();
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
    const workspace = [...model.workspaces.values()].find((w) => w.path === repo)!;
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId: SESSION,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "Refactor the parser",
        attachments: [],
      })
    );
    yield* waitFor((m) => m.sessions.get(SESSION)?.session.state === "working");
    const harness = driver.latest(SESSION)!;
    const turnId: TurnId = harness.turns[0]!.turnId;
    harness.emit(
      HarnessEvent.TurnEnded({
        turnId,
        status: "failed",
        error: "You've hit your limit · resets 2pm",
        limit,
      })
    );

    return turnId;
  });

const soon = () => new Date(Date.now() + 150).toISOString();

test("a usage limit leaves the session Limited, with the reset time; nothing resumes by default", async () => {
  const driver = makeFakeDriver("claude");
  const resetsAt = soon();
  const filename = join(tempDir(), "state.sqlite");
  await run(
    engineLayer({ filename, fakes: makeFakes(), drivers: [driver] }),
    Effect.gen(function* () {
      yield* limitedSession(driver, { resetsAt });
      const model = yield* waitFor((m) => m.sessions.get(SESSION)?.session.state === "limited");
      const record = model.sessions.get(SESSION)!;
      expect(record.session.limitResetsAt).toBe(resetsAt);
      expect(record.session.resumeAtReset).toBe(false);
      expect(record.turns.at(-1)?.status).toBe("interrupted");
      yield* Effect.sleep("400 millis");
      expect((yield* (yield* EventStore).model).sessions.get(SESSION)!.session.state).toBe(
        "limited"
      );
      expect(driver.latest(SESSION)!.turns).toHaveLength(1);
    })
  );
});

test("the Harness's words alone are enough: no hint still reads as a usage limit", async () => {
  const driver = makeFakeDriver("claude");
  await run(
    engineLayer({ filename: join(tempDir(), "s.sqlite"), fakes: makeFakes(), drivers: [driver] }),
    Effect.gen(function* () {
      yield* limitedSession(driver, undefined);
      const model = yield* waitFor((m) => m.sessions.get(SESSION)?.session.state === "limited");
      expect(model.sessions.get(SESSION)!.session.limitResetsAt).toBeNull();
    })
  );
});

test("Resume at reset continues the same Turn at the reset, and a restart re-arms it", async () => {
  const fakes = makeFakes();
  const filename = join(tempDir(), "state.sqlite");
  const before = makeFakeDriver("claude");
  const resetsAt = new Date(Date.now() + 1500).toISOString();
  let turnId: TurnId | undefined;

  await run(
    engineLayer({ filename, fakes, drivers: [before] }),
    Effect.gen(function* () {
      turnId = yield* limitedSession(before, { resetsAt });
      yield* waitFor((m) => m.sessions.get(SESSION)?.session.state === "limited");
      yield* dispatch(
        Command.cases.SetResumeAtReset.make({ sessionId: SESSION, resumeAtReset: true })
      );
      yield* waitFor((m) => m.sessions.get(SESSION)?.session.resumeAtReset === true);
      // The Daemon stops here, before the reset.
    })
  );

  const after = makeFakeDriver("claude");
  await run(
    engineLayer({ filename, fakes, drivers: [after] }),
    Effect.gen(function* () {
      expect((yield* (yield* EventStore).model).sessions.get(SESSION)!.session.state).toBe(
        "limited"
      );
      yield* waitFor((m) => m.sessions.get(SESSION)?.session.state === "working");
      expect(Date.now()).toBeGreaterThanOrEqual(Date.parse(resetsAt));
      expect(after.latest(SESSION)!.turns[0]).toMatchObject({ turnId, prompt: CONTINUE_PROMPT });

      const events = yield* (yield* EventStore).readEvents({
        after: 0,
        upTo: (yield* (yield* EventStore).model).sequence,
        sessionId: SESSION,
      });

      const continued = events.findLast((e) => Predicate.isTagged(e.event, "TurnStarted"));
      expect(continued?.commandId).toStartWith("resume-at-reset:");
      expect(RESUME_DEVICE).toContain("Polaris");
    })
  );
});

test("turning Resume at reset off before the reset cancels it", async () => {
  const driver = makeFakeDriver("claude");
  await run(
    engineLayer({ filename: join(tempDir(), "s.sqlite"), fakes: makeFakes(), drivers: [driver] }),
    Effect.gen(function* () {
      yield* limitedSession(driver, { resetsAt: new Date(Date.now() + 300).toISOString() });
      yield* waitFor((m) => m.sessions.get(SESSION)?.session.state === "limited");
      yield* dispatch(
        Command.cases.SetResumeAtReset.make({ sessionId: SESSION, resumeAtReset: true })
      );
      yield* dispatch(
        Command.cases.SetResumeAtReset.make({ sessionId: SESSION, resumeAtReset: false })
      );
      yield* Effect.sleep("600 millis");
      expect((yield* (yield* EventStore).model).sessions.get(SESSION)!.session.state).toBe(
        "limited"
      );
    })
  );
});
