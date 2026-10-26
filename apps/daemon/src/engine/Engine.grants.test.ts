import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  Actor,
  Command,
  type Grant,
  PairingId,
  NotGranted,
  type PermissionMode,
  SessionId,
  SessionPlacement,
} from "@polaris/protocol";
import { Deferred, Effect, Fiber, Match, Result } from "effect";
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
  waitUntil,
} from "./testing.ts";

const actor = Actor.cases.Extension.make({
  pairingId: PairingId.make("pair-turn"),
  name: "Turn sender",
});

const sessionId = SessionId.make("s-grants");

const commandFor = {
  SendTurn: () => Command.cases.SendTurn.make({ sessionId, prompt: "Next", attachments: [] }),
  Steer: () => Command.cases.Steer.make({ sessionId, text: "Next" }),
  Continue: () => Command.cases.Continue.make({ sessionId }),
  Retry: () => Command.cases.Retry.make({ sessionId }),
};

type TurnCommand = keyof typeof commandFor;

const commands: ReadonlyArray<TurnCommand> = ["SendTurn", "Steer", "Continue", "Retry"];

const dispatch = (command: Command, extensionGrant: Grant | null = null) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({
      commandId: cid(),
      command,
      deviceLabel: "test",
      extensionGrant,
      actor: extensionGrant === null ? Actor.cases.Client.make({}) : actor,
    })
  );

const start = (permissionMode: PermissionMode) =>
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
        permissionMode,
        model: null,
        effort: null,
        prompt: "Initial",
        attachments: [],
      })
    );
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
  });

const prepare = (driver: ReturnType<typeof makeFakeDriver>, tag: TurnCommand) =>
  Effect.gen(function* () {
    const harness = driver.latest(sessionId)!;
    const turnId = harness.turns[0]!.turnId;
    harness.emit(HarnessEvent.CursorAssigned({ cursor: "cursor-grants" }));
    yield* Match.value(tag).pipe(
      Match.when("Steer", () => Effect.void),
      Match.when("Retry", () =>
        Effect.sync(() => harness.emit(HarnessEvent.Exited({ error: "test failure" })))
      ),
      Match.orElse(() =>
        Effect.sync(() =>
          harness.emit(
            HarnessEvent.TurnEnded({
              turnId,
              status: tag === "Continue" ? "interrupted" : "completed",
              error: null,
            })
          )
        )
      )
    );
    yield* waitFor(
      (m) =>
        m.sessions.get(sessionId)?.session.state ===
        Match.value(tag).pipe(
          Match.when("Steer", () => "working"),
          Match.when("Retry", () => "failed"),
          Match.orElse(() => "idle")
        )
    );
  });

const reachesHarness = (driver: ReturnType<typeof makeFakeDriver>, tag: TurnCommand) =>
  waitUntil(() =>
    tag === "Steer"
      ? driver.latest(sessionId)!.steers.includes("Next")
      : driver.sessions.reduce((n, s) => n + s.turns.length, 0) === 2
  );

for (const tag of commands) {
  for (const permissionMode of ["auto", "full-access"] as const) {
    test(`${tag} into ${permissionMode} requires approve as well as turn`, async () => {
      const driver = makeFakeDriver("codex", { steer: true });

      const layer = engineLayer({
        filename: join(tempDir(), "state.sqlite"),
        fakes: makeFakes(),
        drivers: [driver],
      });

      await Effect.runPromise(
        Effect.gen(function* () {
          yield* start(permissionMode);
          yield* prepare(driver, tag);
          const store = yield* EventStore;
          const before = yield* store.model;
          const result = yield* Effect.result(dispatch(commandFor[tag](), ["turn"]));
          expect(result).toEqual(
            Result.fail(new NotGranted({ what: `dispatch:${tag}`, needed: "approve" }))
          );
          expect((yield* store.model).sequence).toBe(before.sequence);
          expect(driver.sessions.flatMap((s) => s.turns)).toHaveLength(1);
          expect(driver.latest(sessionId)!.steers).toEqual([]);
          yield* dispatch(commandFor[tag](), ["turn", "approve"]);
          yield* reachesHarness(driver, tag);
        }).pipe(Effect.provide(layer))
      );
    });
  }

  test(`${tag} into supervised remains available with turn alone`, async () => {
    const driver = makeFakeDriver("codex", { steer: true });

    const layer = engineLayer({
      filename: join(tempDir(), "state.sqlite"),
      fakes: makeFakes(),
      drivers: [driver],
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* start("supervised");
        yield* prepare(driver, tag);
        yield* dispatch(commandFor[tag](), ["turn"]);
        yield* reachesHarness(driver, tag);
      }).pipe(Effect.provide(layer))
    );
  });
}

test("a queued Turn checks the mode at its commit decision", async () => {
  const driver = makeFakeDriver("codex");
  const waiting = Effect.runSync(Deferred.make<void>());
  const release = Effect.runSync(Deferred.make<void>());
  const commandId = cid("held");

  const layer = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes: makeFakes(),
    drivers: [driver],
    wrapStore: (store) => ({
      ...store,
      commit: (options) =>
        options.commandId === commandId
          ? Deferred.succeed(waiting, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(store.commit(options))
            )
          : store.commit(options),
    }),
  });

  await Effect.runPromise(
    Effect.gen(function* () {
      yield* start("supervised");
      yield* prepare(driver, "SendTurn");
      const engine = yield* Engine;

      const pending = yield* Effect.forkChild(
        Effect.result(
          engine.dispatch({
            commandId,
            command: commandFor.SendTurn(),
            deviceLabel: "test",
            actor,
            extensionGrant: ["turn"],
          })
        )
      );

      yield* Deferred.await(waiting);
      yield* dispatch(
        Command.cases.SetPermissionMode.make({ sessionId, permissionMode: "full-access" })
      );
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(pending)).toEqual(
        Result.fail(new NotGranted({ what: "dispatch:SendTurn", needed: "approve" }))
      );
      yield* dispatch(
        Command.cases.SetPermissionMode.make({ sessionId, permissionMode: "supervised" })
      );

      const replay = yield* Effect.result(
        engine.dispatch({
          commandId,
          command: commandFor.SendTurn(),
          deviceLabel: "test",
          actor,
          extensionGrant: ["turn"],
        })
      );

      expect(replay).toEqual(
        Result.fail(new NotGranted({ what: "dispatch:SendTurn", needed: "approve" }))
      );
      yield* dispatch(commandFor.SendTurn(), ["turn"]);
      yield* reachesHarness(driver, "SendTurn");
    }).pipe(Effect.provide(layer))
  );
});
