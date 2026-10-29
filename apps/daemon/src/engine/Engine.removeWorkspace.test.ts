/**
 * `RemoveWorkspace` through the real Engine (docs/adr/0086): refused while a session isn't
 * archived; accepted, its sessions leave the Host feed, its staged attachments are deleted,
 * and the folder on disk is left exactly as it was.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, SessionId, SessionPlacement, type Workspace } from "@polaris/protocol";
import { Effect, type Layer, Predicate, Stream } from "effect";
import type { EventStore } from "../store/EventStore.ts";
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

type Env = Engine | EventStore;

const run = <A, E>(layer: Layer.Layer<Env>, program: Effect.Effect<A, E, Env>) =>
  Effect.runPromise(program.pipe(Effect.provide(layer)));

const dispatch = (command: Command) =>
  Effect.flatMap(Engine, (engine) =>
    engine.dispatch({ commandId: cid(), command, deviceLabel: "MacBook" })
  );

const setup = () => {
  const fakes = makeFakes();
  const claude = makeFakeDriver("claude", { onTurn: completesTurns() });

  return {
    fakes,
    layer: engineLayer({ filename: join(tempDir(), "state.sqlite"), fakes, drivers: [claude] }),
  };
};

/** A folder with a file and a subfolder, to check the removal leaves it alone. */
const makeFolder = () => {
  const folder = join(tempDir(), "warehouse");
  mkdirSync(join(folder, "src"), { recursive: true });
  writeFileSync(join(folder, "README.md"), "# warehouse\n");
  writeFileSync(join(folder, "src", "main.ts"), "export {};\n");

  return folder;
};

const contentsOf = (folder: string) =>
  readdirSync(folder, { recursive: true, encoding: "utf8" })
    .toSorted()
    .map((path) => {
      try {
        return `${path}: ${readFileSync(join(folder, path), "utf8")}`;
      } catch {
        return `${path}/`;
      }
    });

const registerWorkspace = (folder: string) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.RegisterWorkspace.make({ path: folder, name: null }));
    const model = yield* waitFor((m) => [...m.workspaces.values()].some((w) => w.path === folder));

    return [...model.workspaces.values()].find((w) => w.path === folder)!;
  });

const startIdle = (workspace: Workspace, sessionId: SessionId) =>
  Effect.gen(function* () {
    yield* dispatch(
      Command.cases.StartSession.make({
        sessionId,
        workspaceId: workspace.id,
        harness: "claude",
        placement: SessionPlacement.cases.InPlace.make({}),
        permissionMode: "supervised",
        model: null,
        effort: null,
        prompt: "count the crates",
        attachments: [],
      })
    );
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "idle");
  });

const archive = (sessionId: SessionId) =>
  Effect.gen(function* () {
    yield* dispatch(Command.cases.ArchiveSession.make({ sessionId, deleteMergedBranch: false }));
    yield* waitFor((m) => m.sessions.get(sessionId)?.session.state === "archived");
  });

const snapshotSessions = Effect.gen(function* () {
  const engine = yield* Engine;
  const [snapshot] = yield* engine.subscribeHost(null).pipe(Stream.take(1), Stream.runCollect);

  return Predicate.isTagged(snapshot, "Snapshot")
    ? {
        workspaces: snapshot.workspaces.map((w) => String(w.id)),
        sessions: snapshot.sessions.map((s) => String(s.session.id)),
      }
    : null;
});

describe("RemoveWorkspace", () => {
  test("is refused while one of its sessions isn't archived, and purges nothing", async () => {
    const { layer } = setup();
    const folder = makeFolder();

    const [refusal, after] = await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(folder);
        yield* startIdle(workspace, SessionId.make("s-archived"));
        yield* archive(SessionId.make("s-archived"));
        yield* startIdle(workspace, SessionId.make("s-live"));

        const rejected = yield* Effect.flip(
          dispatch(Command.cases.RemoveWorkspace.make({ workspaceId: workspace.id }))
        );

        return [rejected, yield* snapshotSessions] as const;
      })
    );

    expect(refusal._tag).toBe("CommandRejected");
    expect(after?.sessions.toSorted()).toEqual(["s-archived", "s-live"]);
    expect(after?.workspaces).toHaveLength(1);
  });

  test("purges its sessions from the Host feed, deletes staged attachments, and leaves the folder", async () => {
    const { layer, fakes } = setup();
    const folder = makeFolder();
    const before = contentsOf(folder);

    const after = await run(
      layer,
      Effect.gen(function* () {
        const workspace = yield* registerWorkspace(folder);

        for (const id of ["s-1", "s-2"]) {
          yield* startIdle(workspace, SessionId.make(id));
          yield* archive(SessionId.make(id));
        }

        yield* dispatch(Command.cases.RemoveWorkspace.make({ workspaceId: workspace.id }));
        yield* waitFor((m) => !m.workspaces.has(workspace.id));

        // The reactor runs after the ack.
        for (let i = 0; i < 200 && fakes.removedWorkspaces.length === 0; i++) {
          yield* Effect.sleep("5 millis");
        }

        return { workspaceId: workspace.id, snapshot: yield* snapshotSessions };
      })
    );

    expect(after.snapshot).toEqual({ workspaces: [], sessions: [] });
    expect(fakes.removedWorkspaces).toEqual([after.workspaceId]);
    expect(contentsOf(folder)).toEqual(before);
  });
});
