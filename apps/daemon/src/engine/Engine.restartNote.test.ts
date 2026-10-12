import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  BackgroundTask,
  Command,
  SessionId,
  SessionPlacement,
  type TurnId,
} from "@polaris/protocol";
import { Effect, type Layer } from "effect";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { EventStore } from "../store/EventStore.ts";
import { CONTINUE_PROMPT } from "./decider.ts";
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
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

test("Continue after a Daemon restart tells the agent which background work was stopped", async () => {
  const fakes = makeFakes();
  const filename = join(tempDir(), "state.sqlite");
  const sessionId = SessionId.make("s-restart-note");
  let turnId: TurnId | undefined;

  const before = makeFakeDriver("claude");
  await run(
    engineLayer({ filename, fakes, drivers: [before] }),
    Effect.gen(function* () {
      const repo = fakeRepo();
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
          prompt: "Run the dev server and fix the build",
          attachments: [],
        })
      );
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
      const harness = before.latest(sessionId)!;
      turnId = harness.turns[0]!.turnId;
      harness.emit(
        HarnessEvent.CursorAssigned({ cursor: "c-restart" }),
        HarnessEvent.BackgroundTasksChanged({
          tasks: [new BackgroundTask({ id: "shell-1", kind: "command", description: "bun dev" })],
        })
      );
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.backgroundTasks.length === 1);
    })
  );

  const after = makeFakeDriver("claude");
  await run(
    engineLayer({ filename, fakes, drivers: [after] }),
    Effect.gen(function* () {
      const record = (yield* (yield* EventStore).model).sessions.get(sessionId)!;
      // The rule stays: Needs You; nothing continues on its own.
      expect(record.session.state).toBe("needs-you");
      expect(after.sessions).toHaveLength(0);

      yield* dispatch(Command.cases.Continue.make({ sessionId }));
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
      expect(after.latest(sessionId)!.turns[0]).toMatchObject({
        turnId,
        prompt: [
          CONTINUE_PROMPT,
          "",
          "The Polaris Daemon restarted, so this background work was stopped. It will not report back:",
          "- command: bun dev",
          "Start again whatever you still need; do not wait for it.",
        ].join("\n"),
      });
    })
  );
});
