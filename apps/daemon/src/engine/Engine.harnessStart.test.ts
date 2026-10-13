/** A Harness that never opens, or crashes opening, fails its session instead of leaving it Starting. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement } from "@polaris/protocol";
import { Duration, Effect, Layer } from "effect";
import type { HarnessDriver } from "../harness/HarnessDriver.ts";
import { Checkpoints } from "../services.ts";
import type { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import { shortHostName } from "../service/hostName.ts";
import {
  cid,
  engineLayer,
  type FakeDriver,
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

const withOpen = (fake: FakeDriver, open: HarnessDriver["open"]): FakeDriver => ({
  ...fake,
  driver: { ...fake.driver, open },
});

const startAndFail = (
  driver: FakeDriver,
  sessionId: SessionId,
  checkpoints?: Layer.Layer<Checkpoints>
) => {
  const options = {
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
    harnessStartTimeout: Duration.millis(50),
  };

  return run(
    engineLayer(checkpoints === undefined ? options : { ...options, checkpoints }),
    Effect.gen(function* () {
      const repo = fakeRepo();
      yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
      const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));
      const workspace = [...model.workspaces.values()].find((w) => w.path === repo)!;
      yield* dispatch(
        Command.cases.StartSession.make({
          sessionId,
          workspaceId: workspace.id,
          harness: "codex",
          placement: SessionPlacement.cases.InPlace.make({}),
          permissionMode: "supervised",
          model: null,
          effort: null,
          prompt: "Fix the flaky test",
          attachments: [],
        })
      );
      const failed = yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "failed");

      return failed.sessions.get(sessionId)!;
    })
  );
};

test("a Harness that never finishes opening fails the start with a line naming it and the Host", async () => {
  const record = await startAndFail(
    withOpen(makeFakeDriver("codex"), () => Effect.never),
    SessionId.make("s-never-opens")
  );

  expect(record.session.lastError).toBe(
    `Codex didn't start on ${shortHostName()} after 0 seconds. Check that \`codex --version\` runs there, then retry.`
  );
  expect(record.turns[0]!.status).toBe("failed");
});

test("a Harness that crashes while opening fails the start instead of hanging", async () => {
  const record = await startAndFail(
    withOpen(makeFakeDriver("codex"), () => Effect.die(new Error("spawn codex ENOENT"))),
    SessionId.make("s-open-dies")
  );

  expect(record.session.lastError).toBe(
    `Codex couldn't start on ${shortHostName()}: spawn codex ENOENT`
  );
});

test("a crash before the Harness opens fails the start instead of leaving it Starting", async () => {
  const record = await startAndFail(
    makeFakeDriver("codex"),
    SessionId.make("s-checkpoint-dies"),
    Layer.succeed(Checkpoints)({ capture: () => Effect.die(new Error("git: index.lock exists")) })
  );

  expect(record.session.lastError).toBe("The session couldn't start: git: index.lock exists");
});
