import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement, type WorkspaceId } from "@polaris/protocol";
import { Clock, Duration, Effect, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
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
import { workingTurn } from "../store/model.ts";
import { QUIET_AFTER, releaseWhenQuiet } from "./release.ts";

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const start = (workspaceId: WorkspaceId, sessionId: SessionId) =>
  dispatch(
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

/** A TestClock that notes each timed sleep started on it, in milliseconds. */
const recordingClock = () => {
  const clock = Effect.runSync(
    TestClock.make().pipe(Effect.provideService(Scope.Scope, Scope.makeUnsafe()))
  );

  const sleeps: Array<number> = [];

  const recorded: TestClock.TestClock = {
    ...clock,
    sleep: (duration) => {
      // A zero sleep is a yield: the debounce polls with them while the clock stands still.
      if (Duration.toMillis(duration) > 0) sleeps.push(Duration.toMillis(duration));

      return clock.sleep(duration);
    },
  };

  return { clock: recorded, sleeps };
};

describe("releaseWhenQuiet", () => {
  test("releases once, after the last Turn in flight ends and the Daemon stays quiet", async () => {
    const claude = makeFakeDriver("claude");
    const { clock, sleeps } = recordingClock();
    const quietMs = Duration.toMillis(QUIET_AFTER);
    // When each release ran, on the quiet timer's clock.
    const releases: Array<number> = [];

    const release = releaseWhenQuiet({
      release: Effect.sync(() => void releases.push(clock.currentTimeMillisUnsafe())),
    }).pipe(Layer.provide(Layer.succeed(Clock.Clock)(clock)));

    const engine = engineLayer({
      filename: join(tempDir(), "state.sqlite"),
      fakes: makeFakes(),
      drivers: [claude],
    });

    const layer = Layer.provideMerge(release, engine);

    const program = Effect.gen(function* () {
      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: fakeRepo(), name: null }));
      const workspace = [...(yield* waitFor((m) => m.workspaces.size > 0)).workspaces.values()][0]!;
      const a = SessionId.make("s-a");
      const b = SessionId.make("s-b");
      yield* start(workspace.id, a);
      yield* start(workspace.id, b);

      const model = yield* waitFor((m) =>
        [a, b].every((s) => m.sessions.get(s)?.session.state === "working")
      );

      /** Ends the session's Turn, waits for its quiet timer and lets it run out. */
      const endThenQuiet = (sessionId: SessionId, timers: number) =>
        Effect.gen(function* () {
          const turnId = workingTurn(model.sessions.get(sessionId)!)!.id;
          claude
            .latest(sessionId)!
            .emit(HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }));
          yield* waitUntil(() => sleeps.length === timers);
          yield* clock.adjust(QUIET_AFTER);
        });

      // One Turn ends while the other still runs: not quiet, so its timer releases nothing.
      yield* endThenQuiet(a, 1);
      yield* endThenQuiet(b, 2);
      yield* waitUntil(() => releases.length > 0);
      expect(releases).toEqual([2 * quietMs]);

      // Quiet stays quiet: no timer wakes an idle Daemon.
      yield* clock.adjust(Duration.hours(1));
      expect(sleeps).toEqual([quietMs, quietMs]);
      expect(releases).toHaveLength(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });
});
