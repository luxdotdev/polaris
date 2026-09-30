import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement, type WorkspaceId } from "@polaris/protocol";
import { Duration, Effect, Layer } from "effect";
import { Engine } from "../engine/Engine.ts";
import {
  cid,
  engineLayer,
  fakeRepo,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "../engine/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import { workingTurn } from "../store/model.ts";
import { releaseWhenQuiet } from "./release.ts";

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

describe("releaseWhenQuiet", () => {
  test("releases once, after the last Turn in flight ends and the Daemon stays quiet", async () => {
    const claude = makeFakeDriver("claude");
    let releases = 0;

    const release = releaseWhenQuiet({
      quietAfter: Duration.millis(80),
      release: Effect.sync(() => releases++),
    });

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

      const end = (sessionId: SessionId) => {
        const turnId = workingTurn(model.sessions.get(sessionId)!)!.id;
        claude
          .latest(sessionId)!
          .emit(HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }));
      };

      // One Turn ends while the other still runs: not quiet.
      end(a);
      yield* waitFor((m) => m.sessions.get(a)?.session.state === "idle");
      yield* Effect.sleep(Duration.millis(200));
      expect(releases).toBe(0);

      end(b);
      yield* waitFor((m) => m.sessions.get(b)?.session.state === "idle");
      yield* Effect.sleep(Duration.millis(200));
      expect(releases).toBe(1);

      // Quiet stays quiet: no timer wakes an idle Daemon.
      yield* Effect.sleep(Duration.millis(300));
      expect(releases).toBe(1);
    });

    await Effect.runPromise(program.pipe(Effect.provide(layer)));
  });
});
