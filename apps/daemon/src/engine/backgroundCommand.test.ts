/** `BackgroundCommand`: refused unless the Turn in flight runs the command; then the live Harness moves it. */
import { expect, test } from "bun:test";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement, TurnItem } from "@polaris/protocol";
import { Effect, Exit } from "effect";
import { makeRepo } from "../git/testing.ts";
import { HarnessEvent } from "../harness/HarnessDriver.ts";
import type { EventStore } from "../store/EventStore.ts";
import { Engine } from "./Engine.ts";
import {
  cid,
  engineLayer,
  type FakeDriver,
  makeFakeDriver,
  makeFakes,
  tempDir,
  waitFor,
} from "./testing.ts";

const sessionId = SessionId.make("s-background");

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const background = (itemId: string | null) =>
  Effect.exit(dispatch(Command.cases.BackgroundCommand.make({ sessionId, itemId })));

const refusal = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? JSON.stringify(exit) : "accepted";

const command = (id: string, status: "running" | "completed") =>
  TurnItem.cases.CommandExecution.make({
    id,
    command: "bun dev",
    cwd: "/repo",
    output: "",
    exitCode: null,
    status,
  });

/** A Claude session whose Turn is working, with `bun dev` (item c1) running in it. */
const withRunningCommand = <A, E>(
  claude: FakeDriver,
  body: (
    emit: (...events: ReadonlyArray<HarnessEvent>) => void
  ) => Effect.Effect<A, E, Engine | EventStore>
) =>
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
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "working");
    const harness = claude.latest(sessionId)!;
    const turnId = harness.turns[0]!.turnId;
    const emit = (...events: ReadonlyArray<HarnessEvent>) => harness.emit(...events);
    const before = yield* background(null);
    const sequence = (yield* waitFor(() => true)).sequence;

    // c0's completion lands after c1's progress, so the engine has seen c1 running.
    emit(
      HarnessEvent.ItemUpdated({ turnId, item: command("c1", "running") }),
      HarnessEvent.ItemCompleted({ turnId, item: command("c0", "completed") })
    );
    yield* waitFor((m) => m.sequence > sequence);

    return { before, after: yield* body(emit) };
  }).pipe(
    Effect.provide(
      engineLayer({
        filename: join(tempDir(), "state.sqlite"),
        fakes: makeFakes(),
        drivers: [claude],
      })
    )
  );

test("a running command moves to the background, by id or all at once", async () => {
  const claude = makeFakeDriver("claude");

  const result = await Effect.runPromise(
    withRunningCommand(claude, (emit) =>
      Effect.gen(function* () {
        const unknown = yield* background("c9");
        const byId = yield* background("c1");
        const all = yield* background(null);
        const moved = claude.latest(sessionId)!.backgrounded;

        while (moved.length < 2) yield* Effect.sleep("2 millis");
        const turnId = claude.latest(sessionId)!.turns[0]!.turnId;
        emit(HarnessEvent.TurnEnded({ turnId, status: "completed", error: null }));
        yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");

        return { unknown, byId, all, moved, ended: yield* background(null) };
      })
    )
  );

  expect(refusal(result.before)).toContain("no command is running");
  expect(refusal(result.after.unknown)).toContain("command c9 is not running");
  expect(Exit.isSuccess(result.after.byId) && Exit.isSuccess(result.after.all)).toBe(true);
  expect(result.after.moved).toEqual(["c1", null]);
  expect(refusal(result.after.ended)).toContain("there is no Turn in flight");
}, 30_000);

test("a Harness that can't run commands in the background is refused, and never asked", async () => {
  const claude = makeFakeDriver("claude", { backgroundCommand: false });

  const result = await Effect.runPromise(withRunningCommand(claude, () => background("c1")));

  expect(refusal(result.after)).toContain("claude cannot run a command in the background");
  expect(claude.latest(sessionId)!.backgrounded).toEqual([]);
}, 30_000);
