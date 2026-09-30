import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  Command,
  SessionId,
  SessionPlacement,
  type Workspace,
  type WorkspaceId,
} from "@polaris/protocol";
import { Effect, type Layer } from "effect";
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

type Env = Engine | EventStore;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const registerWorkspace = Effect.gen(function* () {
  const repo = fakeRepo();
  yield* dispatch(Command.cases.RegisterWorkspace.make({ path: repo, name: null }));
  const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === repo));

  return [...model.workspaces.values()].find((w) => w.path === repo)!;
});

const PROMPT = "Fix the flaky test";

const start = (workspaceId: WorkspaceId, sessionId: SessionId, placement: SessionPlacement) =>
  dispatch(
    Command.cases.StartSession.make({
      sessionId,
      workspaceId,
      harness: "claude",
      placement,
      permissionMode: "supervised",
      model: null,
      effort: null,
      prompt: PROMPT,
      attachments: [],
    })
  );

const setup = () => {
  const claude = makeFakeDriver("claude");
  const fakes = makeFakes();

  const layer = engineLayer({
    filename: join(tempDir(), "state.sqlite"),
    fakes,
    drivers: [claude],
  });

  return { claude, fakes, layer };
};

const inPlace = SessionPlacement.cases.InPlace.make({});

describe("placement", () => {
  test("several sessions with the same prompt work in the Workspace directory at once", async () => {
    const { claude, fakes, layer } = setup();
    await run(
      layer,
      Effect.gen(function* () {
        const workspace: Workspace = yield* registerWorkspace;
        const ids = ["s-a", "s-b", "s-c"].map((s) => SessionId.make(s));

        for (const id of ids) yield* start(workspace.id, id, inPlace);

        const model = yield* waitFor((m) =>
          ids.every((id) => m.sessions.get(id)?.session.state === "working")
        );

        for (const id of ids) {
          expect(model.sessions.get(id)!.session).toMatchObject({
            cwd: workspace.path,
            worktreeId: null,
            title: PROMPT,
          });
        }

        yield* waitUntil(() => ids.every((id) => claude.latest(id) !== undefined));

        for (const id of ids) expect(claude.latest(id)!.options.cwd).toBe(workspace.path);
        expect(fakes.worktreeCalls).toEqual([]);
      })
    );
  });

  test("new Worktrees on distinct branches coexist; a taken branch is refused", async () => {
    const { fakes, layer } = setup();
    await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace;

        const worktree = (branch: string) =>
          SessionPlacement.cases.NewWorktree.make({ branch, baseRef: null });

        yield* start(
          workspace.id,
          SessionId.make("s-1"),
          worktree("polaris/fix-the-flaky-test-3f9a")
        );
        yield* start(
          workspace.id,
          SessionId.make("s-2"),
          worktree("polaris/fix-the-flaky-test-b71e")
        );
        yield* waitFor((m) => m.worktrees.size === 2);
        expect(fakes.worktreeCalls.map((c) => c.path)).toEqual([
          join(workspace.worktreeRoot, "polaris/fix-the-flaky-test-3f9a"),
          join(workspace.worktreeRoot, "polaris/fix-the-flaky-test-b71e"),
        ]);

        const taken = yield* Effect.flip(
          start(workspace.id, SessionId.make("s-3"), worktree("polaris/fix-the-flaky-test-3f9a"))
        );

        expect(taken._tag).toBe("CommandRejected");
        // The Workspace directory stays open to more sessions alongside them.
        yield* start(workspace.id, SessionId.make("s-4"), inPlace);
        yield* waitFor((m) => m.sessions.get(SessionId.make("s-4"))?.session.state === "working");
      })
    );
  });
});
