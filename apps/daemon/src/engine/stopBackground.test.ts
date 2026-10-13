/** `StopBackgroundTasks`: refused unless the session lists the tasks; then the live Harness stops them. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { BackgroundTask, Command, SessionId, SessionPlacement } from "@polaris/protocol";
import { Effect, Exit } from "effect";
import { makeRepo } from "../git/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  completesTurns,
  engineLayer,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

const sessionId = SessionId.make("s-stop");

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const stop = (taskIds: ReadonlyArray<string> | null) =>
  dispatch(Command.cases.StopBackgroundTasks.make({ sessionId, taskIds }));

const devServer = new BackgroundTask({ id: "cmd1", kind: "command", description: "bun dev" });

test("background work that outlived its Turn can be stopped, by id or all at once", async () => {
  const claude = makeFakeDriver("claude", { onTurn: completesTurns() });

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const repo = yield* Effect.promise(() => makeRepo());
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
          prompt: "start the dev server",
          attachments: [],
        })
      );
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
      const nothing = yield* Effect.exit(stop(null));

      claude.latest(sessionId)!.emit(HarnessEvent.BackgroundTasksChanged({ tasks: [devServer] }));
      yield* waitFor((m) => m.sessions.get(sessionId)?.session.backgroundTasks.length === 1);
      const unknown = yield* Effect.exit(stop(["cmd9"]));
      yield* stop(["cmd1"]);
      yield* stop(null);
      const stopped = claude.latest(sessionId)!.stopped;

      while (stopped.length < 2) yield* Effect.sleep("2 millis");

      return { nothing, unknown, stopped: claude.latest(sessionId)!.stopped };
    }).pipe(
      Effect.provide(
        engineLayer({
          filename: join(tempDir(), "state.sqlite"),
          fakes: makeFakes(),
          drivers: [claude],
        })
      )
    )
  );

  expect(Exit.isFailure(result.nothing)).toBe(true);
  expect(JSON.stringify(result.nothing)).toContain("there is no background work to stop");
  expect(JSON.stringify(result.unknown)).toContain("there is no background task cmd9");
  expect(result.stopped).toEqual(["cmd1", "cmd1"]);
}, 30_000);
